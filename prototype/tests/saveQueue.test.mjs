import test from "node:test";
import assert from "node:assert/strict";
import { createSaveQueue, sceneSignature } from "../src/editor/saveQueue.ts";
import { ApiError, apiRequest, requestJson } from "../src/api.ts";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const nextTick = () => new Promise((resolve) => setImmediate(resolve));
const element = (version = 1) => ({ id: "e", type: "rectangle", version, versionNonce: version, isDeleted: false, index: "a0" });
const file = (dataURL = "data:image/png;base64,YQ==") => ({ id: "f", mimeType: "image/png", created: 1, dataURL });
const snapshot = (version = 1) => ({ elements: [element(version)], appState: { viewBackgroundColor: "#fff" }, files: {} });

test("500ms 防抖合并最新快照，相同内容不重复保存", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const writes = [];
  const queue = createSaveQueue({ save: async (value) => { writes.push(value); }, signature: String });
  queue.initialize(0);
  assert.equal(queue.schedule(1), true);
  t.mock.timers.tick(499);
  assert.deepEqual(writes, []);
  queue.schedule(2);
  t.mock.timers.tick(499);
  assert.deepEqual(writes, []);
  t.mock.timers.tick(1);
  await queue.flush();
  assert.deepEqual(writes, [2]);
  assert.equal(queue.schedule(2), false);
  assert.equal(queue.state().status, "saved");
});

test("并发 flush 只发一个请求，保存中多次变化合并为下一次最新快照", async () => {
  const first = deferred();
  const second = deferred();
  const writes = [];
  const queue = createSaveQueue({
    signature: String,
    save: async (value) => { writes.push(value); await (writes.length === 1 ? first.promise : second.promise); },
  });
  queue.initialize(0);
  queue.schedule(1);
  const flush = queue.flush();
  assert.equal(queue.flush(), flush);
  await nextTick();
  queue.schedule(2);
  queue.schedule(3);
  assert.deepEqual(writes, [1]);
  first.resolve();
  await nextTick();
  assert.deepEqual(writes, [1, 3]);
  assert.equal(queue.state().status, "saving");
  second.resolve();
  assert.equal(await flush, true);
  assert.equal(queue.state().status, "saved");
});

test("保存失败保留 dirty 和快照，继续编辑不自动重试，显式 flush 重试最新内容", async () => {
  let fails = true;
  const writes = [];
  const queue = createSaveQueue({ signature: String, save: async (value) => {
    writes.push(value);
    if (fails) throw new Error("保存失败");
  } });
  queue.initialize(0);
  queue.schedule(1);
  assert.equal(await queue.flush(), false);
  assert.equal(queue.state().status, "error");
  assert.equal(queue.state().dirty, true);
  assert.equal(queue.state().snapshot, 1);
  queue.schedule(2);
  await nextTick();
  assert.deepEqual(writes, [1]);
  fails = false;
  assert.equal(await queue.flush(), true);
  assert.deepEqual(writes, [1, 2]);
  assert.equal(queue.state().status, "saved");
});

test("lease 失效不继续保存、不接收新 onChange，保留未保存内容", async () => {
  const request = deferred();
  let calls = 0;
  const queue = createSaveQueue({ signature: String, save: async () => { calls++; await request.promise; } });
  queue.initialize(0);
  queue.schedule(1);
  const flush = queue.flush();
  await nextTick();
  queue.schedule(2);
  queue.setReadOnly(new ApiError("租约失效", 423));
  assert.equal(queue.schedule(3), false);
  request.resolve();
  assert.equal(await flush, false);
  assert.equal(calls, 1);
  assert.equal(queue.state().status, "readonly");
  assert.equal(queue.state().snapshot, 2);
  assert.equal(await queue.flush(), false);
});

test("只读基线不丢失冲突原因，恢复快照仍 dirty", async () => {
  const queue = createSaveQueue({ signature: String, save: async () => { assert.fail("不应保存"); } });
  const cause = new ApiError("另一标签正在编辑", 409);
  queue.setReadOnly(cause);
  queue.initialize(0);
  assert.equal(queue.state().error, cause);
  queue.restore(1);
  assert.equal(queue.state().dirty, true);
  assert.equal(await queue.flush(), false);
});

test("恢复未保存内容提示重试，不自动保存服务器快照", async () => {
  const writes = [];
  const queue = createSaveQueue({ signature: String, save: async (value) => { writes.push(value); } });
  queue.initialize(0);
  queue.restore(1, new Error("请重试"));
  assert.equal(queue.state().status, "error");
  await nextTick();
  assert.deepEqual(writes, []);
  assert.equal(await queue.flush(), true);
  assert.deepEqual(writes, [1]);
});

