// 服务端行为测试：数据安全（原子写 / 备份 / 图片共享）、租约与版本冲突、请求校验。
// 运行：node --test tests/    （或 npm run check）
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { createLocalServer } = require(path.join(ROOT, "server", "server.cjs"));
// 引擎侧（构建期补丁）的图片上限。服务端必须与它保持一致，否则会出现
// 「画布接受、保存失败」的割裂体验 —— 这里把两个数字绑在同一个断言上。
const { MAX_IMAGE_BYTES } = await import("../scripts/excalidraw-patch.mjs");

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const imageFile = (id) => ({ id, mimeType: "image/png", dataURL: `data:image/png;base64,${PNG_1PX}`, created: 1 });
const imageElement = (fileId) => ({ id: "el-1", type: "image", fileId, isDeleted: false, version: 1 });
/** 假的 woff2 字节：服务端只做别名与透传，不解析字体。 */
const FONT_BYTES = Buffer.from("wOF2wb-font-fixture", "ascii");

let workspace;
let app;
let base;
let dataDir;
let distDir;

async function start() {
  app = createLocalServer({ dataDir, distDir, port: 0, noOpen: true, logger: { log() {}, error() {} } });
  const started = await app.start();
  base = started.url.replace(/\/$/, "");
  return started;
}

async function api(pathname, { method = "GET", body, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    init.headers["content-type"] ??= "application/json";
  }
  const response = await fetch(`${base}${pathname}`, init);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = text;
  }
  return { status: response.status, payload, headers: response.headers };
}

/** 直接发原始请求，用于构造非法 Host / Origin / Content-Type 等边界。 */
function raw(pathname, { method = "GET", host, origin, contentType, body } = {}) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: pathname,
        method,
        headers: {
          ...(host ? { host } : {}),
          ...(origin ? { origin } : {}),
          ...(contentType ? { "content-type": contentType } : {}),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, text }));
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function createBoard(name = "测试白板") {
  const { status, payload } = await api("/api/boards", { method: "POST", body: { name } });
  assert.equal(status, 201);
  return payload;
}

async function saveScene(id, owner, revision, scene, files = {}) {
  return api(`/api/boards/${id}/scene`, { method: "PUT", body: { owner, revision, scene, files } });
}

before(async () => {
  workspace = mkdtempSync(path.join(os.tmpdir(), "whiteboard-test-"));
  dataDir = path.join(workspace, "data");
  distDir = path.join(workspace, "dist");
  writeFileSync(path.join(workspace, "keep.txt"), "placeholder", "utf8");
  mkdirSync(distDir, { recursive: true });
  // 夹具必须是含真实 <html> 元素的最小文档：服务器要在 <html> 上注入 data-theme /
  // data-theme-pref（见 server.cjs 的 injectTheme），没有 <html> 就无从注入。
  writeFileSync(
    path.join(distDir, "index.html"),
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>ok</title></head>' +
      '<body><div id="root"></div></body></html>',
    "utf8",
  );
  mkdirSync(path.join(distDir, "static"), { recursive: true });
  writeFileSync(path.join(distDir, "static", "app.js"), "console.log(1)", "utf8");
  // 字体别名所需的构建产物：映射表 + 普惠体文件（内容不参与校验，只看字节是否原样返回）
  mkdirSync(path.join(distDir, "fonts", "puhuiti"), { recursive: true });
  writeFileSync(path.join(distDir, "fonts", "puhuiti", "regular.woff2"), FONT_BYTES);
  writeFileSync(
    path.join(distDir, "font-map.json"),
    JSON.stringify({
      weights: { regular: "fonts/puhuiti/regular.woff2" },
      families: { Virgil: "regular", ExcalidrawFont: "regular" },
      fallback: "regular",
    }),
    "utf8",
  );
  await start();
});

after(async () => {
  await app?.close();
  rmSync(workspace, { recursive: true, force: true });
});

