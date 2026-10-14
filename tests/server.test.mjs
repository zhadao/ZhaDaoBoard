import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const serverPath = fileURLToPath(new URL("../prototype/server/server.cjs", import.meta.url));
const { createLocalServer } = require(serverPath);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT4sAAAAASUVORK5CYII=", "base64");
const IMAGE_LIMIT = 32 * 1024 * 1024;
const BODY_LIMIT = 128 * 1024 * 1024;

function request(port, route, { method = "GET", body, raw, headers = {} } = {}) {
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1", port, path: route, method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(payload === undefined ? {} : { "content-length": Buffer.byteLength(payload) }),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => {
        const bytes = Buffer.concat(chunks);
        const text = bytes.toString("utf8");
        let data;
        try { data = JSON.parse(text); } catch { data = text; }
        resolve({ status: res.statusCode, headers: res.headers, data, bytes });
      });
    });
    req.on("error", reject);
    req.end(payload);
  });
}

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "whiteboard-server-test-"));
  const dataDir = path.join(root, "data");
  const distDir = path.join(root, "dist");
  await fs.mkdir(distDir);
  await fs.writeFile(path.join(distDir, "index.html"), "<!doctype html><title>测试白板</title>");
  const logs = [];
  const apps = [];
  async function launch(extra = {}) {
    const app = createLocalServer({
      dataDir, distDir, port: 0, noOpen: true,
      logger: { log: (...args) => logs.push(args), error: (...args) => logs.push(args) },
      ...options, ...extra,
    });
    apps.push(app);
    const info = await app.start();
    return { app, ...info, api: (route, opts) => request(info.port, route, opts) };
  }
  t.after(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, dataDir, distDir, logs, launch, ...await launch() };
}
async function create(api, name = "测试白板") {
  const res = await api("/api/boards", { method: "POST", body: { name } });
  assert.equal(res.status, 201);
  return res.data;
}
function image(id, buffer = png, mimeType = "image/png") {
  return { id, mimeType, dataURL: `data:${mimeType};base64,${buffer.toString("base64")}`, created: 1 };
}
function scene(owner, revision, elements = [], files = {}) {
  return { owner, revision, scene: { elements, appState: {} }, files };
}
function imageElement(fileId, extra = {}) {
  return { id: `element_${fileId}`, type: "image", fileId, isDeleted: false, ...extra };
}
async function lease(api, id, owner = "editor-a") {
  const res = await api(`/api/boards/${id}/lease`, { method: "POST", body: { owner } });
  assert.equal(res.status, 200);
  return res.data;
}
async function save(api, id, body) {
  return api(`/api/boards/${id}/scene`, { method: "PUT", body });
}

// 所有数据及dist均置于系统临时目录，绝不访问用户的真实白板数据。
test("导入不启动；健康检查、CRUD、元数据与重启持久化", async (t) => {
  const f = await fixture(t);
  assert.equal(f.app.server.address().address, "127.0.0.1");
  const health = await f.api("/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.data.app, "whiteboard-local");
  assert.equal(health.data.version, "0.3.0");
  assert.equal(health.data.dataDir, f.dataDir);
  assert.equal(health.data.port, f.port);
  assert.equal(health.data.leaseMs, 45_000);
  assert.equal(health.data.bodyLimit, BODY_LIMIT);
  assert.equal(health.data.imageLimit, IMAGE_LIMIT);
  assert.equal(health.headers["x-content-type-options"], "nosniff");
  const board = await create(f.api, "  第一块  ");
  assert.equal(board.name, "第一块");
  assert.equal(board.revision, 0);
  const renamed = await f.api(`/api/boards/${board.id}`, {
    method: "PUT", body: { name: "改名", thumbnail: "data:image/png;base64,test", elementCount: 2 },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.name, "改名");
  assert.equal(renamed.data.revision, 0);
  assert.equal((await f.api("/api/boards")).data[0].elementCount, 2);
  assert.equal((await f.api("/api/boards")).data[0].scene, undefined);
  assert.equal((await f.api(`/api/boards/${board.id}`, { method: "PUT", body: { scene: { elements: [], appState: {} } } })).status, 400);
  assert.equal((await f.api(`/api/boards/${board.id}`, { method: "PUT", body: { assets: [] } })).status, 400);
  const copy = await f.api(`/api/boards/${board.id}/duplicate`, { method: "POST", body: {} });
  assert.equal(copy.status, 201);
  assert.notEqual(copy.data.id, board.id);
  assert.equal(copy.data.name, "改名 副本");
  await f.app.close();
  const restarted = await f.launch();
  assert.equal((await restarted.api(`/api/boards/${board.id}`)).data.name, "改名");
  assert.equal((await restarted.api("/api/boards")).data.length, 2);
  assert.equal((await restarted.api(`/api/boards/${board.id}`, { method: "DELETE", body: {} })).status, 200);
  assert.equal((await restarted.api(`/api/boards/${board.id}`)).status, 404);
  const trash = await fs.readdir(path.join(f.dataDir, "trash"));
  assert.equal(trash.length, 1);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.dataDir, "trash", trash[0]), "utf8")).name, "改名");
  assert.equal((await restarted.api(`/api/boards/${copy.data.id}`)).status, 200);
});