test("失败后回退到已保存内容，显式重试会恢复 saved", async () => {
  const queue = createSaveQueue({ signature: String, save: async () => { throw new Error("失败"); } });
  queue.initialize(0);
  queue.schedule(1);
  await queue.flush();
  queue.schedule(0);
  assert.equal(await queue.flush(), true);
  assert.equal(queue.state().status, "saved");
});

test("独立队列不共享状态，支持后台 flush keepalive", async () => {
  const writes = [];
  const queueA = createSaveQueue({ signature: String, save: async (value, options) => { writes.push([value, options.keepalive]); } });
  const queueB = createSaveQueue({ signature: String, save: async () => { assert.fail("不应保存 B"); } });
  queueA.initialize(0);
  queueB.initialize(0);
  queueA.schedule(1);
  assert.equal(await queueA.flush({ keepalive: true }), true);
  assert.deepEqual(writes, [[1, true]]);
  assert.equal(queueB.state().snapshot, 0);
  assert.equal(queueB.state().status, "saved");
});

test("签名忽略 hover/selection、文件访问时间及字段顺序，检测版本、appState 与同长度图片变化", () => {
  const base = { ...snapshot(), files: { f: file() } };
  const runtime = {
    ...base,
    appState: { ...base.appState, selectedElementIds: { e: true }, hoveredElementIds: { e: true }, collaborators: new Map(), theme: "dark" },
    files: { f: { ...file(), lastRetrieved: 200 } },
  };
  assert.equal(sceneSignature(base), sceneSignature(runtime));
  assert.notEqual(sceneSignature(base), sceneSignature({ ...base, elements: [element(2)] }));
  assert.notEqual(sceneSignature(base), sceneSignature({ ...base, appState: { viewBackgroundColor: "#000" } }));
  assert.notEqual(sceneSignature(base), sceneSignature({ ...base, files: { f: file("data:image/png;base64,Yg==") } }));
  const twoFiles = { ...base, files: { f: file(), g: { ...file(), id: "g" } } };
  assert.equal(sceneSignature(twoFiles), sceneSignature({ ...twoFiles, files: { g: twoFiles.files.g, f: file() } }));
});

test("API 解析中文错误、保留 status，英文错误使用友好中文", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: "画板正在编辑" }), { status: 409 }));
  await assert.rejects(requestJson("/api/test"), (error) => error instanceof ApiError && error.status === 409 && error.message === "画板正在编辑");
  globalThis.fetch = async () => new Response("Internal Server Error", { status: 500 });
  await assert.rejects(requestJson("/api/test"), (error) => error.status === 500 && /本地服务保存失败/.test(error.message));
});

test("30 秒 Abort 超时覆盖 fetch，异常始终可捕获", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    signal = init.signal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
  });
  const request = requestJson("/api/test");
  const check = assert.rejects(request, (error) => error instanceof ApiError && error.status === 0 && /30 秒/.test(error.message));
  t.mock.timers.tick(30_000);
  await check;
  assert.equal(signal.aborted, true);
});

test("响应体读取也受 30 秒超时约束", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    signal = init.signal;
    return new Response("ok");
  });
  const started = deferred();
  const request = apiRequest("/api/test", undefined, async () => {
    started.resolve();
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
  });
  const check = assert.rejects(request, (error) => error.status === 200 && /30 秒/.test(error.message));
  await started.promise;
  t.mock.timers.tick(30_000);
  await check;
});