describe("基础契约", () => {
  it("health 报告应用标识与数据目录", async () => {
    const { status, payload } = await api("/api/health");
    assert.equal(status, 200);
    assert.equal(payload.app, "whiteboard-local");
    assert.equal(payload.dataDir, dataDir);
    assert.equal(payload.sea, false);
    assert.equal(payload.offline, true);
    assert.equal(payload.fontAlias, true, "字体映射表就位时应报告已启用别名");
  });

  it("所有数据都落在同一个 data 目录内", async () => {
    const board = await createBoard();
    await api(`/api/boards/${board.id}`, { method: "PUT", body: { name: "改名" } });
    for (const dir of ["boards", "assets", "backups", "trash"]) {
      assert.ok(readdirSync(path.join(dataDir, dir)) !== undefined, `${dir} 应存在于 data 目录内`);
    }
    assert.equal(readdirSync(workspace).filter((n) => n !== "data" && n !== "dist" && n !== "keep.txt").length, 0);
  });

  it("新建的白板可以列表、读取、重命名", async () => {
    const board = await createBoard("灵感板");
    const list = await api("/api/boards");
    assert.ok(list.payload.some((b) => b.id === board.id));
    const detail = await api(`/api/boards/${board.id}`);
    assert.equal(detail.payload.name, "灵感板");
    assert.equal(detail.payload.revision, 0);
    assert.deepEqual(detail.payload.scene.elements, []);
    const renamed = await api(`/api/boards/${board.id}`, { method: "PUT", body: { name: "灵感板 2" } });
    assert.equal(renamed.payload.name, "灵感板 2");
  });

  it("元数据接口拒绝未知字段（scene 只能走 /scene）", async () => {
    const board = await createBoard();
    const bad = await api(`/api/boards/${board.id}`, {
      method: "PUT",
      body: { name: "x", scene: { elements: [], appState: {} } },
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.payload.code, "INVALID_FIELDS");
  });

  it("非法 id、非法路径与非法 JSON 都被拒绝", async () => {
    assert.equal((await api("/api/boards/..%2f..%2fetc")).status, 400);
    assert.equal((await api("/api/boards/ok", { method: "PUT", body: "{" })).status, 400);
    assert.equal((await api("/api/boards/ok", { method: "PUT", body: "[]" })).status, 400);
    const invalid = await api("/api/boards/a%20b", { method: "PUT", body: { name: "x" } });
    assert.equal(invalid.status, 400);
  });

  it("写操作必须是 application/json，且拒绝跨站请求", async () => {
    const board = await createBoard();
    const noType = await raw(`/api/boards/${board.id}`, { method: "PUT", contentType: "text/plain", body: "{}" });
    assert.equal(noType.status, 415);
    const crossSite = await raw(`/api/boards/${board.id}`, {
      method: "PUT",
      contentType: "application/json",
      origin: "http://evil.example",
      body: "{}",
    });
    assert.equal(crossSite.status, 403);
  });

  it("Host 必须是本地地址，防 DNS rebinding", async () => {
    const rebound = await raw("/api/health", { host: "evil.example" });
    assert.equal(rebound.status, 403);
  });

  it("静态资源托管 index.html 且未知路径回退到入口", async () => {
    const root = await fetch(`${base}/`);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /ok/);
    const fallback = await fetch(`${base}/board/anything`);
    assert.equal(fallback.status, 200);
    const asset = await fetch(`${base}/static/app.js`);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get("x-content-type-options"), "nosniff");
  });
});

