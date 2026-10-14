// 端到端验证：直接验证打包好的 WhiteBoard.exe（真实用户路径）。
// 流程：静态检查图标资源 → 启动 → 托管前端 → 新建 → 保存含图片场景 → 关闭 → 重启 → 数据仍在 → 清理测试数据。
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { resolveIconSource, readIcoEntries } from "./set-exe-icon.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXE = path.join(ROOT, "WhiteBoard.exe");
const BASE = "http://127.0.0.1:4173";
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

/**
 * 期望内嵌的图标尺寸。
 *
 * 刻意**从图标源现场读出**而不是写死一张表：图标换过一次（logo.svg 生成的 7 档 →
 * 用户提供的 favicon_multi.ico 6 档），写死的表会让验证在换图标时「红得莫名其妙」，
 * 或者更糟 —— 有人顺手把表也改了，于是 exe 里装的和验证断言的就此各走各的。
 * 现在两边都来自同一个文件，改图标不需要动这个脚本。
 */
const ICON_SOURCE = resolveIconSource();
const EXPECTED_ICON_SIZES = ICON_SOURCE ? readIcoEntries(readFileSync(ICON_SOURCE)).map((e) => e.width) : [];

/**
 * 手写 PE 解析，读出 RT_GROUP_ICON 的条目。
 *
 * 刻意不复用写入侧的 resedit：验证脚本必须用**独立实现**读回来，
 * 否则「写错也读得出来」的假绿是必然的。
 */
function readIconGroup(exePath) {
  const buf = readFileSync(exePath);
  const peOffset = buf.readUInt32LE(0x3c);
  if (buf.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") throw new Error("不是合法的 PE 文件");

  const coff = peOffset + 4;
  const sectionCount = buf.readUInt16LE(coff + 2);
  const optionalSize = buf.readUInt16LE(coff + 16);
  const optional = coff + 20;
  const magic = buf.readUInt16LE(optional);
  if (magic !== 0x10b && magic !== 0x20b) throw new Error(`未知的可选头 magic：0x${magic.toString(16)}`);
  const dataDirectory = optional + (magic === 0x20b ? 112 : 96);

  const resourceRva = buf.readUInt32LE(dataDirectory + 2 * 8); // 目录项 2 = 资源表
  if (!resourceRva) throw new Error("exe 里没有资源目录");

  const sections = [];
  const sectionStart = optional + optionalSize;
  for (let i = 0; i < sectionCount; i++) {
    const at = sectionStart + i * 40;
    sections.push({
      virtualAddress: buf.readUInt32LE(at + 12),
      virtualSize: buf.readUInt32LE(at + 8),
      rawSize: buf.readUInt32LE(at + 16),
      rawPointer: buf.readUInt32LE(at + 20),
    });
  }
  const toOffset = (rva) => {
    for (const section of sections) {
      const span = Math.max(section.virtualSize, section.rawSize);
      if (rva >= section.virtualAddress && rva < section.virtualAddress + span) {
        return section.rawPointer + (rva - section.virtualAddress);
      }
    }
    throw new Error(`RVA 0x${rva.toString(16)} 不落在任何节里`);
  };

  const root = toOffset(resourceRva);
  const readDirectory = (offset) => {
    const named = buf.readUInt16LE(offset + 12);
    const ids = buf.readUInt16LE(offset + 14);
    const entries = [];
    for (let i = 0; i < named + ids; i++) {
      const at = offset + 16 + i * 8;
      const nameOrId = buf.readUInt32LE(at);
      const child = buf.readUInt32LE(at + 4);
      entries.push({ id: nameOrId & 0x7fffffff, isDirectory: (child & 0x80000000) !== 0, offset: child & 0x7fffffff });
    }
    return entries;
  };
  const findById = (offset, id) => {
    const hit = readDirectory(offset).find((entry) => entry.id === id && !entry.isDirectory);
    return hit ? root + hit.offset : null;
  };

  // 三层：类型(14=RT_GROUP_ICON) → 名称(ID) → 语言 → 数据项
  const typeEntry = readDirectory(root).find((entry) => entry.id === 14 && entry.isDirectory);
  if (!typeEntry) throw new Error("exe 里没有 RT_GROUP_ICON");
  const nameEntry = readDirectory(root + typeEntry.offset).find((entry) => entry.isDirectory);
  if (!nameEntry) throw new Error("RT_GROUP_ICON 下没有任何图标组");
  const dataEntryOffset = findById(root + nameEntry.offset, 1033);
  if (dataEntryOffset === null) throw new Error("图标组缺少语言 1033 的数据项");

  const dataRva = buf.readUInt32LE(dataEntryOffset);
  const dataSize = buf.readUInt32LE(dataEntryOffset + 4);
  const group = toOffset(dataRva);

  const reserved = buf.readUInt16LE(group);
  const type = buf.readUInt16LE(group + 2);
  const count = buf.readUInt16LE(group + 4);
  if (reserved !== 0 || type !== 1) throw new Error("GRPICONDIR 头不合法");

  const icons = [];
  for (let i = 0; i < count; i++) {
    const at = group + 6 + i * 14;
    icons.push({
      width: buf[at] === 0 ? 256 : buf[at],
      height: buf[at + 1] === 0 ? 256 : buf[at + 1],
      bytes: buf.readUInt32LE(at + 8),
      iconId: buf.readUInt16LE(at + 12),
    });
  }
  return { groupId: nameEntry.id, dataSize, icons };
}

let child;

async function launch() {
  child = spawn(EXE, ["--no-open"], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (c) => { output += c; });
  child.stderr.on("data", (c) => { output += c; });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        const health = await res.json();
        if (health.app === "whiteboard-local" && health.sea === true) return health;
      }
    } catch {
      /* 尚未监听 */
    }
    await delay(200);
  }
  throw new Error(`exe 未在 30 秒内就绪。输出：${output}`);
}