test("旧boardJSON默认revision=0，正常提交后持久化revision", async (t) => {
  const f = await fixture(t);
  const board = await create(f.api);
  delete board.revision;
  await fs.writeFile(path.join(f.dataDir, "boards", `${board.id}.json`), JSON.stringify(board));
  assert.equal((await f.api(`/api/boards/${board.id}`)).data.revision, 0);
  assert.equal((await f.api("/api/boards")).data[0].revision, 0);
  await lease(f.api, board.id);
  const result = await save(f.api, board.id, scene("editor-a", 0, [{ id: "text", type: "text" }]));
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.data).sort(), ["elementCount", "revision", "updatedAt"]);
  assert.equal(result.data.revision, 1);
  assert.equal(result.data.elementCount, 1);
  await f.app.close();
  const restarted = await f.launch();
  const stored = await restarted.api(`/api/boards/${board.id}`);
  assert.equal(stored.data.revision, 1);
  assert.equal(stored.data.scene.elements.length, 1);
  assert.equal((await save(restarted.api, board.id, scene("editor-a", 1))).status, 423);
});

test("lease获取/续期/释放/过期、owner校验和CAS并发冲突", async (t) => {
  let time = 1000;
  const f = await fixture(t, { now: () => time });
  const board = await create(f.api);
  const route = `/api/boards/${board.id}/lease`;
  for (const owner of [undefined, "", "   ", 42, "x".repeat(257)]) {
    assert.equal((await f.api(route, { method: "POST", body: { owner } })).status, 400);
    assert.equal((await f.api(route, { method: "DELETE", body: { owner } })).status, 400);
  }
  assert.equal((await save(f.api, board.id, scene("editor-a", 0))).status, 423);
  const acquired = await lease(f.api, board.id);
  assert.deepEqual(acquired, { owner: "editor-a", expiresAt: 46_000 });
  assert.equal((await f.api(route, { method: "POST", body: { owner: "editor-b" } })).status, 409);
  assert.equal((await f.api(route, { method: "DELETE", body: { owner: "editor-b" } })).status, 409);
  assert.equal((await save(f.api, board.id, scene("editor-b", 0))).status, 423);
  time = 2000;
  assert.equal((await lease(f.api, board.id)).expiresAt, 47_000);
  const concurrent = await Promise.all([
    save(f.api, board.id, scene("editor-a", 0, [{ id: "a", type: "text" }])),
    save(f.api, board.id, scene("editor-a", 0, [{ id: "b", type: "text" }])),
  ]);
  assert.deepEqual(concurrent.map((res) => res.status).sort(), [200, 409]);
  assert.equal(concurrent.find((res) => res.status === 409).data.revision, 1);
  assert.equal((await save(f.api, board.id, scene("editor-a", 0))).status, 409);
  assert.equal((await f.api(`/api/boards/${board.id}`, { method: "DELETE", body: {} })).status, 423);
  time = 47_000;
  assert.equal((await save(f.api, board.id, scene("editor-a", 1))).status, 423);
  await lease(f.api, board.id, "editor-b");
  assert.equal((await save(f.api, board.id, scene("editor-a", 1))).status, 423);
  const released = await f.api(route, { method: "DELETE", body: { owner: "editor-b" } });
  assert.deepEqual(released.data, { owner: "editor-b", expiresAt: 0 });
  assert.equal((await save(f.api, board.id, scene("editor-b", 1))).status, 423);
  await lease(f.api, board.id);
  assert.equal((await save(f.api, board.id, scene("editor-a", 1))).status, 200);
});