describe("场景保存", () => {
  it("租约 + revision 递增保存，并同步落盘图片", async () => {
    const board = await createBoard();
    const owner = "owner-a";
    const lease = await api(`/api/boards/${board.id}/lease`, { method: "POST", body: { owner } });
    assert.equal(lease.status, 200);
    assert.equal(lease.payload.owner, owner);
    assert.ok(lease.payload.expiresAt > Date.now());

    const saved = await saveScene(
      board.id,
      owner,
      0,
      { elements: [imageElement("img-1")], appState: { viewBackgroundColor: "#fff" } },
      { "img-1": imageFile("img-1") },
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.payload.revision, 1);
    assert.equal(saved.payload.elementCount, 1);

    const files = readdirSync(path.join(dataDir, "assets"));
    assert.ok(files.includes("img-1.png"), `assets 应包含 img-1.png，实际：${files.join(",")}`);

    const detail = await api(`/api/boards/${board.id}`);
    assert.deepEqual(detail.payload.assets.map((a) => a.id), ["img-1"]);
    assert.equal(detail.payload.scene.elements.length, 1);
    assert.equal(detail.payload.revision, 1);

    const fetched = await fetch(`${base}/assets/img-1`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), Buffer.from(PNG_1PX, "base64"));
  });

  it("过期 revision 返回 409，不覆盖已保存内容", async () => {
    const board = await createBoard();
    const owner = "owner-b";
    await api(`/api/boards/${board.id}/lease`, { method: "POST", body: { owner } });
    assert.equal((await saveScene(board.id, owner, 0, { elements: [], appState: {} })).status, 200);
    const stale = await saveScene(board.id, owner, 0, { elements: [], appState: {} });
    assert.equal(stale.status, 409);
    assert.equal(stale.payload.code, "REVISION_CONFLICT");
    assert.equal((await api(`/api/boards/${board.id}`)).payload.revision, 1);
  });

  it("没有租约、或租约属于别人时不能写场景", async () => {
    const board = await createBoard();
    const noLease = await saveScene(board.id, "owner-c", 0, { elements: [], appState: {} });
    assert.equal(noLease.status, 423);

    const other = await createBoard();
    await api(`/api/boards/${other.id}/lease`, { method: "POST", body: { owner: "owner-d" } });
    const conflict = await api(`/api/boards/${other.id}/lease`, { method: "POST", body: { owner: "owner-e" } });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.payload.code, "LEASE_CONFLICT");
    const stolen = await saveScene(other.id, "owner-e", 0, { elements: [], appState: {} });
    assert.equal(stolen.status, 423);
  });

  it("场景引用未登记的图片时拒绝保存（避免丢图）", async () => {
    const board = await createBoard();
    const owner = "owner-f";
    await api(`/api/boards/${board.id}/lease`, { method: "POST", body: { owner } });
    const missing = await saveScene(board.id, owner, 0, { elements: [imageElement("img-missing")], appState: {} });
    assert.equal(missing.status, 400);
    assert.equal(missing.payload.code, "MISSING_ASSET");
    assert.equal((await api(`/api/boards/${board.id}`)).payload.revision, 0);
  });

  it("非法 base64 与伪造签名的图片被拒绝", async () => {
    const board = await createBoard();
    const owner = "owner-g";
    await api(`/api/boards/${board.id}/lease`, { method: "POST", body: { owner } });
    const badBase64 = await saveScene(board.id, owner, 0, { elements: [imageElement("img-2")], appState: {} }, {
      "img-2": { id: "img-2", mimeType: "image/png", dataURL: "data:image/png;base64,!!!!", created: 1 },
    });
    assert.equal(badBase64.status, 400);

    const fakePng = Buffer.from("not a png at all").toString("base64");
    const badSignature = await saveScene(board.id, owner, 0, { elements: [imageElement("img-3")], appState: {} }, {
      "img-3": { id: "img-3", mimeType: "image/png", dataURL: `data:image/png;base64,${fakePng}`, created: 1 },
    });
    assert.equal(badSignature.status, 400);
    assert.equal(badSignature.payload.code, "INVALID_IMAGE_SIGNATURE");
  });

  it("同一 fileId 不能对应不同内容（防止跨板图片互相污染）", async () => {
    const board = await createBoard();
    const owner = "owner-h";
    await api(`/api/boards/${board.id}/lease`, { method: "POST", body: { owner } });
    await saveScene(board.id, owner, 0, { elements: [imageElement("img-shared")], appState: {} }, {
      "img-shared": imageFile("img-shared"),
    });
    const otherPng = Buffer.from(PNG_1PX, "base64").subarray(0, 40).toString("base64");
    const collision = await saveScene(board.id, owner, 1, { elements: [imageElement("img-shared")], appState: {} }, {
      "img-shared": { id: "img-shared", mimeType: "image/png", dataURL: `data:image/png;base64,${otherPng}`, created: 1 },
    });
    assert.equal(collision.status, 409);
    assert.equal(collision.payload.code, "ASSET_CONFLICT");
  });
});

