"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFile } = require("node:child_process");

function detectSea() {
  try {
    return require("node:sea").isSea();
  } catch {
    return false;
  }
}

const IS_SEA = detectSea();
const ROOT = IS_SEA ? path.dirname(process.execPath) : path.resolve(__dirname, "..");
/**
 * 体积上限。
 *
 * 本项目是纯本地工具：没有带宽成本、没有多租户风险，唯一的约束是「别把内存吃穿」。
 * 所以这里的原则是**尽量宽**，把「性能」的责任放在画板自身（渲染、缩略图、索引），
 * 而不是靠限制用户塞进来的素材。
 *
 * 三个值必须一起看：
 *   - IMAGE_LIMIT：单张图片（解码后字节数）。与引擎侧补丁
 *     `patchFileSizeLimit` 的 64MiB 保持一致——引擎收得下、服务端存不下是最糟的组合。
 *   - BODY_LIMIT：单个请求体上限。图片在场景 JSON 里以 base64 内联（膨胀约 4/3），
 *     一次防抖保存可能合并多张新图，所以留出约 3 张满额图片的余量。
 *   - 声明与实际两道校验（content-length + 流式累计）都走 BODY_LIMIT。
 */
const IMAGE_LIMIT = 64 * 1024 * 1024;
const BODY_LIMIT = 256 * 1024 * 1024;
const LEASE_MS = 45_000;
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".otf": "font/otf", ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};
const EXT_BY_MIME = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
  "image/webp": "webp", "image/svg+xml": "svg", "image/bmp": "bmp",
};
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const WRITE_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);

/**
 * 纯离线的硬约束。
 *
 * 界面上的联网入口（浏览素材库 / 发布素材库 / 嵌入网页 / 社交链接）已经被移除或隐藏，
 * 但那只是「看不见」；这条 CSP 保证即使有人绕过界面，请求也发不出去：
 *   - connect-src 'self' → fetch/XHR/WebSocket 只能打本地服务
 *   - default-src 'self' → 图片/字体/脚本/样式一律同源
 *   - frame-src 'none'   → 不允许任何 <iframe>（嵌入网页元素的兜底）
 *   - form-action 'none' → 不允许表单外发
 * 唯一的 'unsafe-inline' 给 style，因为 React 与引擎大量使用内联 style 属性。
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

function failure(status, code, message, details = {}) {
  return Object.assign(new Error(message), { status, code, details });
}
function requireId(id) {
  if (typeof id !== "string" || !ID_PATTERN.test(id) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id)) {
    throw failure(400, "INVALID_ID", "标识符仅允许字母、数字、下划线和连字符，长度为1至128。");
  }
  return id;
}
function requireOwner(owner) {
  if (typeof owner !== "string" || !owner.trim() || owner.length > 256) {
    throw failure(400, "INVALID_OWNER", "必须提供非空 owner，长度不能超过256。");
  }
  return owner;
}
function requireKeys(body, keys) {
  if (!isRecord(body) || Object.keys(body).some((key) => !keys.includes(key))) {
    throw failure(400, "INVALID_FIELDS", "请求包含不支持的字段。");
  }
}
function json(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}
function notFound() {
  throw failure(404, "NOT_FOUND", "未找到资源。");
}

async function readJSONBody(req) {
  const declared = req.headers["content-length"];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > BODY_LIMIT)) {
    req.resume();
    throw failure(413, "BODY_TOO_LARGE", "请求体不能超过128MB。");
  }
  const body = await new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let finished = false;
    req.on("data", (chunk) => {
      if (finished) return;
      length += chunk.length;
      if (length > BODY_LIMIT) {
        finished = true;
        chunks.length = 0;
        reject(failure(413, "BODY_TOO_LARGE", "请求体不能超过128MB。"));
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => {
      if (!finished) { finished = true; resolve(Buffer.concat(chunks, length)); }
    });
    req.on("error", (err) => { if (!finished) { finished = true; reject(err); } });
    req.on("aborted", () => {
      if (!finished) { finished = true; reject(failure(400, "ABORTED_BODY", "请求体传输中断。")); }
    });
  });
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    if (!isRecord(value)) throw new Error("object required");
    return value;
  } catch {
    throw failure(400, "INVALID_JSON", "请求体必须是有效的JSON对象。");
  }
}

async function atomicWrite(file, contents) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temp, "wx", 0o600);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temp, file);
  } finally {
    if (handle) await handle.close();
    await fs.unlink(temp).catch((err) => { if (err.code !== "ENOENT") throw err; });
  }
}

function validSignature(mime, buffer) {
  switch (mime) {
    case "image/png":
      return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case "image/jpeg": return buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
    case "image/gif": return buffer.length >= 6 && /^(GIF87a|GIF89a)$/.test(buffer.toString("ascii", 0, 6));
    case "image/webp":
      return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
    case "image/bmp": return buffer.length >= 14 && buffer[0] === 66 && buffer[1] === 77;
    case "image/svg+xml": {
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer).trim();
        if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) return false;
        const root = text.replace(/^(?:<\?xml\s[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*/, "");
        return /^<svg(?:\s|>|\/)/.test(root) && /(?:<\/svg\s*>|\/>)\s*$/.test(root);
      } catch { return false; }
    }
    default: return false;
  }
}