test("跨板复制/删除/删除元素不丢共享图片，同id相同内容可复用、不同内容拒绝", async (t) => {
  const f = await fixture(t);
  const original = await create(f.api);
  await lease(f.api, original.id);
  const elements = [imageElement("shared")];
  assert.equal((await save(f.api, original.id, scene("editor-a", 0, elements, { shared: image("shared") }))).status, 200);
  const originalBytes = await f.api("/assets/shared");
  assert.equal(originalBytes.status, 200);
  assert.deepEqual(originalBytes.bytes, png);
  const duplicated = await f.api(`/api/boards/${original.id}/duplicate`, { method: "POST", body: {} });
  const copy = duplicated.data;
  assert.equal(copy.assets[0].id, "shared");
  assert.equal(copy.revision, 0);
  assert.equal((await f.api(`/api/boards/${original.id}`, { method: "DELETE", body: { owner: "editor-a" } })).status, 200);
  assert.deepEqual((await f.api("/assets/shared")).bytes, png);
  await lease(f.api, copy.id);
  assert.equal((await save(f.api, copy.id, scene("editor-a", 0, elements))).status, 200);
  assert.equal((await save(f.api, copy.id, scene("editor-a", 1, [imageElement("shared", { isDeleted: true })]))).status, 200);
  const pruned = (await f.api(`/api/boards/${copy.id}`)).data;
  assert.deepEqual(pruned.assets, []);
  assert.equal(pruned.elementCount, 0);
  assert.deepEqual((await f.api("/assets/shared")).bytes, png);
  assert.equal((await save(f.api, copy.id, scene("editor-a", 2, elements))).status, 400);
  assert.equal((await save(f.api, copy.id, scene("editor-a", 2, elements, { shared: image("shared") }))).status, 200);
  const another = await create(f.api);
  await lease(f.api, another.id);
  const altered = Buffer.concat([png, Buffer.from("different")]);
  const conflict = await save(f.api, another.id, scene("editor-a", 0, elements, { shared: image("shared", altered) }));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.code, "ASSET_CONFLICT");
  assert.equal((await f.api(`/api/boards/${another.id}`)).data.revision, 0);
  assert.equal((await save(f.api, another.id, scene("editor-a", 0, elements, { shared: image("shared") }))).status, 200);
  if (process.platform === "win32") {
    const alias = await save(f.api, another.id, scene("editor-a", 1, [imageElement("SHARED")], { SHARED: image("SHARED", altered) }));
    assert.equal(alias.status, 409);
    const sameBatch = await save(f.api, another.id, scene("editor-a", 1, [imageElement("batch"), imageElement("BATCH")], {
      batch: image("batch"), BATCH: image("BATCH", altered),
    }));
    assert.equal(sameBatch.status, 409);
    assert.deepEqual((await f.api("/assets/shared")).bytes, png);
  }
  const files = await fs.readdir(path.join(f.dataDir, "assets"));
  assert.deepEqual(files, ["shared.png"]);
  assert.equal((await f.api(`/api/boards/${copy.id}`, { method: "DELETE", body: { owner: "editor-a" } })).status, 200);
  assert.equal((await f.api(`/api/boards/${another.id}`, { method: "DELETE", body: { owner: "editor-a" } })).status, 200);
  await f.app.close();
  const restarted = await f.launch();
  assert.deepEqual((await restarted.api("/assets/shared")).bytes, png);
});

test("未引用的新files仍安全入库但不登记到板内assets，引用时需重新登记", async (t) => {
  const f = await fixture(t);
  const board = await create(f.api);
  await lease(f.api, board.id);
  assert.equal((await save(f.api, board.id, scene("editor-a", 0, [], { spare: image("spare") }))).status, 200);
  assert.deepEqual((await f.api(`/api/boards/${board.id}`)).data.assets, []);
  assert.deepEqual((await f.api("/assets/spare")).bytes, png);
  assert.equal((await save(f.api, board.id, scene("editor-a", 1, [imageElement("spare")]))).status, 400);
  assert.equal((await save(f.api, board.id, scene("editor-a", 1, [imageElement("spare")], { spare: image("spare") }))).status, 200);
});

test("restore可恢复图片引用，删除白板后备份仍可恢复且图片保留", async (t) => {
  const f = await fixture(t);
  const board = await create(f.api);
  await lease(f.api, board.id);
  assert.equal((await save(f.api, board.id, scene("editor-a", 0, [imageElement("restore_image")], {
    restore_image: image("restore_image"),
  }))).status, 200);
  assert.equal((await save(f.api, board.id, scene("editor-a", 1))).status, 200);
  const restored = await f.api(`/api/boards/${board.id}/restore`, { method: "POST", body: { owner: "editor-a" } });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.revision, 3);
  assert.equal(restored.data.assets[0].id, "restore_image");
  assert.equal((await f.api(`/api/boards/${board.id}`, { method: "PUT", body: { name: "备份含图片" } })).status, 200);
  assert.equal((await f.api(`/api/boards/${board.id}`, { method: "DELETE", body: { owner: "editor-a" } })).status, 200);
  const undeleted = await f.api(`/api/boards/${board.id}/restore`, { method: "POST", body: {} });
  assert.equal(undeleted.status, 200);
  assert.equal(undeleted.data.assets[0].id, "restore_image");
  assert.deepEqual((await f.api("/assets/restore_image")).bytes, png);
});