async function stop() {
  if (!child || child.exitCode !== null) return;
  child.kill();
  const deadline = Date.now() + 10_000;
  while (child.exitCode === null && Date.now() < deadline) await delay(100);
}

async function api(pathname, init = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, payload: text ? JSON.parse(text) : undefined };
}

const results = [];
const step = (name, ok, note = "") => {
  results.push({ name, ok, note });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? `  — ${note}` : ""}`);
};

try {
  // 静态检查放在最前：图标是「双击可见」的第一印象，也是最容易被构建步骤悄悄丢掉的资源。
  step("找到图标源文件", Boolean(ICON_SOURCE), ICON_SOURCE ? path.relative(ROOT, ICON_SOURCE) : "两个候选都不存在");

  const iconGroup = readIconGroup(EXE);
  const sizes = iconGroup.icons.map((icon) => icon.width);
  const expected = [...EXPECTED_ICON_SIZES].sort((a, b) => a - b);
  const actual = [...sizes].sort((a, b) => a - b);
  step(
    "exe 内嵌应用图标（RT_GROUP_ICON）",
    expected.length > 0 && expected.join(",") === actual.join(","),
    `组 ${iconGroup.groupId}，${sizes.join("/")} px（源 ${expected.join("/")} px）`
  );
  step(
    "图标各尺寸不重名且数据段非空",
    new Set(sizes).size === sizes.length && iconGroup.icons.every((icon) => icon.bytes > 0)
  );

  const health = await launch();
  step("双击启动后服务就绪", true, `dataDir=${health.dataDir}`);
  step("以单文件 exe 模式运行", health.sea === true);

  const html = await fetch(`${BASE}/`);
  const body = await html.text();
  step("前端从 exe 内嵌资源托管", html.status === 200 && /<div id="root">/.test(body));

  const csp = html.headers.get("content-security-policy") ?? "";
  step(
    "HTML 响应下发离线 CSP",
    /connect-src 'self'/.test(csp) && /frame-src 'none'/.test(csp) && !/unsafe-eval/.test(csp),
    csp ? `len=${csp.length}` : "缺少响应头"
  );

  // 字体：引擎按 `./fonts/<Family>/<file>.woff2` 取它自带的家族，服务器把它们别名到本地普惠体。
  // 所以这里既要验证「别名生效」，也要验证「普惠体本体能取到」。
  const aliasProbe = await fetch(`${BASE}/fonts/Virgil/Virgil-Regular.woff2`);
  const aliasBytes = (await aliasProbe.arrayBuffer()).byteLength;
  step(
    "引擎字体家族被别名到本地普惠体",
    aliasProbe.status === 200 && aliasBytes > 1_000_000,
    `status=${aliasProbe.status} bytes=${aliasBytes}`
  );

  const fallbackProbe = await fetch(`${BASE}/fonts/NoSuchFamily/NoSuchFile.woff2`);
  step("未知字体家族回退到默认字重", fallbackProbe.status === 200, `status=${fallbackProbe.status}`);

  const localProbe = await fetch(`${BASE}/fonts/puhuiti/regular.woff2`);
  step(
    "本地普惠体随 exe 一起发布",
    localProbe.status === 200 && (await localProbe.arrayBuffer()).byteLength > 1_000_000,
    `status=${localProbe.status}`
  );

  const created = await api("/api/boards", { method: "POST", body: JSON.stringify({ name: "验证白板" }) });
  const boardId = created.payload.id;
  step("新建白板成功（原“点新建没反应”已修复）", created.status === 201 && Boolean(boardId));

  const owner = "e2e-owner";
  const lease = await api(`/api/boards/${boardId}/lease`, { method: "POST", body: JSON.stringify({ owner }) });
  step("取得编辑租约", lease.status === 200);

  const scene = {
    elements: [
      { id: "rect-1", type: "rectangle", x: 10, y: 10, width: 120, height: 80, isDeleted: false, version: 1, versionNonce: 1, index: "a0" },
      { id: "img-1", type: "image", fileId: "e2e-img", x: 200, y: 10, width: 64, height: 64, isDeleted: false, version: 1, versionNonce: 2, index: "a1" },
    ],
    appState: { viewBackgroundColor: "#ffffff", zoom: { value: 1 } },
  };
  const saved = await api(`/api/boards/${boardId}/scene`, {
    method: "PUT",
    body: JSON.stringify({
      owner,
      revision: 0,
      scene,
      files: { "e2e-img": { id: "e2e-img", mimeType: "image/png", dataURL: `data:image/png;base64,${PNG_1PX}`, created: 1 } },
    }),
  });
  step("保存含图片的场景", saved.status === 200 && saved.payload.revision === 1, `revision=${saved.payload?.revision}`);

  const assets = readdirSync(path.join(health.dataDir, "assets"));
  step("图片落在 data/assets 下", assets.includes("e2e-img.png"), assets.join(",") || "(空)");

  const reloaded = await fetch(`${BASE}/assets/e2e-img`);
  step("图片可通过服务读回", reloaded.status === 200);

  await stop();
  const health2 = await launch();
  step("关闭后重新启动成功", health2.app === "whiteboard-local");

  const detail = await api(`/api/boards/${boardId}`);
  step("重启后白板与场景仍在", detail.status === 200 && detail.payload.scene.elements.length === 2,
    `elements=${detail.payload?.scene?.elements?.length}`);
  step("重启后图片资源仍在", (await fetch(`${BASE}/assets/e2e-img`)).status === 200);

  const stale = await api(`/api/boards/${boardId}/scene`, {
    method: "PUT",
    body: JSON.stringify({ owner, revision: 1, scene: { elements: [], appState: {} }, files: {} }),
  });
  step("重启后旧租约失效，写请求被拒（不会误覆盖）", stale.status === 423, `status=${stale.status}`);

  const crossOrigin = await fetch(`${BASE}/api/boards`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://evil.example" },
    body: "{}",
  });
  step("拒绝陌生 Origin 的写入", crossOrigin.status === 403, `status=${crossOrigin.status}`);

  // 清理验证数据，避免污染用户目录
  await api(`/api/boards/${boardId}/lease`, { method: "POST", body: JSON.stringify({ owner }) });
  const removed = await api(`/api/boards/${boardId}`, { method: "DELETE", body: JSON.stringify({ owner }) });
  step("清理验证白板（移入 data/trash）", removed.status === 200);
  const trash = readdirSync(path.join(health.dataDir, "trash")).filter((n) => n.startsWith(boardId));
  step("删除是软删除，可在 data/trash 找回", trash.length === 1);

  // 断言完了就把软删除产生的垃圾彻底清掉——验证脚本不该给用户留下任何东西。
  // 上面的「软删除可找回」已经证明过行为，这里删的是我们自己刚造出来的那几份。
  const swept = [];
  for (const name of trash) {
    rmSync(path.join(health.dataDir, "trash", name), { force: true });
    swept.push(`trash/${name}`);
  }
  const assetFile = path.join(health.dataDir, "assets", "e2e-img.png");
  if (existsSync(assetFile)) {
    rmSync(assetFile, { force: true });
    swept.push("assets/e2e-img.png");
  }
  const backupFile = path.join(health.dataDir, "backups", `${boardId}.json`);
  if (existsSync(backupFile)) {
    rmSync(backupFile, { force: true });
    swept.push(`backups/${boardId}.json`);
  }
  step("验证产生的临时文件已全部清掉", true, swept.join(", ") || "无");
} catch (error) {
  step("端到端流程", false, error.message);
} finally {
  await stop();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) {
  console.log("失败项：");
  for (const f of failed) console.log(`  - ${f.name}${f.note ? `（${f.note}）` : ""}`);
  process.exitCode = 1;
}