function decodeImage(id, file) {
  requireId(id);
  requireKeys(file, ["id", "mimeType", "dataURL", "created"]);
  if (file.id !== id || typeof file.mimeType !== "string" || !own(EXT_BY_MIME, file.mimeType) || typeof file.dataURL !== "string" ||
      !Number.isFinite(file.created) || file.created < 0) {
    throw failure(400, "INVALID_IMAGE", "图片id、MIME、dataURL或created无效。", { fileId: id });
  }
  const prefix = `data:${file.mimeType};base64,`;
  if (!file.dataURL.startsWith(prefix)) throw failure(400, "INVALID_IMAGE", "图片dataURL与MIME不一致。", { fileId: id });
  const encoded = file.dataURL.slice(prefix.length);
  if (encoded.length > 4 * Math.ceil(IMAGE_LIMIT / 3)) {
    throw failure(413, "IMAGE_TOO_LARGE", `单张图片不能超过${IMAGE_LIMIT / 1024 / 1024}MB。`, { fileId: id });
  }
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw failure(400, "INVALID_BASE64", "图片必须使用规范的base64编码。", { fileId: id });
  }
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length > IMAGE_LIMIT) throw failure(413, "IMAGE_TOO_LARGE", `单张图片不能超过${IMAGE_LIMIT / 1024 / 1024}MB。`, { fileId: id });
  if (buffer.toString("base64") !== encoded || !validSignature(file.mimeType, buffer)) {
    throw failure(400, "INVALID_IMAGE_SIGNATURE", "图片签名或base64编码无效。", { fileId: id });
  }
  return { buffer, asset: { id, mimeType: file.mimeType, ext: EXT_BY_MIME[file.mimeType], created: file.created } };
}

function meta(board) {
  return {
    id: board.id, name: board.name, createdAt: board.createdAt, updatedAt: board.updatedAt,
    thumbnail: board.thumbnail ?? null, elementCount: board.elementCount ?? 0, revision: board.revision,
  };
}

/**
 * 引擎按 `./fonts/<Family>/<hash>.woff2` 请求它自带的字体家族，
 * 本地路径失败后会无条件回退到 esm.sh（外网）。
 * 这里把任何家族请求都别名到本地普惠体，配合 CSP 做到「一个外网请求都不会发出去」。
 * 映射表与 vite.config.ts 共用 font-map.json（构建时被复制进 dist）。
 */
function resolveMappedFont(map, pathname) {
  if (!map) return null;
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "fonts" || parts[1] === "puhuiti") return null;
  const weight = own(map.families, parts[1]) ? map.families[parts[1]] : map.fallback;
  if (typeof weight !== "string" || !own(map.weights, weight)) return null;
  return map.weights[weight];
}