test("两个白板并发上传同id异内容仅允许一个，另一块及原图片不受污染", async (t) => {
  const f = await fixture(t);
  const a = await create(f.api);
  const b = await create(f.api);
  await lease(f.api, a.id);
  await lease(f.api, b.id);
  const altered = Buffer.concat([png, Buffer.from("other")]);
  const results = await Promise.all([
    save(f.api, a.id, scene("editor-a", 0, [imageElement("race")], { race: image("race") })),
    save(f.api, b.id, scene("editor-a", 0, [imageElement("race")], { race: image("race", altered) })),
  ]);
  assert.deepEqual(results.map((res) => res.status).sort(), [200, 409]);
  assert.deepEqual((await f.api("/assets/race")).bytes, results[0].status === 200 ? png : altered);
  assert.equal((await f.api(`/api/boards/${results[0].status === 409 ? a.id : b.id}`)).data.revision, 0);
});

test("原子JSON保存保留上次有效备份，restore拒绝租约冲突且revision前进", async (t) => {
  const f = await fixture(t);
  const board = await create(f.api, "原始");
  const filename = path.join(f.dataDir, "boards", `${board.id}.json`);
  const backupFile = path.join(f.dataDir, "backups", `${board.id}.json`);
  await lease(f.api, board.id);
  assert.equal((await save(f.api, board.id, scene("editor-a", 0, [{ id: "saved", type: "text" }]))).status, 200);
  assert.equal(JSON.parse(await fs.readFile(backupFile, "utf8")).revision, 0);
  assert.equal((await f.api(`/api/boards/${board.id}`, { method: "PUT", body: { name: "新名字" } })).status, 200);
  assert.equal(JSON.parse(await fs.readFile(backupFile, "utf8")).name, "原始");
  const restoreRoute = `/api/boards/${board.id}/restore`;
  assert.equal((await f.api(restoreRoute, { method: "POST", body: {} })).status, 423);
  assert.equal((await f.api(restoreRoute, { method: "POST", body: { owner: "editor-b" } })).status, 423);
  const restored = await f.api(restoreRoute, { method: "POST", body: { owner: "editor-a" } });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.name, "原始");
  assert.equal(restored.data.revision, 2);
  assert.equal(restored.data.scene.elements[0].id, "saved");
  assert.equal(JSON.parse(await fs.readFile(backupFile, "utf8")).name, "新名字");
  assert.equal((await save(f.api, board.id, scene("editor-a", 1))).status, 409);
  const current = JSON.parse(await fs.readFile(filename, "utf8"));
  assert.equal(current.revision, 2);
  for (const dir of ["boards", "backups", "assets"]) {
    assert.equal((await fs.readdir(path.join(f.dataDir, dir))).some((entry) => entry.endsWith(".tmp")), false);
  }
  await f.app.close();
  const restarted = await f.launch();
  assert.equal((await restarted.api(`/api/boards/${board.id}`)).data.name, "原始");
  assert.equal((await restarted.api(restoreRoute, { method: "POST", body: {} })).data.name, "新名字");
});

test("损坏JSON列表显式报错，不覆盖损坏文件/备份，缺失与损坏区分并可restore", async (t) => {
  const f = await fixture(t);
  const board = await create(f.api, "原始");
  const route = `/api/boards/${board.id}`;
  const filename = path.join(f.dataDir, "boards", `${board.id}.json`);
  const backupFile = path.join(f.dataDir, "backups", `${board.id}.json`);
  assert.equal((await f.api(route, { method: "PUT", body: { name: "第二版" } })).status, 200);
  const backup = await fs.readFile(backupFile, "utf8");
  for (const corrupt of ["{broken", "null", JSON.stringify({ id: board.id, name: "损坏" })]) {
    await fs.writeFile(filename, corrupt);
    const response = await f.api(route);
    assert.equal(response.status, 500);
    assert.equal(response.data.code, "BOARD_CORRUPT");
    assert.equal(response.data.boardId, board.id);
    assert.equal((await f.api("/api/boards")).status, 500);
    assert.equal((await f.api(route, { method: "PUT", body: { name: "不得覆盖" } })).status, 500);
    assert.equal(await fs.readFile(filename, "utf8"), corrupt);
    assert.equal(await fs.readFile(backupFile, "utf8"), backup);
  }
  const recovered = await f.api(`${route}/restore`, { method: "POST", body: {} });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.data.name, "原始");
  assert.equal(await fs.readFile(backupFile, "utf8"), backup);
  await fs.unlink(filename);
  assert.equal((await f.api(route)).status, 404);
  assert.equal((await f.api(`${route}/restore`, { method: "POST", body: {} })).status, 200);
  await fs.writeFile(backupFile, "not json");
  const restoredText = await fs.readFile(filename, "utf8");
  const corruptBackup = await f.api(`${route}/restore`, { method: "POST", body: {} });
  assert.equal(corruptBackup.status, 500);
  assert.equal(corruptBackup.data.code, "BACKUP_CORRUPT");
  assert.equal(await fs.readFile(filename, "utf8"), restoredText);
  await fs.unlink(backupFile);
  assert.equal((await f.api(`${route}/restore`, { method: "POST", body: {} })).status, 404);
});