describe("多白板共享图片与删除", () => {
  it("复制白板后删除原板，副本的图片仍然可读", async () => {
    const source = await createBoard("原板");
    const owner = "owner-i";
    await api(`/api/boards/${source.id}/lease`, { method: "POST", body: { owner } });
    await saveScene(source.id, owner, 0, { elements: [imageElement("img-copy")], appState: {} }, {
      "img-copy": imageFile("img-copy"),
    });
    await api(`/api/boards/${source.id}/lease`, { method: "DELETE", body: { owner } });

    const copy = await api(`/api/boards/${source.id}/duplicate`, { method: "POST", body: {} });
    assert.equal(copy.status, 201);
    assert.notEqual(copy.payload.id, source.id);

    const deleted = await api(`/api/boards/${source.id}`, { method: "DELETE", body: { owner: "owner-i" } });
    assert.equal(deleted.status, 200);

    const stillThere = await fetch(`${base}/assets/img-copy`);
    assert.equal(stillThere.status, 200, "被副本共享的图片不能在删除原板时被清理");
    const copyDetail = await api(`/api/boards/${copy.payload.id}`);
    assert.deepEqual(copyDetail.payload.assets.map((a) => a.id), ["img-copy"]);
  });

  it("正在被其他 owner 编辑时不能删除", async () => {
    const board = await createBoard();
    await api(`/api/boards/${board.id}/lease`, { method: "POST", body: { owner: "owner-j" } });
    const blocked = await api(`/api/boards/${board.id}`, { method: "DELETE", body: { owner: "owner-k" } });
    assert.equal(blocked.status, 423);
    const allowed = await api(`/api/boards/${board.id}`, { method: "DELETE", body: { owner: "owner-j" } });
    assert.equal(allowed.status, 200);
    assert.equal((await api(`/api/boards/${board.id}`)).status, 404);
  });

  it("删除是移入 data/trash，不是直接抹掉", async () => {
    const board = await createBoard("待删");
    await api(`/api/boards/${board.id}`, { method: "DELETE", body: { owner: "owner-l" } });
    const trashed = readdirSync(path.join(dataDir, "trash")).filter((n) => n.startsWith(board.id));
    assert.equal(trashed.length, 1, "删除的白板应可在 data/trash 中找到");
  });
});

describe("损坏与恢复", () => {
  it("白板 JSON 损坏时报错而不是静默消失", async () => {
    const board = await createBoard("会损坏");
    writeFileSync(path.join(dataDir, "boards", `${board.id}.json`), "{ not json", "utf8");
    const list = await api("/api/boards");
    assert.equal(list.status, 500);
    assert.equal(list.payload.code, "BOARD_CORRUPT");
    rmSync(path.join(dataDir, "boards", `${board.id}.json`), { force: true });
  });

  it("保存会留下上一份备份，可恢复到上一版本", async () => {
    const board = await createBoard("可恢复");
    const owner = "owner-m";
    await api(`/api/boards/${board.id}/lease`, { method: "POST", body: { owner } });
    await saveScene(board.id, owner, 0, { elements: [imageElement("img-r")], appState: {} }, {
      "img-r": imageFile("img-r"),
    });
    const backupFile = path.join(dataDir, "backups", `${board.id}.json`);
    const backup = JSON.parse(readFileSync(backupFile, "utf8"));
    assert.equal(backup.revision, 0, "备份应是保存前的上一版本");
    assert.deepEqual(backup.scene.elements, []);

    await api(`/api/boards/${board.id}/lease`, { method: "DELETE", body: { owner } });
    const restored = await api(`/api/boards/${board.id}/restore`, { method: "POST", body: { owner } });
    assert.equal(restored.status, 200);
    assert.equal(restored.payload.revision, 2, "恢复后 revision 必须继续递增，避免旧标签覆盖");
    assert.deepEqual(restored.payload.scene.elements, []);
  });
});

describe("纯本地：字体别名与联网门禁", () => {
  it("引擎的家族字体请求被别名到本地普惠体，不回退外网", async () => {
    const alias = await fetch(`${base}/fonts/Virgil/abc123.woff2`);
    assert.equal(alias.status, 200);
    assert.equal(alias.headers.get("content-type"), "font/woff2");
    assert.deepEqual(Buffer.from(await alias.arrayBuffer()), FONT_BYTES);

    const real = await fetch(`${base}/fonts/puhuiti/regular.woff2`);
    assert.equal(real.status, 200);
    assert.deepEqual(Buffer.from(await real.arrayBuffer()), FONT_BYTES);
  });

  it("未知字体家族也落到本地回退字重，而不是外网", async () => {
    const unknown = await fetch(`${base}/fonts/NoSuchFamily/x.woff2`);
    assert.equal(unknown.status, 200);
    assert.deepEqual(Buffer.from(await unknown.arrayBuffer()), FONT_BYTES);
  });

  it("HTML 下发 CSP：禁止一切外网连接与 iframe", async () => {
    const page = await fetch(`${base}/`);
    const csp = page.headers.get("content-security-policy") ?? "";
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /connect-src 'self'/);
    assert.match(csp, /font-src 'self'/);
    assert.match(csp, /frame-src 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /form-action 'none'/);
    const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
    assert.ok(scriptSrc && !scriptSrc.includes("unsafe-inline"), "script-src 不得放开内联脚本");
    assert.equal(page.headers.get("referrer-policy"), "no-referrer");

    // 文档级策略只挂在 HTML 上，静态资源不重复下发
    const asset = await fetch(`${base}/static/app.js`);
    assert.equal(asset.headers.get("content-security-policy"), null);
  });

  it("缺失的静态资源返回 404，只有页面路由才回退到入口", async () => {
    assert.equal((await fetch(`${base}/static/nope.js`)).status, 404);
    assert.equal((await fetch(`${base}/fonts/Virgil`)).status, 404);
    assert.equal((await fetch(`${base}/board/anything`)).status, 200);
  });
});

