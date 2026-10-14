import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  patchZhCnLocale,
  patchFontSlots,
  patchGridRender,
  patchFontFallback,
  patchFileSizeLimit,
  MAX_IMAGE_BYTES,
  applyPatches,
} from "../scripts/excalidraw-patch.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROD = path.join(ROOT, "node_modules/@excalidraw/excalidraw/dist/prod");

function findFile(dir, predicate) {
  const name = fs.readdirSync(dir).find((entry) => predicate(entry, dir));
  return name ? path.join(dir, name) : null;
}

const zhCnPath = findFile(path.join(PROD, "locales"), (name) => name.startsWith("zh-CN"));
const fontChunkPath = findFile(PROD, (name, dir) =>
  name.endsWith(".js") && fs.readFileSync(path.join(dir, name), "utf8").includes('testId:"font-family-hand-drawn"')
);

test("zh-CN 语言包补丁：就地合并缺失键，且不破坏导出语句", () => {
  assert.ok(zhCnPath, "未找到 zh-CN 语言包");
  const source = fs.readFileSync(zhCnPath, "utf8");
  const patched = patchZhCnLocale(source, zhCnPath);
  assert.ok(patched, "补丁应命中 zh-CN 语言包");
  assert.ok(patched.length > source.length, "补丁应追加内容");
  assert.ok(patched.startsWith(source), "补丁必须保留原始模块内容");
  assert.match(patched, /__wbDeep\(/, "补丁应包含深度合并调用");
  assert.match(patched, /labels\.handDrawn|"handDrawn"/, "补丁应包含字体标签覆盖");
  // 非 zh-CN 模块必须被跳过
  assert.equal(patchZhCnLocale(source, zhCnPath.replace("zh-CN", "en")), null);
});

test("字体槽位补丁：三个槽位改绑到单分片家族", () => {
  assert.ok(fontChunkPath, "未找到包含字体槽位的 chunk");
  const source = fs.readFileSync(fontChunkPath, "utf8");
  const patched = patchFontSlots(source, fontChunkPath);
  assert.ok(patched, "补丁应命中字体 chunk");

  const slots = (text) => {
    const out = {};
    for (const [testId, key] of [
      ["font-family-hand-drawn", "handDrawn"],
      ["font-family-normal", "normal"],
      ["font-family-code", "code"],
    ]) {
      const at = text.indexOf(`testId:"${testId}"`);
      assert.ok(at > 0, `应存在槽位 ${testId}`);
      const head = text.slice(Math.max(0, at - 200), at);
      const found = [...head.matchAll(/value:([\w$]+)(?:\.([A-Za-z0-9 ]+?)|\["([^"]+)"\])(?=,)/g)];
      assert.ok(found.length, `应能解析槽位 ${testId}`);
      out[key] = (found[found.length - 1][2] ?? found[found.length - 1][3]).trim();
    }
    return out;
  };

  assert.deepEqual(slots(source), {
    handDrawn: "Excalifont",
    normal: "Nunito",
    code: "Comic Shanns",
  });
  assert.deepEqual(slots(patched), {
    handDrawn: "Virgil",
    normal: "Helvetica",
    code: "Cascadia",
  });
});

test("网格补丁：关掉引擎虚线网格，但不影响 getEffectiveGridSize", () => {
  const appModule = findFile(PROD, (name, dir) =>
    name.endsWith(".js") && fs.readFileSync(path.join(dir, name), "utf8").includes("embedsValidationStatus:this.")
  );
  assert.ok(appModule, "未找到 App 所在模块");
  const source = fs.readFileSync(appModule, "utf8");

  const patched = patchGridRender(source, appModule);
  assert.ok(patched, "补丁应命中 App 模块");
  assert.ok(patched.length < source.length, "应只把调用表达式换成更短的常量");
  assert.ok(!/renderGrid:\s*[A-Za-z_$][\w$]*\(this\)/.test(patched), "不应残留 renderGrid 调用");
  assert.match(patched, /renderGrid:!1/, "应写入常量 false");
  // 吸附能力必须保留：getEffectiveGridSize 仍依赖谓词，不能被一起改掉
  assert.match(patched, /getEffectiveGridSize/);

  // 非 App 模块直接跳过
  assert.equal(patchGridRender("var x=1;", "/x/dist/prod/chunk-abc.js"), null);
});

test("字体兜底补丁：删掉 esm.sh 兜底 URL，只保留本地 URL", () => {
  const fontUrlsModule = findFile(PROD, (name, dir) =>
    name.endsWith(".js") && fs.readFileSync(path.join(dir, name), "utf8").includes("ASSETS_FALLBACK_URL")
  );
  assert.ok(fontUrlsModule, "未找到定义 ASSETS_FALLBACK_URL 的模块");
  const source = fs.readFileSync(fontUrlsModule, "utf8");
  assert.match(source, /new URL\([\w$]+, ?[\w$]+\.ASSETS_FALLBACK_URL\)/, "原模块应含外部兜底 URL");

  const patched = patchFontFallback(source, fontUrlsModule);
  assert.ok(patched, "补丁应命中字体 URL 模块");
  assert.ok(patched.length < source.length, "应删掉兜底语句，产物应变短");
  assert.ok(
    !/new URL\([\w$]+, ?[\w$]+\.ASSETS_FALLBACK_URL\)/.test(patched),
    "不应残留任何外部兜底 URL 的拼装"
  );
  // 本地 URL 数组必须原样保留（仍要 return 那个变量）
  assert.match(patched, /return [A-Za-z_$][\w$]*\}/, "应化简为直接返回本地 URL 数组");
  // 只处理本地 URL 的入参处理逻辑不能被动到
  assert.match(patched, /EXCALIDRAW_ASSET_PATH/, "本地 URL 拼装逻辑必须保留");

  // 非目标模块直接跳过
  assert.equal(patchFontFallback("var x=1;", "/x/dist/prod/chunk-abc.js"), null);
});

test("图片体积补丁：把引擎的 4MiB 上限放宽到 64MiB", () => {
  const chunk = findFile(PROD, (name, dir) =>
    name.endsWith(".js") && fs.readFileSync(path.join(dir, name), "utf8").includes("4*1024*1024")
  );
  assert.ok(chunk, "未找到含 4*1024*1024 的模块");
  const source = fs.readFileSync(chunk, "utf8");
  assert.match(
    source,
    /4\*1024\*1024,(?=[A-Za-z_$][\w$]*="http:\/\/www\.w3\.org\/2000\/svg")/,
    "原模块应含「图片上限常量 + SVG 命名空间」这对锚点"
  );

  const patched = patchFileSizeLimit(source, chunk);
  assert.ok(patched, "补丁应命中图片上限常量");
  assert.equal(
    [...patched.matchAll(/4\*1024\*1024/g)].length,
    0,
    "补丁后不应残留 4*1024*1024"
  );
  assert.match(patched, new RegExp(`${MAX_IMAGE_BYTES}`), "应写入 64MiB 字面量");
  assert.equal(MAX_IMAGE_BYTES, 64 * 1024 * 1024, "上限应正好是 64MiB");
  // 变量名必须保留：它同时出现在该模块的 export 列表里
  const before = source.match(/([A-Za-z_$][\w$]*)=4\*1024\*1024,/)[1];
  assert.ok(
    patched.includes(`${before}=${MAX_IMAGE_BYTES},`),
    "应保留原变量名，避免导出断链"
  );
  // 结尾逗号是「下一个常量赋值」的分隔符，必须原样保留；
  // 漏掉会产出 `AE=67108864re="…"`（数字字面量紧跟标识符）这种语法错误。
  assert.ok(
    !new RegExp(`${MAX_IMAGE_BYTES}[A-Za-z_$]`).test(patched),
    "替换后必须保留结尾逗号，不能把两个常量粘在一起"
  );

  // 非目标模块直接跳过
  assert.equal(patchFileSizeLimit("var x=1;", "/x/dist/prod/chunk-abc.js"), null);
});

test("补丁在锚点失配时抛出错误（不静默产出错误结果）", () => {
  // zh-CN 模块缺少 default 导出别名 → 必须报错
  assert.throws(() => patchZhCnLocale("export{a as b};", "/x/locales/zh-CN-abc.js"), /default/);
  // 缺少 export 语句 → 必须报错
  assert.throws(() => patchZhCnLocale("var x=1;", "/x/locales/zh-CN-abc.js"), /导出语句/);
  // 命中了槽位标记但缺少可解析的取值 → 必须报错
  assert.throws(
    () => patchFontSlots('testId:"font-family-hand-drawn"', "/x/dist/prod/chunk-abc.js"),
    /无法解析/
  );
  // 槽位取值与预期家族不符 → 必须报错
  assert.throws(
    () =>
      patchFontSlots(
        'value:Kr.Helvetica,testId:"font-family-hand-drawn"',
        "/x/dist/prod/chunk-abc.js"
      ),
    /期望绑定/
  );
  // 是 App 模块但找不到 renderGrid 调用 → 必须报错
  assert.throws(
    () => patchGridRender("embedsValidationStatus:this.x", "/x/dist/prod/index.js"),
    /renderGrid/
  );
  // 有 ASSETS_FALLBACK_URL 但解析不出兜底语句 → 必须报错
  assert.throws(
    () => patchFontFallback('P(jn,"ASSETS_FALLBACK_URL","x")', "/x/dist/prod/chunk-abc.js"),
    /ASSETS_FALLBACK_URL/
  );
  // 出现了 4*1024*1024 但锚点（紧随的 SVG 命名空间）不匹配 → 必须报错
  assert.throws(
    () => patchFileSizeLimit('var a=4*1024*1024,b="other";', "/x/dist/prod/chunk-abc.js"),
    /4\*1024\*1024/
  );
  // 未命中锚点标记的 chunk 直接跳过
  assert.equal(patchFontSlots("var x=1;", "/x/dist/prod/chunk-abc.js"), null);
  assert.equal(patchZhCnLocale("var x=1;", "/x/dist/prod/index.js"), null);
});

// ---------------------------------------------------------------------------
// 回归：补丁链必须「逐个顺序应用」，不能被 ?? 短路吞掉
//
// 引擎把多个补丁目标塞进了同一个 chunk（chunk-K2UTITRG.js 同时含 ASSETS_FALLBACK_URL
// 与 4*1024*1024；index.js 同时含字体槽位与 renderGrid）。曾经的实现写作
// `patchA(code) ?? patchB(code) ?? ...`，于是「第一个命中的补丁」会把后面全部吞掉：
// 构建照样成功、日志没有任何异常，但产物里补丁根本没生效。
// 这两个用例直接拿真实引擎产物验证，是防止该问题复现的最强保证。
// ---------------------------------------------------------------------------

test("补丁链：同一模块上的多个补丁必须全部生效（chunk-K2UTITRG.js）", () => {
  const chunk = findFile(PROD, (name, dir) =>
    name.endsWith(".js") &&
    fs.readFileSync(path.join(dir, name), "utf8").includes("4*1024*1024")
  );
  assert.ok(chunk, "未找到含 4*1024*1024 的模块");
  const source = fs.readFileSync(chunk, "utf8");
  // 前提：这个模块确实同时命中两个补丁，短路链才会出问题
  assert.ok(source.includes("ASSETS_FALLBACK_URL"), "该模块应同时含字体兜底锚点");

  const { code, hits } = applyPatches(source, chunk);
  assert.deepEqual(
    [...hits].sort(),
    ["patchFileSizeLimit", "patchFontFallback"],
    "两个补丁都必须命中，缺一个说明补丁链又被短路了"
  );
  assert.ok(!code.includes("4*1024*1024"), "图片上限必须已被改写");
  assert.ok(code.includes(String(MAX_IMAGE_BYTES)), "图片上限必须已写成 64MiB");
  assert.ok(
    !/return\s+[A-Za-z_$][\w$]*\.push\(new URL\([A-Za-z_$][\w$]*,[A-Za-z_$][\w$]*\.ASSETS_FALLBACK_URL\)\)/.test(
      code
    ),
    "字体外部兜底语句必须已被删除"
  );
});

test("补丁链：同一模块上的多个补丁必须全部生效（index.js）", () => {
  const indexPath = path.join(PROD, "index.js");
  assert.ok(fs.existsSync(indexPath), "未找到 dist/prod/index.js");
  const source = fs.readFileSync(indexPath, "utf8");
  assert.ok(source.includes('testId:"font-family-hand-drawn"'), "该模块应含字体槽位定义");
  assert.ok(/renderGrid:\s*[A-Za-z_$][\w$]*\(this\)/.test(source), "该模块应含 renderGrid 调用");

  const { code, hits } = applyPatches(source, indexPath);
  assert.deepEqual(
    [...hits].sort(),
    ["patchFontSlots", "patchGridRender"],
    "两个补丁都必须命中，缺一个说明补丁链又被短路了"
  );
  assert.ok(code.includes("renderGrid:!1"), "引擎自带虚线网格必须已被关闭");
  assert.ok(
    code.includes('testId:"font-family-hand-drawn"'),
    "槽位标记应仍在（只是取值被改绑）"
  );
  // 三个槽位都必须改绑到单分片家族，且原家族不得残留
  assert.ok(!code.includes(".Excalifont"), "手绘槽位不应再绑 Excalifont");
  assert.ok(!code.includes(".Nunito"), "常规槽位不应再绑 Nunito");
  assert.ok(!code.includes('["Comic Shanns"]'), "代码槽位不应再绑 Comic Shanns");
  for (const to of ["Virgil", "Helvetica", "Cascadia"]) {
    assert.ok(code.includes(to), `槽位应改绑到 ${to}`);
  }
});

test("补丁链：不命中任何补丁的模块原样返回 null（不产生无谓改动）", () => {
  const { code, hits } = applyPatches("export const x = 1;", "/x/node_modules/pkg/index.js");
  assert.deepEqual(hits, []);
  assert.equal(code, "export const x = 1;");
});