test("写入失败不截断原白板，备份失败也不覆盖当前白板", async (t) => {
  const f = await fixture(t);
  const board = await create(f.api);
  const filename = path.join(f.dataDir, "boards", `${board.id}.json`);
  const backupFile = path.join(f.dataDir, "backups", `${board.id}.json`);
  const original = await fs.readFile(filename, "utf8");
  await fs.mkdir(backupFile);
  const response = await f.api(`/api/boards/${board.id}`, { method: "PUT", body: { name: "不可写" } });
  assert.equal(response.status, 500);
  assert.equal(await fs.readFile(filename, "utf8"), original);
  assert.deepEqual((await fs.readdir(path.join(f.dataDir, "backups"))), [`${board.id}.json`]);
  await fs.rmdir(backupFile);
  const rename = fs.rename;
  const mocked = t.mock.method(fs, "rename", async (from, to) => {
    if (to === filename) throw Object.assign(new Error("模拟原子替换失败"), { code: "EACCES" });
    return rename(from, to);
  });
  const renameFailed = await f.api(`/api/boards/${board.id}`, { method: "PUT", body: { name: "仍不能覆盖" } });
  assert.equal(renameFailed.status, 500);
  assert.equal(await fs.readFile(filename, "utf8"), original);
  assert.equal(await fs.readFile(backupFile, "utf8"), original);
  assert.deepEqual(await fs.readdir(path.join(f.dataDir, "boards")), [`${board.id}.json`]);
  mocked.mock.restore();
});