describe("个人素材库（data/library.json）", () => {
  it("初始为空，保存后可读回，文件落在 data 目录内", async () => {
    const empty = await api("/api/library");
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.payload, { libraryItems: [] });

    const items = [{ id: "lib-1", status: "unpublished", created: 1, elements: [{ id: "e1" }] }];
    const saved = await api("/api/library", { method: "PUT", body: { libraryItems: items } });
    assert.equal(saved.status, 200);
    assert.equal(saved.payload.count, 1);

    const read = await api("/api/library");
    assert.deepEqual(read.payload.libraryItems, items);
    assert.ok(readdirSync(dataDir).includes("library.json"), "素材库应直接放在 data 目录内");
  });

  it("每次保存都留下上一份备份", async () => {
    const first = [{ id: "lib-a", elements: [] }];
    const second = [{ id: "lib-b", elements: [] }];
    await api("/api/library", { method: "PUT", body: { libraryItems: first } });
    await api("/api/library", { method: "PUT", body: { libraryItems: second } });
    const backup = JSON.parse(readFileSync(path.join(dataDir, "backups", "library.json"), "utf8"));
    assert.deepEqual(backup.libraryItems, first);
  });

  it("拒绝非法结构与未知字段", async () => {
    assert.equal((await api("/api/library", { method: "PUT", body: { libraryItems: {} } })).status, 400);
    assert.equal((await api("/api/library", { method: "PUT", body: { libraryItems: [{}] } })).status, 400);
    assert.equal((await api("/api/library", { method: "PUT", body: { items: [] } })).status, 400);
    assert.equal((await api("/api/library", { method: "POST", body: {} })).status, 404);
  });

  it("素材库 JSON 损坏时报错而不是静默清空", async () => {
    writeFileSync(path.join(dataDir, "library.json"), "{ not json", "utf8");
    const broken = await api("/api/library");
    assert.equal(broken.status, 500);
    assert.equal(broken.payload.code, "LIBRARY_CORRUPT");
    // 还原成合法内容，避免影响后续用例
    writeFileSync(path.join(dataDir, "library.json"), JSON.stringify({ libraryItems: [] }), "utf8");
  });
});