function createLocalServer(options = {}) {
  const dataDir = path.resolve(options.dataDir ?? process.env.WHITEBOARD_DATA_DIR ?? path.join(ROOT, "data"));
  const distDir = path.resolve(options.distDir ?? path.join(ROOT, "dist"));
  const dirs = Object.fromEntries(["boards", "assets", "backups", "trash"].map((name) => [name, path.join(dataDir, name)]));
  const now = options.now ?? Date.now;
  const logger = options.logger ?? console;
  const sea = options.isSea ?? IS_SEA;
  const getAsset = options.getAsset ?? (sea ? (name, encoding) => require("node:sea").getAsset(name, encoding) : undefined);
  let manifest;
  let fontMap = null;
  const locks = new Map();
  const leases = new Map();
  let started;
  let starting;
  let ready;

  const libraryFile = path.join(dataDir, "library.json");
  const prefsFile = path.join(dataDir, "prefs.json");

  function initialize() {
    ready ??= Promise.all(Object.values(dirs).map((dir) => fs.mkdir(dir, { recursive: true }))).then(async () => {
      if (sea) {
        const entries = JSON.parse(getAsset("__manifest", "utf8"));
        if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string" || !entry ||
            entry.startsWith("/") || entry.includes("\\") || entry.split("/").some((part) => !part || part === "." || part === ".."))) {
          throw new Error("SEA __manifest 必须是安全的相对文件路径数组。");
        }
        manifest = new Set(entries);
      }
      fontMap = await loadFontMap();
    });
    return ready;
  }
  /**
   * font-map.json 由构建产出并随 dist 一起嵌入 exe；
   * 读不到就退化成「不做别名」，此时由 CSP 阻止引擎回退到 esm.sh。
   */
  async function loadFontMap() {
    const content = await staticContent("font-map.json");
    if (!content) return null;
    try {
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content.body));
      if (isRecord(value) && isRecord(value.weights) && isRecord(value.families) && typeof value.fallback === "string") return value;
    } catch {
      logger.error("font-map.json 无法解析，已禁用字体别名（外网请求仍被 CSP 阻止）。");
    }
    return null;
  }
  function withLock(key, fn) {
    const previous = locks.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const settled = run.catch(() => {});
    locks.set(key, settled);
    void settled.then(() => { if (locks.get(key) === settled) locks.delete(key); });
    return run;
  }
  const boardFile = (id) => path.join(dirs.boards, `${id}.json`);
  function activeLease(id) {
    const lease = leases.get(id);
    if (lease && lease.expiresAt > now()) return lease;
    leases.delete(id);
    return undefined;
  }
  function rejectLeaseConflict(id, owner, required = false) {
    const lease = activeLease(id);
    if ((required && !lease) || (lease && lease.owner !== owner)) {
      throw failure(423, "LEASE_REQUIRED", "需要有效且属于当前owner的租约。", lease ? { expiresAt: lease.expiresAt } : {});
    }
  }

  async function readStored(file, id, backup = false) {
    let text;
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile()) throw failure(500, backup ? "BACKUP_CORRUPT" : "BOARD_CORRUPT", "白板文件不是普通文件。", { boardId: id });
      text = await fs.readFile(file);
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(text);
      const board = JSON.parse(text);
      if (!isRecord(board) || board.id !== id || typeof board.name !== "string" ||
          !Number.isFinite(board.createdAt) || !Number.isFinite(board.updatedAt) ||
          !isRecord(board.scene) || !Array.isArray(board.scene.elements) || !isRecord(board.scene.appState) ||
          !Array.isArray(board.assets) || (board.revision !== undefined && (!Number.isSafeInteger(board.revision) || board.revision < 0))) {
        throw new Error("invalid board");
      }
      board.revision ??= 0;
      for (const asset of board.assets) {
        if (!isRecord(asset)) throw new Error("invalid asset");
        requireId(asset.id);
        const mime = asset.mimeType === "image/jpg" ? "image/jpeg" : asset.mimeType;
        if (typeof mime !== "string" || !own(EXT_BY_MIME, mime) || asset.ext !== EXT_BY_MIME[mime]) throw new Error("invalid asset");
      }
      return { board, text };
    } catch {
      throw failure(500, backup ? "BACKUP_CORRUPT" : "BOARD_CORRUPT", "白板JSON损坏，未忽略或覆盖该文件。", { boardId: id });
    }
  }
  async function readBoard(id) {
    return readStored(boardFile(id), id);
  }
  async function writeBoard(board, previous) {
    if (previous) await atomicWrite(path.join(dirs.backups, `${board.id}.json`), previous.text);
    await atomicWrite(boardFile(board.id), JSON.stringify(board, null, 2));
  }
  async function mustRead(id) {
    const stored = await readBoard(id);
    if (!stored) notFound();
    return stored;
  }

  /* ---------------- 个人素材库（data/library.json） ----------------
     素材库是全局单例，不属于任何一块白板；只做整体读写，不做条目级合并。 */

  async function readLibraryRaw() {
    try {
      const stat = await fs.lstat(libraryFile);
      if (!stat.isFile()) throw failure(500, "LIBRARY_CORRUPT", "素材库文件不是普通文件。");
      return await fs.readFile(libraryFile, "utf8");
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }
  /** 结构校验：只接受引擎的 LibraryItems 形状，损坏时报错而不是静默清空。 */
  function parseLibrary(text) {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw failure(500, "LIBRARY_CORRUPT", "素材库JSON损坏，未覆盖该文件。");
    }
    if (!isRecord(value) || !Array.isArray(value.libraryItems)) {
      throw failure(500, "LIBRARY_CORRUPT", "素材库JSON结构无效，未覆盖该文件。");
    }
    for (const item of value.libraryItems) {
      if (!isRecord(item) || typeof item.id !== "string" || !Array.isArray(item.elements)) {
        throw failure(500, "LIBRARY_CORRUPT", "素材库条目结构无效，未覆盖该文件。");
      }
    }
    return { libraryItems: value.libraryItems };
  }
  async function readLibrary() {
    const text = await readLibraryRaw();
    return text === null ? { libraryItems: [] } : parseLibrary(text);
  }

  /* ---------------- 界面偏好（data/prefs.json） ----------------
     为什么放服务端而不是 localStorage：localStorage 按「协议 + 主机 + 端口」隔离，
     而本服务的端口会在 4173 被占用时漂移到 4174/4175…，用户也可能用
     localhost 和 127.0.0.1 两个入口访问。任一情况都会让偏好静默丢失、
     回落到系统主题——表现就是「主题怎么点都是深色」。
     落到 data/ 之后，偏好跟着数据目录走，同时满足「用户数据只落一个文件夹」。 */

  const PREF_THEMES = ["light", "dark", "system"];

  function parsePrefs(text) {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw failure(500, "PREFS_CORRUPT", "偏好JSON损坏，未覆盖该文件。");
    }
    if (!isRecord(value)) throw failure(500, "PREFS_CORRUPT", "偏好JSON结构无效，未覆盖该文件。");
    return { theme: PREF_THEMES.includes(value.theme) ? value.theme : "system" };
  }
  async function readPrefs() {
    let text;
    try {
      const stat = await fs.lstat(prefsFile);
      if (!stat.isFile()) throw failure(500, "PREFS_CORRUPT", "偏好文件不是普通文件。");
      text = await fs.readFile(prefsFile, "utf8");
    } catch (err) {
      if (err.code === "ENOENT") return { theme: "system" };
      throw err;
    }
    return parsePrefs(text);
  }

  async function findAsset(id) {
    if (process.platform === "win32") {
      const aliases = (await fs.readdir(dirs.assets)).filter((name) => {
        const stem = name.slice(0, name.lastIndexOf("."));
        return stem.toLowerCase() === id.toLowerCase() && stem !== id;
      });
      if (aliases.length) throw failure(409, "ASSET_CONFLICT", "fileId大小写与已有资源冲突。", { fileId: id });
    }
    const matches = [];
    for (const ext of Object.values(EXT_BY_MIME)) {
      const file = path.join(dirs.assets, `${id}.${ext}`);
      try {
        const stat = await fs.lstat(file);
        if (!stat.isFile()) throw failure(409, "ASSET_CONFLICT", "资源不是普通文件。", { fileId: id });
        matches.push({ file, ext, size: stat.size });
      } catch (err) { if (err.code !== "ENOENT") throw err; }
    }
    if (matches.length > 1) throw failure(409, "ASSET_CONFLICT", "同一fileId存在多个资源文件。", { fileId: id });
    return matches[0];
  }

  async function commitScene(id, body) {
    requireKeys(body, ["owner", "revision", "scene", "files"]);
    requireOwner(body.owner);
    if (!Number.isSafeInteger(body.revision) || body.revision < 0 || !isRecord(body.scene) ||
        !Array.isArray(body.scene.elements) || !isRecord(body.scene.appState) || !isRecord(body.files)) {
      throw failure(400, "INVALID_SCENE", "必须提供revision、scene.elements、scene.appState和files对象。");
    }
    requireKeys(body.scene, ["elements", "appState"]);
    const referenced = new Set();
    for (const element of body.scene.elements) {
      if (!isRecord(element)) throw failure(400, "INVALID_SCENE", "场景元素必须为对象。");
      if (element.type === "image" && element.isDeleted !== true) referenced.add(requireId(element.fileId));
    }
    const previous = await mustRead(id);
    rejectLeaseConflict(id, body.owner, true);
    if (body.revision !== previous.board.revision) {
      throw failure(409, "REVISION_CONFLICT", "白板revision已变更。", { revision: previous.board.revision });
    }
    if (previous.board.revision === Number.MAX_SAFE_INTEGER) throw failure(409, "REVISION_OVERFLOW", "revision已达到安全整数上限。");

    // 所有白板共享一把资源锁；完整验证后才写图片，避免跨板同id覆盖。
    return withLock("assets", async () => {
      const uploads = new Map(Object.entries(body.files).map(([fileId, file]) => [fileId, decodeImage(fileId, file)]));
      if (process.platform === "win32" && new Set([...uploads.keys()].map((fileId) => fileId.toLowerCase())).size !== uploads.size) {
        throw failure(409, "ASSET_CONFLICT", "同批fileId不能仅有大小写差异。");
      }
      const registered = new Map(previous.board.assets.map((asset) => [asset.id, asset]));
      const assets = [];
      const pending = [];
      for (const [fileId, upload] of uploads) {
        const existing = await findAsset(fileId);
        if (existing) {
          if (existing.ext !== upload.asset.ext || existing.size !== upload.buffer.length ||
              !(await fs.readFile(existing.file)).equals(upload.buffer)) {
            throw failure(409, "ASSET_CONFLICT", "同一fileId不能对应不同图片内容或MIME。", { fileId });
          }
        } else {
          pending.push(upload);
        }
      }
      for (const fileId of referenced) {
        const upload = uploads.get(fileId);
        const registration = registered.get(fileId);
        if (!upload && !registration) throw failure(400, "MISSING_ASSET", "场景图片尚未登记，必须随files提交。", { fileId });
        if (upload) {
          assets.push(upload.asset);
        } else {
          const existing = await findAsset(fileId);
          const mimeType = registration.mimeType === "image/jpg" ? "image/jpeg" : registration.mimeType;
          if (!existing || existing.ext !== registration.ext || existing.size > IMAGE_LIMIT ||
              !validSignature(mimeType, await fs.readFile(existing.file))) {
            throw failure(400, "MISSING_ASSET", "已登记的图片文件缺失或无效。", { fileId });
          }
          assets.push({ ...registration, mimeType });
        }
      }
      rejectLeaseConflict(id, body.owner, true);
      for (const upload of pending) {
        await atomicWrite(path.join(dirs.assets, `${upload.asset.id}.${upload.asset.ext}`), upload.buffer);
      }
      // 图片写入耗时也计入租约；失败时仅可能留下安全、未引用的图片。
      rejectLeaseConflict(id, body.owner, true);
      const board = {
        ...previous.board, scene: body.scene, assets, revision: previous.board.revision + 1,
        updatedAt: now(), elementCount: body.scene.elements.filter((element) => element.isDeleted !== true).length,
      };
      await writeBoard(board, previous);
      return board;
    });
  }

  async function handleApi(req, res, pathname, body) {
    const method = req.method;
    if (pathname === "/api/health" && method === "GET") {
      return json(res, 200, {
        app: "whiteboard-local", version: "0.4.0", dataDir, port: req.socket.localPort,
        leaseMs: LEASE_MS, bodyLimit: BODY_LIMIT, imageLimit: IMAGE_LIMIT, sea,
        fontAlias: fontMap !== null, offline: true,
      });
    }
    if (pathname === "/api/prefs") {
      if (method === "GET") return json(res, 200, await readPrefs());
      if (method === "PUT") {
        requireKeys(body, ["theme"]);
        if (!PREF_THEMES.includes(body.theme)) {
          throw failure(400, "INVALID_PREFS", `theme必须是 ${PREF_THEMES.join(" / ")} 之一。`);
        }
        const next = { theme: body.theme };
        return withLock("prefs", async () => {
          await atomicWrite(prefsFile, JSON.stringify(next, null, 2));
          return json(res, 200, next);
        });
      }
      notFound();
    }
    if (pathname === "/api/library") {
      if (method === "GET") return json(res, 200, await readLibrary());
      if (method === "PUT") {
        requireKeys(body, ["libraryItems"]);
        if (!Array.isArray(body.libraryItems)) {
          throw failure(400, "INVALID_LIBRARY", "libraryItems必须是数组。");
        }
        for (const item of body.libraryItems) {
          if (!isRecord(item) || typeof item.id !== "string" || !item.id || item.id.length > 128 ||
              !Array.isArray(item.elements)) {
            throw failure(400, "INVALID_LIBRARY", "素材库条目必须包含非空字符串id与elements数组。");
          }
        }
        return withLock("library", async () => {
          const previous = await readLibraryRaw();
          if (previous !== null) await atomicWrite(path.join(dirs.backups, "library.json"), previous);
          await atomicWrite(libraryFile, JSON.stringify({ libraryItems: body.libraryItems }, null, 2));
          return json(res, 200, { ok: true, count: body.libraryItems.length });
        });
      }
      notFound();
    }
    if (pathname === "/api/boards") {
      if (method === "GET") {
        const list = [];
        for (const file of await fs.readdir(dirs.boards)) {
          if (!file.endsWith(".json")) continue;
          const id = file.slice(0, -5);
          if (!ID_PATTERN.test(id)) throw failure(500, "BOARD_CORRUPT", "白板目录包含非法JSON文件名。", { boardId: id });
          const stored = await withLock(`board:${id}`, () => readBoard(id));
          if (stored) list.push(meta(stored.board));
        }
        return json(res, 200, list.sort((a, b) => b.updatedAt - a.updatedAt));
      }
      if (method === "POST") {
        requireKeys(body, ["name"]);
        if (own(body, "name") && typeof body.name !== "string") throw failure(400, "INVALID_NAME", "name必须是字符串。");
        const timestamp = now();
        const board = {
          id: randomUUID(), name: body.name?.trim() || "未命名白板", createdAt: timestamp, updatedAt: timestamp,
          thumbnail: null, elementCount: 0, revision: 0, scene: { elements: [], appState: {} }, assets: [],
        };
        await withLock(`board:${board.id}`, () => writeBoard(board));
        return json(res, 201, board);
      }
    }
    const match = pathname.match(/^\/api\/boards\/([^/]+)(?:\/([^/]+))?$/);
    if (!match) notFound();
    const id = requireId(match[1]);
    const action = match[2];
    return withLock(`board:${id}`, async () => {
      if (action === "restore" && method === "POST") {
        requireKeys(body, ["owner"]);
        if (own(body, "owner")) requireOwner(body.owner);
        rejectLeaseConflict(id, body.owner);
        const backup = await readStored(path.join(dirs.backups, `${id}.json`), id, true);
        if (!backup) notFound();
        let previous;
        try { previous = await readBoard(id); } catch (err) { if (err.code !== "BOARD_CORRUPT") throw err; }
        const revision = Math.max(previous?.board.revision ?? 0, backup.board.revision);
        if (revision === Number.MAX_SAFE_INTEGER) throw failure(409, "REVISION_OVERFLOW", "revision已达到安全整数上限。");
        const restored = { ...backup.board, revision: revision + 1, updatedAt: now() };
        await writeBoard(restored, previous);
        return json(res, 200, restored);
      }
      if (action === "scene" && method === "PUT") {
        const board = await commitScene(id, body);
        return json(res, 200, { revision: board.revision, updatedAt: board.updatedAt, elementCount: board.elementCount });
      }
      const previous = await mustRead(id);
      const board = previous.board;
      if (action === "lease") {
        if (method === "POST" || method === "DELETE") {
          requireKeys(body, ["owner"]);
          const owner = requireOwner(body.owner);
          const lease = activeLease(id);
          if (lease && lease.owner !== owner) throw failure(409, "LEASE_CONFLICT", "白板已被其他owner租用。", { expiresAt: lease.expiresAt });
          if (method === "POST") {
            const acquired = { owner, expiresAt: now() + LEASE_MS };
            leases.set(id, acquired);
            return json(res, 200, acquired);
          }
          leases.delete(id);
          return json(res, 200, { owner, expiresAt: 0 });
        }
      } else if (action === "duplicate" && method === "POST") {
        requireKeys(body, []);
        const timestamp = now();
        const copy = { ...board, id: randomUUID(), name: `${board.name} 副本`, revision: 0, createdAt: timestamp, updatedAt: timestamp };
        await withLock(`board:${copy.id}`, () => writeBoard(copy));
        return json(res, 201, copy);
      } else if (!action) {
        if (method === "GET") return json(res, 200, board);
        if (method === "PUT") {
          requireKeys(body, ["name", "thumbnail", "elementCount"]);
          if (own(body, "name")) {
            if (typeof body.name !== "string") throw failure(400, "INVALID_NAME", "name必须是字符串。");
            board.name = body.name.trim() || board.name;
          }
          if (own(body, "thumbnail")) {
            if (body.thumbnail !== null && typeof body.thumbnail !== "string") throw failure(400, "INVALID_THUMBNAIL", "thumbnail必须是字符串或null。");
            board.thumbnail = body.thumbnail;
          }
          if (own(body, "elementCount")) {
            if (!Number.isSafeInteger(body.elementCount) || body.elementCount < 0) throw failure(400, "INVALID_ELEMENT_COUNT", "elementCount必须为非负安全整数。");
            board.elementCount = body.elementCount;
          }
          board.updatedAt = now();
          await writeBoard(board, previous);
          return json(res, 200, board);
        }
        if (method === "DELETE") {
          requireKeys(body, ["owner"]);
          if (own(body, "owner")) requireOwner(body.owner);
          rejectLeaseConflict(id, body.owner);
          const trash = path.join(dirs.trash, `${id}.${now()}.${randomUUID()}.json`);
          await fs.rename(boardFile(id), trash);
          leases.delete(id);
          return json(res, 200, { ok: true });
        }
      }
      notFound();
    });
  }

  function securePath(req, res) {
    const port = req.socket.localPort;
    const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (port === 80) { hosts.add("127.0.0.1"); hosts.add("localhost"); }
    const hostCount = req.rawHeaders.filter((_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === "host").length;
    if (hostCount !== 1 || !hosts.has(req.headers.host)) throw failure(403, "INVALID_HOST", "Host必须为本地地址及当前服务端口。");
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (![ `http://${req.headers.host}`, "http://127.0.0.1:5173", "http://localhost:5173" ].includes(origin)) {
        throw failure(403, "INVALID_ORIGIN", "不允许此Origin访问本地白板。");
      }
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "Origin");
      res.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type");
    }
    if (WRITE_METHODS.has(req.method)) {
      if (req.headers["sec-fetch-site"] === "cross-site") throw failure(403, "CROSS_SITE_WRITE", "拒绝跨站写请求。");
      if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(req.headers["content-type"] ?? "")) {
        throw failure(415, "JSON_REQUIRED", "写操作必须使用application/json。");
      }
    }
    const raw = req.url?.split("?")[0] ?? "/";
    if (!raw.startsWith("/") || raw.startsWith("//") || /%2f|%5c/i.test(raw)) throw failure(400, "INVALID_PATH", "非法请求路径。");
    let pathname;
    try { pathname = decodeURIComponent(raw); } catch { throw failure(400, "INVALID_PATH", "路径编码无效。"); }
    if (/[\\%#<>:"|?*\u0000-\u001f\u007f]/.test(pathname) || pathname.includes("//") ||
        pathname.split("/").some((part) => /[ .]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
      throw failure(400, "INVALID_PATH", "拒绝路径穿越或非法路径。");
    }
    return pathname;
  }
  async function staticContent(relative) {
    if (sea && manifest.has(relative)) return { body: Buffer.from(getAsset(relative)), relative };
    const file = path.resolve(distDir, relative);
    try {
      const real = await fs.realpath(file);
      const root = await fs.realpath(distDir);
      if (real !== root && !real.startsWith(root + path.sep)) throw failure(403, "INVALID_PATH", "静态文件不允许越过dist目录。");
      if (!(await fs.stat(real)).isFile()) return null;
      return { body: await fs.readFile(real), relative };
    } catch (err) { if (err.code === "ENOENT" || err.code === "ENOTDIR") return null; throw err; }
  }
  /**
   * 把已保存的主题偏好直接写进 `<html>`。
   *
   * 两个属性各司其职：
   *   - `data-theme-pref` 是用户的选择（light / dark / system），权威来源；
   *   - `data-theme` 是解析后的实际主题，只驱动 CSS。
   * 显式主题两个都注入，首屏无需任何 JS 就是正确底色；
   * `system` 只注入 pref，由 theme-init.js 按 prefers-color-scheme 解析。
   *
   * 偏好文件损坏时按「不注入」处理——页面不该因为一个偏好文件打不开。
   */
  async function injectTheme(body) {
    let theme = "system";
    try {
      theme = (await readPrefs()).theme;
    } catch {
      /* 忽略：由前端回落到系统主题 */
    }
    if (!PREF_THEMES.includes(theme)) theme = "system";
    const text = body.toString("utf8");
    const attrs = theme === "system" ? `data-theme-pref="system"` : `data-theme="${theme}" data-theme-pref="${theme}"`;
    const patched = text.replace(/<html([^>]*)>/i, (whole, existing) =>
      /data-theme-pref=/i.test(existing) ? whole : `<html${existing} ${attrs}>`
    );
    return Buffer.from(patched, "utf8");
  }

  async function handleStatic(req, res, pathname) {
    if (req.method !== "GET" && req.method !== "HEAD") notFound();
    const relative = pathname.slice(1) || "index.html";
    // 只有「看起来像页面路由」的路径才回退到入口（前端用 HashRouter，实际只会请求 "/"）。
    // 带扩展名的资源缺失必须 404：否则浏览器会把 HTML 当成字体/脚本解析，故障极难定位。
    const isAssetPath = relative !== "index.html" && path.extname(relative) !== "";
    const content = await staticContent(relative) ?? (isAssetPath ? null : await staticContent("index.html"));
    if (!content) {
      if (isAssetPath) throw failure(404, "NOT_FOUND", "未找到静态资源。");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(req.method === "HEAD" ? undefined : "<!doctype html><meta charset='utf-8'><h1>尚未构建</h1><p>请先在prototype目录运行npm run build。</p>");
    }
    const ext = path.extname(content.relative).toLowerCase();
    const headers = {
      "content-type": own(MIME, ext) ? MIME[ext] : "application/octet-stream",
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    };
    // CSP 只挂在 HTML 上：它是文档级策略，挂在其它资源上纯属浪费字节。
    if (ext === ".html") headers["content-security-policy"] = CONTENT_SECURITY_POLICY;
    const body = ext === ".html" ? await injectTheme(content.body) : content.body;
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    try {
      const pathname = securePath(req, res);
      await initialize();
      if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
      const body = WRITE_METHODS.has(req.method) ? await readJSONBody(req) : undefined;
      if (pathname.startsWith("/api/")) return await handleApi(req, res, pathname, body);
      if (pathname.startsWith("/fonts/")) {
        if (req.method !== "GET" && req.method !== "HEAD") notFound();
        // 家族请求走别名；puhuiti 下的真实文件按原路径取。
        const alias = resolveMappedFont(fontMap, pathname);
        const content = await staticContent(alias ?? pathname.slice(1));
        if (!content) throw failure(404, "NOT_FOUND", "未找到字体文件。");
        res.writeHead(200, { "content-type": MIME[".woff2"], "cache-control": "public, max-age=31536000, immutable" });
        return res.end(req.method === "HEAD" ? undefined : content.body);
      }
      if (pathname.startsWith("/assets/")) {
        if (req.method !== "GET" && req.method !== "HEAD") notFound();
        const id = requireId(pathname.slice("/assets/".length));
        const asset = await withLock("assets", async () => {
          const found = await findAsset(id);
          if (!found) notFound();
          return { ...found, body: await fs.readFile(found.file) };
        });
        if (asset.ext === "svg") res.setHeader("content-security-policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'");
        res.writeHead(200, { "content-type": MIME[`.${asset.ext}`], "cache-control": "public, max-age=31536000, immutable" });
        return res.end(req.method === "HEAD" ? undefined : asset.body);
      }
      return await handleStatic(req, res, pathname);
    } catch (err) {
      req.resume();
      if (res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      if (err.status === 413) res.setHeader("connection", "close");
      if (!err.status) logger.error("本地服务器请求失败：", err);
      json(res, err.status ?? 500, { error: err.status ? err.message : "本地文件操作失败。", code: err.code ?? "INTERNAL_ERROR", ...err.details });
    }
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 60_000;

  async function start() {
    if (started) return started;
    if (starting) return starting;
    starting = (async () => {
      await initialize();
      let port = options.port ?? 4173;
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("端口必须是0至65535的整数。");
      for (let attempt = 0; attempt < 25; attempt++) {
        try {
          await new Promise((resolve, reject) => {
            const onError = (err) => { server.off("listening", onListening); reject(err); };
            const onListening = () => { server.off("error", onError); resolve(); };
            server.once("error", onError);
            server.once("listening", onListening);
            server.listen(port, "127.0.0.1");
          });
          started = { url: `http://127.0.0.1:${server.address().port}/`, port: server.address().port, reused: false };
          break;
        } catch (err) {
          if (err.code !== "EADDRINUSE" || port === 0) throw err;
          const health = await probeHealth(port);
          if (health?.app === "whiteboard-local" && typeof health.dataDir === "string" && sameDirectory(health.dataDir, dataDir)) {
            started = { url: `http://127.0.0.1:${port}/`, port, reused: true };
            break;
          }
          if (port === 65535 || attempt === 24) throw new Error(`端口${port}被其他服务占用，未连接该服务；请指定其他端口。`);
          logger.log(`端口${port}被其他服务或其他数据目录占用，尝试${port + 1}。`);
          port++;
        }
      }
      logger.log(`白板${started.reused ? "已复用本地实例" : "已启动"}\n地址：${started.url}\n数据目录：${dataDir}\nCtrl+C可优雅关闭服务。`);
      if (options.noOpen === false) openBrowser(started.url, logger);
      return started;
    })();
    try { return await starting; } finally { starting = undefined; }
  }
  async function close() {
    if (starting) await starting;
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve());
        server.closeIdleConnections();
      });
    }
    await Promise.all(locks.values());
    leases.clear();
    started = undefined;
  }
  return { server, start, close, dataDir, distDir };
}

function sameDirectory(first, second) {
  const a = path.resolve(first);
  const b = path.resolve(second);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function probeHealth(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: 1000 }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; if (text.length > 64 * 1024) res.destroy(); });
      res.on("end", () => {
        try { resolve(res.statusCode === 200 ? JSON.parse(text) : null); } catch { resolve(null); }
      });
      res.on("error", () => resolve(null));
      res.on("close", () => resolve(null));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}
function openBrowser(url, logger) {
  const command = process.platform === "win32" ? "cmd.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/d", "/c", "start", "", url] : [url];
  execFile(command, args, (err) => { if (err) logger.log("未能自动打开浏览器，请手动访问显示的地址。"); });
}

module.exports = { createLocalServer };

if (require.main === module || IS_SEA) {
  const app = createLocalServer({
    port: process.env.PORT === undefined ? 4173 : Number(process.env.PORT),
    noOpen: process.argv.includes("--no-open"),
  });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    console.log("白板正在关闭，等待请求和文件写入完成。");
    try { await app.close(); } catch (err) { console.error("关闭失败：", err.message); process.exitCode = 1; }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  app.start().then((result) => {
    if (result.reused) {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
    }
  }).catch((err) => { console.error("启动失败：", err.message); process.exitCode = 1; });
}