test("boardRepo 原子保存、每板上传缓存、失败不缓存、同长度内容变化及 keepalive 大小限制", async (t) => {
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  globalThis.BroadcastChannel = undefined;
  const repo = await import("../src/storage/boardRepo.ts");
  globalThis.BroadcastChannel = originalBroadcastChannel;
  const requests = [];
  let fail = false;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, body, keepalive: init.keepalive });
    return fail
      ? new Response(JSON.stringify({ error: "保存失败" }), { status: 500 })
      : new Response(JSON.stringify({ revision: body.revision + 1, updatedAt: 123, elementCount: 1 }));
  });
  const imageSnapshot = (data = file()) => ({ ...snapshot(), elements: [{ ...element(), type: "image", fileId: "f" }], files: { f: data } });
  const first = imageSnapshot();
  await repo.saveSceneSnapshot("A", "owner", 0, first, { keepalive: true });
  assert.ok(requests[0].body.files.f.dataURL);
  assert.equal(requests[0].url, "/api/boards/A/scene");
  assert.equal(requests[0].body.owner, "owner");
  assert.equal(requests[0].keepalive, true);
  await repo.saveSceneSnapshot("A", "owner", 1, first);
  assert.deepEqual(requests[1].body.files, {});
  await repo.saveSceneSnapshot("B", "owner", 0, first);
  assert.ok(requests[2].body.files.f);
  fail = true;
  await assert.rejects(repo.saveSceneSnapshot("C", "owner", 0, first));
  fail = false;
  await repo.saveSceneSnapshot("C", "owner", 0, first);
  assert.ok(requests[4].body.files.f);
  await repo.saveSceneSnapshot("A", "owner", 2, imageSnapshot(file("data:image/png;base64,Yg==")));
  assert.ok(requests[5].body.files.f);
  await repo.saveSceneSnapshot("Large", "owner", 0, imageSnapshot(file(`data:image/png;base64,${"A".repeat(70_000)}`)), { keepalive: true });
  assert.equal(requests[6].keepalive, false);
  await assert.rejects(repo.saveSceneSnapshot("A", "owner", 3, { ...first, files: {} }), /图片.*数据缺失/);
  assert.equal(requests.length, 7);
});

test("保存响应不完整不缓存上传，元数据 PUT 不泄漏 scene/files", async (t) => {
  const repo = await import("../src/storage/boardRepo.ts");
  const requests = [];
  let invalid = true;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, body });
    return new Response(JSON.stringify(invalid ? {} : { revision: body.revision + 1, updatedAt: 1, elementCount: 1 }));
  });
  const image = { ...snapshot(), elements: [{ ...element(), type: "image", fileId: "f" }], files: { f: file() } };
  await assert.rejects(repo.saveSceneSnapshot("Unconfirmed", "owner", 0, image), /保存响应不完整/);
  invalid = false;
  await repo.saveSceneSnapshot("Unconfirmed", "owner", 0, image);
  assert.ok(requests[1].body.files.f);
  await repo.saveBoard({ id: "Meta", name: "白板", createdAt: 1, updatedAt: 1, elementCount: 1, scene: image, files: image.files });
  assert.equal(requests[2].url, "/api/boards/Meta");
  assert.equal("scene" in requests[2].body, false);
  assert.equal("files" in requests[2].body, false);
  await repo.acquireBoardLease("Lease", "owner");
  await repo.releaseBoardLease("Lease", "owner");
  assert.deepEqual(requests[3].body, { owner: "owner" });
  assert.deepEqual(requests[4].body, { owner: "owner" });
});

test("同一快照只 GET board 一次然后取全部图片，缺图/404 明确失败且不可缓存", async (t) => {
  const repo = await import("../src/storage/boardRepo.ts");
  const urls = [];
  const board = {
    id: "Load", name: "白板", createdAt: 1, updatedAt: 1, elementCount: 1,
    scene: { elements: [{ ...element(), type: "image", fileId: "f" }], appState: {} },
    assets: [{ id: "f", mimeType: "image/png", ext: ".png" }],
  };
  const originalFileReader = globalThis.FileReader;
  t.after(() => {
    if (originalFileReader === undefined) delete globalThis.FileReader;
    else globalThis.FileReader = originalFileReader;
  });
  globalThis.FileReader = class {
    readAsDataURL() { this.result = file().dataURL; queueMicrotask(() => this.onload()); }
  };
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(url);
    return url.startsWith("/assets/") ? new Response("image") : new Response(JSON.stringify(board));
  });
  const loaded = await repo.loadSceneSnapshot("Load");
  assert.equal(loaded.board.revision, 0);
  assert.equal(loaded.snapshot.files.f.dataURL, file().dataURL);
  assert.deepEqual(urls, ["/api/boards/Load", "/assets/f"]);
  globalThis.fetch = async (url) => url.startsWith("/assets/")
    ? new Response("", { status: 404 }) : new Response(JSON.stringify(board));
  await assert.rejects(repo.loadSceneSnapshot("Missing"), (error) => error.status === 404 && /图片.*加载失败/.test(error.message));
  globalThis.fetch = async () => new Response("", { status: 404 });
  await assert.rejects(repo.loadSceneSnapshot("404"), (error) => error.status === 404 && /画板不存在/.test(error.message));
  globalThis.fetch = async () => new Response(JSON.stringify({ ...board, assets: [] }));
  await assert.rejects(repo.loadSceneSnapshot("Incomplete"), /缺少图片/);
});