describe("界面偏好（data/prefs.json）与首屏主题注入", () => {
  it("默认跟随系统，写入后可读回，且落在 data 目录内", async () => {
    const empty = await api("/api/prefs");
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.payload, { theme: "system" });

    for (const theme of ["light", "dark", "system"]) {
      const saved = await api("/api/prefs", { method: "PUT", body: { theme } });
      assert.equal(saved.status, 200, `写入 ${theme} 应成功`);
      assert.equal(saved.payload.theme, theme);
      assert.deepEqual((await api("/api/prefs")).payload, { theme });
    }
    assert.ok(readdirSync(dataDir).includes("prefs.json"), "偏好应直接放在 data 目录内");
  });

  it("拒绝非法取值、未知字段与其它方法", async () => {
    const bad = await api("/api/prefs", { method: "PUT", body: { theme: "blue" } });
    assert.equal(bad.status, 400);
    assert.equal(bad.payload.code, "INVALID_PREFS");
    assert.equal((await api("/api/prefs", { method: "PUT", body: { mode: "dark" } })).status, 400);
    assert.equal((await api("/api/prefs", { method: "POST", body: { theme: "dark" } })).status, 404);
    // 非法写入不能污染已保存的值
    assert.deepEqual((await api("/api/prefs")).payload, { theme: "system" });
  });

  it("把偏好注入到 index.html 的 <html> 上（不依赖 localStorage）", async () => {
    const readHtml = async () => (await fetch(`${base}/`)).text();

    await api("/api/prefs", { method: "PUT", body: { theme: "dark" } });
    const dark = await readHtml();
    assert.match(dark, /<html[^>]*data-theme="dark"[^>]*data-theme-pref="dark"/, "深色应写成显式 data-theme");

    await api("/api/prefs", { method: "PUT", body: { theme: "light" } });
    assert.match(await readHtml(), /<html[^>]*data-theme="light"/, "浅色应写成显式 data-theme");

    await api("/api/prefs", { method: "PUT", body: { theme: "system" } });
    const system = await readHtml();
    assert.match(system, /<html[^>]*data-theme-pref="system"/, "跟随系统只写 pref，由前端解析");
    assert.ok(!/data-theme="(light|dark)"/.test(system), "跟随系统不应写死 data-theme");
    // 不能重复注入
    assert.equal(system.match(/data-theme-pref=/g).length, 1, "data-theme-pref 只能出现一次");
  });

  it("偏好 JSON 损坏时报错而不是静默回落到系统主题", async () => {
    writeFileSync(path.join(dataDir, "prefs.json"), "{ not json", "utf8");
    const broken = await api("/api/prefs");
    assert.equal(broken.status, 500);
    assert.equal(broken.payload.code, "PREFS_CORRUPT");
    // 损坏时首屏注入要能兜底（不能因为读不出偏好而整个页面 500）
    assert.equal((await fetch(`${base}/`)).status, 200);
    writeFileSync(path.join(dataDir, "prefs.json"), JSON.stringify({ theme: "system" }), "utf8");
  });
});

describe("图片与请求体体积上限", () => {
  it("health 报告的上限与引擎补丁一致（都是 64MiB）", async () => {
    const { payload } = await api("/api/health");
    // 与 scripts/excalidraw-patch.mjs 的 MAX_IMAGE_BYTES 同源，避免两处数字各自漂移
    assert.equal(payload.imageLimit, MAX_IMAGE_BYTES, "服务端图片上限必须与引擎补丁一致");
    assert.equal(payload.imageLimit, 64 * 1024 * 1024);
    assert.equal(payload.bodyLimit, 256 * 1024 * 1024);
    assert.ok(
      payload.bodyLimit > payload.imageLimit,
      "请求体上限必须大于图片上限：图片以 base64 内联，会膨胀约 4/3"
    );
  });

  it("接受 4MiB 以上的图片（旧上限会拒掉）", async () => {
    const board = await createBoard("大图");
    const owner = "owner-big";
    await api(`/api/boards/${board.id}/lease`, { method: "POST", body: { owner } });
    // 5MiB 的 PNG 头 + 填充：服务端只校验签名与大小，不解析像素
    const big = Buffer.alloc(5 * 1024 * 1024);
    Buffer.from(PNG_1PX, "base64").copy(big);
    const dataURL = `data:image/png;base64,${big.toString("base64")}`;
    const saved = await saveScene(board.id, owner, 0, { elements: [imageElement("img-big")], appState: {} }, {
      "img-big": { id: "img-big", mimeType: "image/png", dataURL, created: 1 },
    });
    assert.equal(saved.status, 200, `5MiB 图片应被接受：${JSON.stringify(saved.payload)}`);
  });
});

describe("重启后数据仍在", () => {
  it("关闭并重新启动服务，白板与图片都可读", async () => {
    const board = await createBoard("持久化");
    const owner = "owner-n";
    await api(`/api/boards/${board.id}/lease`, { method: "POST", body: { owner } });
    const saved = await saveScene(board.id, owner, 0, { elements: [imageElement("img-p")], appState: {} }, {
      "img-p": imageFile("img-p"),
    });
    assert.equal(saved.status, 200);
    await app.close();

    await start();
    const detail = await api(`/api/boards/${board.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.payload.revision, 1);
    assert.deepEqual(detail.payload.assets.map((a) => a.id), ["img-p"]);
    assert.equal((await fetch(`${base}/assets/img-p`)).status, 200);
    // 重启后租约失效，必须重新申请
    assert.equal((await saveScene(board.id, owner, 1, { elements: [], appState: {} })).status, 423);
  });
});