test("Host/Origin对GET同样检查，精确开发CORS、cross-site与JSON写入要求", async (t) => {
  const f = await fixture(t);
  for (const host of ["attacker.invalid", `attacker.invalid:${f.port}`, "127.0.0.1", `localhost:${f.port + 1}`, `127.0.0.1:${f.port}@attacker.invalid`]) {
    assert.equal((await f.api("/api/health", { headers: { host } })).status, 403);
    assert.equal((await f.api("/", { headers: { host } })).status, 403);
  }
  assert.equal((await f.api("/api/health", { headers: { host: `localhost:${f.port}` } })).status, 200);
  for (const origin of ["null", "https://localhost:5173", "http://attacker.invalid", `http://localhost:${f.port}`, "http://127.0.0.1:5173.attacker.invalid"]) {
    assert.equal((await f.api("/api/boards", { headers: { origin } })).status, 403);
    assert.equal((await f.api("/", { headers: { origin } })).status, 403);
    assert.equal((await f.api("/assets/anything", { headers: { origin } })).status, 403);
  }
  for (const origin of [`http://127.0.0.1:${f.port}`, "http://127.0.0.1:5173", "http://localhost:5173"]) {
    const allowed = await f.api("/api/health", { headers: { origin } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers["access-control-allow-origin"], origin);
    assert.equal(allowed.headers.vary, "Origin");
    const preflight = await f.api("/api/boards", { method: "OPTIONS", headers: { origin, "access-control-request-method": "PUT" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers["access-control-allow-origin"], origin);
  }
  assert.equal((await f.api("/api/health")).headers["access-control-allow-origin"], undefined);
  assert.equal((await f.api("/api/boards", { method: "OPTIONS", headers: { origin: "http://attacker.invalid" } })).status, 403);
  assert.equal((await f.api("/api/boards", { method: "POST", body: {}, headers: { "sec-fetch-site": "cross-site" } })).status, 403);
  assert.equal((await f.api("/api/boards", { method: "POST", raw: "{}" })).status, 415);
  assert.equal((await f.api("/api/boards", { method: "POST", body: {}, headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await f.api("/api/boards", { method: "POST", body: {}, headers: { "content-type": "application/json; charset=utf-8" } })).status, 201);
  assert.equal((await f.api("/api/assets?fileId=bad", { method: "POST", raw: png, headers: { "content-type": "image/png" } })).status, 415);
  assert.equal((await f.api("/api/assets", { method: "POST", body: {} })).status, 404);
});

test("malformedJSON与字段验证不创建或修改白板", async (t) => {
  const f = await fixture(t);
  for (const raw of ["", "{", "null", "[]", "42", "\"name\"", "{\"name\":\"ok\"}garbage", Buffer.from([0xff])]) {
    const response = await f.api("/api/boards", { method: "POST", raw, headers: { "content-type": "application/json" } });
    assert.equal(response.status, 400);
    assert.equal(response.data.code, "INVALID_JSON");
  }
  assert.deepEqual((await f.api("/api/boards")).data, []);
  const board = await create(f.api);
  for (const body of [{ name: 1 }, { thumbnail: {} }, { elementCount: -1 }, { elementCount: 1.5 }, { revision: 1 }]) {
    assert.equal((await f.api(`/api/boards/${board.id}`, { method: "PUT", body })).status, 400);
  }
  assert.equal((await f.api(`/api/boards/${board.id}`)).data.name, "测试白板");
});

test("严格拒绝原始及编码路径穿越、非法id，无清洗碰撞或静态泄漏", async (t) => {
  const f = await fixture(t);
  const board = await create(f.api);
  await fs.writeFile(path.join(f.root, "secret.txt"), "不能读取");
  const paths = [
    "/../secret.txt", "/%2e%2e/secret.txt", "/%252e%252e/secret.txt", "/%2e/secret.txt", "/%ZZ",
    "/%2fsecret.txt", "/%5csecret.txt", "/foo\\bar", "//secret.txt", "/foo//bar", "/%00",
    "/index.html%3Astream", "/index.html%20", "/CON.txt", "/foo%3Fbar", "/static/%2e%2e/secret.txt",
    `/api/boards/${board.id}%21`, `/api/boards/${board.id}%2f`, `/api/boards/${board.id}%5c`,
    "/api/boards/a.b", "/api/boards/" + "a".repeat(129), "/api/boards/%E6%B5%8B%E8%AF%95",
    "/assets/a.b", "/assets/%2e%2e", "/assets/a/b", "/assets/CON", "/assets/nul",
    "/api/boards/COM1", "/api/boards/LPT9",
  ];
  for (const route of paths) {
    const response = await f.api(route);
    assert.equal(response.status, 400, route);
    assert.notEqual(response.data, "不能读取");
  }
  assert.equal((await f.api(`/api/boards/${board.id}`)).status, 200);
  assert.deepEqual((await fs.readdir(path.join(f.dataDir, "boards"))), [`${board.id}.json`]);
});

test("图片base64/MIME/签名/id/缺失引用校验：任何失败都不写场景或新资源", async (t) => {
  const f = await fixture(t);
  const board = await create(f.api);
  await lease(f.api, board.id);
  const good = image("bad");
  const badFiles = [
    { ...good, id: "different" }, { ...good, mimeType: "application/octet-stream" },
    { ...good, mimeType: "image/jpeg" }, { ...good, mimeType: ["image/png"] }, { ...good, mimeType: {} },
    { ...good, dataURL: "data:image/png;base64,@@@@" },
    { ...good, dataURL: "data:image/png;base64,aQ=" }, { ...good, dataURL: "data:image/png;base64,aQ==\n" },
    { ...good, dataURL: "data:image/png;base64,aR==" }, image("bad", Buffer.from("not png")),
    { ...good, created: -1 }, { ...good, created: "yesterday" }, { ...good, dataURL: "data:image/png;base64," },
    image("bad", Buffer.from("<html>no svg</html>"), "image/svg+xml"),
    image("bad", Buffer.from('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///secret">]><svg/>'), "image/svg+xml"),
    ...["image/jpeg", "image/gif", "image/webp", "image/bmp"].map((mime) => image("bad", png, mime)),
  ];
  for (const file of badFiles) {
    assert.equal((await save(f.api, board.id, scene("editor-a", 0, [imageElement("bad")], { bad: file }))).status, 400);
  }
  const mixed = scene("editor-a", 0, [imageElement("good"), imageElement("missing")], { good: image("good") });
  assert.equal((await save(f.api, board.id, mixed)).status, 400);
  assert.equal((await save(f.api, board.id, scene("editor-a", 0, [imageElement("bad/id")]))).status, 400);
  assert.equal((await save(f.api, board.id, scene("editor-a", 0, [], { "bad/id": image("bad/id") }))).status, 400);
  for (const body of [scene("editor-a", -1), scene("editor-a", 0.5), { ...scene("editor-a", 0), files: [] },
    { ...scene("editor-a", 0), scene: { elements: null, appState: {} } },
    { ...scene("editor-a", 0), scene: { elements: [], appState: [] } }, scene("editor-a", 0, [null])]) {
    assert.equal((await save(f.api, board.id, body)).status, 400);
  }
  assert.equal((await f.api(`/api/boards/${board.id}`)).data.revision, 0);
  assert.deepEqual(await fs.readdir(path.join(f.dataDir, "assets")), []);
  assert.deepEqual(await fs.readdir(path.join(f.dataDir, "backups")), []);
  const missing = await save(f.api, board.id, scene("editor-a", 0, [imageElement("not_registered")]));
  assert.equal(missing.data.code, "MISSING_ASSET");
});

test("所有允许图片签名与SVG sandbox CSP；MIME变化和磁盘丢图均拒绝", async (t) => {
  const f = await fixture(t);
  const board = await create(f.api);
  await lease(f.api, board.id);
  const inputs = [
    ["png", "image/png", png],
    ["jpeg", "image/jpeg", Buffer.from([255, 216, 255, 224, 255, 217])],
    ["gif", "image/gif", Buffer.from("GIF89a\x01\x00\x01\x00")],
    ["webp", "image/webp", Buffer.from("RIFF\x04\x00\x00\x00WEBP")],
    ["bmp", "image/bmp", Buffer.concat([Buffer.from("BM"), Buffer.alloc(12)])],
    ["svg", "image/svg+xml", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="1" height="1"/></svg>')],
  ];
  const elements = inputs.map(([id]) => imageElement(id));
  const files = Object.fromEntries(inputs.map(([id, mime, bytes]) => [id, image(id, bytes, mime)]));
  assert.equal((await save(f.api, board.id, scene("editor-a", 0, elements, files))).status, 200);
  for (const [id, mime, bytes] of inputs) {
    const res = await f.api(`/assets/${id}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], mime);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.deepEqual(res.bytes, bytes);
    if (id === "svg") assert.match(res.headers["content-security-policy"], /^sandbox; default-src 'none'/);
    assert.equal((await f.api(`/assets/${id}`, { method: "HEAD" })).bytes.length, 0);
  }
  const mimeChanged = await save(f.api, board.id, scene("editor-a", 1, [imageElement("png")], { png: image("png", inputs[2][2], "image/gif") }));
  assert.equal(mimeChanged.status, 409);
  await fs.unlink(path.join(f.dataDir, "assets", "png.png"));
  assert.equal((await save(f.api, board.id, scene("editor-a", 1, elements))).status, 400);
  assert.equal((await save(f.api, board.id, scene("editor-a", 1, elements, { png: image("png") }))).status, 200);
});

test("128MB请求体上限（声明长度和真实chunked传输）与32MB单图上限", async (t) => {
  const f = await fixture(t);
  const oversized = await f.api("/api/boards", {
    method: "POST", raw: "{}", headers: { "content-type": "application/json", "content-length": BODY_LIMIT + 1 },
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.data.code, "BODY_TOO_LARGE");
  const chunked = await new Promise((resolve, reject) => {
    let responded = false;
    const req = http.request({ hostname: "127.0.0.1", port: f.port, path: "/api/boards", method: "POST", headers: { "content-type": "application/json" } }, (res) => {
      responded = true;
      res.resume();
      res.on("end", () => resolve(res.statusCode));
      res.on("error", reject);
    });
    req.on("error", (err) => { if (!responded) reject(err); });
    const chunk = Buffer.alloc(1024 * 1024, 32);
    let count = 0;
    function write() {
      while (count < 129) {
        count++;
        if (!req.write(chunk)) { req.once("drain", write); return; }
      }
      req.end();
    }
    write();
  });
  assert.equal(chunked, 413);
  const board = await create(f.api);
  await lease(f.api, board.id);
  const bytes = Buffer.alloc(IMAGE_LIMIT + 1);
  png.copy(bytes);
  const result = await save(f.api, board.id, scene("editor-a", 0, [imageElement("large")], { large: image("large", bytes) }));
  assert.equal(result.status, 413);
  assert.equal(result.data.code, "IMAGE_TOO_LARGE");
  assert.deepEqual(await fs.readdir(path.join(f.dataDir, "assets")), []);
  assert.equal((await f.api(`/api/boards/${board.id}`)).data.revision, 0);
  assert.equal((await f.api("/api/health")).status, 200);
});

test("普通dist静态资源及SEA __manifest/getAsset优先、缺失时回退dist", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.distDir, "static"));
  await fs.writeFile(path.join(f.distDir, "static", "app.js"), "// 磁盘脚本");
  assert.equal((await f.api("/static/app.js")).data, "// 磁盘脚本");
  assert.equal((await f.api("/static/")).data, "<!doctype html><title>测试白板</title>");
  assert.equal((await f.api("/missing-route")).data, "<!doctype html><title>测试白板</title>");
  assert.equal((await f.api("/", { method: "HEAD" })).bytes.length, 0);
  const assets = {
    __manifest: JSON.stringify(["index.html", "static/app.js"]),
    "index.html": "<!doctype html><title>SEA白板</title>",
    "static/app.js": "// 嵌入脚本",
  };
  const calls = [];
  const sea = await f.launch({
    isSea: true,
    getAsset(name, encoding) {
      calls.push([name, encoding]);
      if (!(name in assets)) throw new Error("缺失嵌入资源");
      return encoding ? assets[name] : Uint8Array.from(Buffer.from(assets[name])).buffer;
    },
  });
  assert.equal((await sea.api("/")).data, assets["index.html"]);
  assert.equal((await sea.api("/static/app.js")).data, assets["static/app.js"]);
  assert.equal((await sea.api("/unknown")).data, assets["index.html"]);
  await fs.writeFile(path.join(f.distDir, "local.txt"), "磁盘回退");
  assert.equal((await sea.api("/local.txt")).data, "磁盘回退");
  assert.deepEqual(calls[0], ["__manifest", "utf8"]);
  assert.equal((await sea.api("/api/health")).data.sea, true);
  for (const badManifest of ['["../secret"]', '["/absolute"]', '["a\\\\b"]', '{}']) {
    const app = createLocalServer({ dataDir: f.dataDir, distDir: f.distDir, port: 0, noOpen: true, isSea: true, getAsset: () => badManifest });
    await assert.rejects(app.start());
    await app.close();
  }
});

test("同app且相同dataDir才复用，占用服务及其他数据目录自动换端口", async (t) => {
  const f = await fixture(t);
  const same = await f.launch({ port: f.port });
  assert.equal(same.reused, true);
  assert.equal(same.port, f.port);
  assert.equal(same.app.server.listening, false);
  const other = await f.launch({ port: f.port, dataDir: path.join(f.root, "other-data") });
  assert.equal(other.reused, false);
  assert.notEqual(other.port, f.port);
  assert.equal((await other.api("/api/health")).data.dataDir, path.join(f.root, "other-data"));
  const foreign = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ app: "another-app", dataDir: f.dataDir }));
  });
  await new Promise((resolve) => foreign.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => foreign.close(resolve)));
  const collision = await f.launch({ port: foreign.address().port });
  assert.equal(collision.reused, false);
  assert.notEqual(collision.port, foreign.address().port);
  const emptyForeign = http.createServer((req, res) => res.end("别的服务"));
  await new Promise((resolve) => emptyForeign.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => emptyForeign.close(resolve)));
  const noJson = await f.launch({ port: emptyForeign.address().port });
  assert.equal(noJson.reused, false);
  assert.notEqual(noJson.port, emptyForeign.address().port);
});

test("WHITEBOARD_DATA_DIR、CLI --no-open与SIGTERM关闭（无GUI）", async (t) => {
  const f = await fixture(t);
  const envDir = path.join(f.root, "env-data");
  const previous = process.env.WHITEBOARD_DATA_DIR;
  let app;
  try {
    process.env.WHITEBOARD_DATA_DIR = envDir;
    app = createLocalServer({ distDir: f.distDir, port: 0, noOpen: true, logger: { log() {}, error() {} } });
    assert.equal(app.dataDir, envDir);
    await app.start();
    await app.close();
  } finally {
    if (app) await app.close();
    if (previous === undefined) delete process.env.WHITEBOARD_DATA_DIR;
    else process.env.WHITEBOARD_DATA_DIR = previous;
  }
  const cliDir = path.join(f.root, "cli-data");
  const child = spawn(process.execPath, [serverPath, "--no-open"], {
    env: { ...process.env, PORT: "0", WHITEBOARD_DATA_DIR: cliDir }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const exit = new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", (code) => resolve(code)); });
  const port = await new Promise((resolve, reject) => {
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) resolve(Number(match[1]));
    });
    child.on("error", reject);
    child.on("exit", () => reject(new Error("CLI未输出服务地址")));
  });
  assert.equal((await request(port, "/api/health")).data.dataDir, cliDir);
  // Windows进程信号投递不保证执行JS回调；关闭CLI后在子进程内显式发信号验证处理器。
  child.kill();
  await exit;
  const script = `process.argv.push('--no-open'); const Module = require('node:module'); const file = ${JSON.stringify(serverPath)}; const entry = new Module(file); entry.filename = file; entry.paths = Module._nodeModulePaths(require('node:path').dirname(file)); process.mainModule = entry; entry.load(file); process.stdout.on('error', () => {}); const original = console.log; console.log = (...args) => { original(...args); if (String(args[0]).includes('已启动')) process.emit('SIGTERM'); };`;
  const signalChild = spawn(process.execPath, ["-e", script], {
    env: { ...process.env, PORT: "0", WHITEBOARD_DATA_DIR: path.join(f.root, "signal-data") }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  t.after(() => { if (signalChild.exitCode === null) signalChild.kill(); });
  let output = "";
  let errors = "";
  signalChild.stdout.on("data", (chunk) => { output += chunk; });
  signalChild.stderr.on("data", (chunk) => { errors += chunk; });
  const code = await new Promise((resolve, reject) => { signalChild.on("error", reject); signalChild.on("exit", resolve); });
  assert.equal(code, 0, errors);
  assert.match(output, /正在关闭/);
});
