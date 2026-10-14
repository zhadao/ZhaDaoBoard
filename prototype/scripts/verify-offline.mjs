// 纯离线自检：把「这个白板不会联网」变成可执行断言，而不是一句口头承诺。
//
// 用法：npm run verify:offline   （需要先 npm run build）
//
// 检查四件事：
//   1. dist/index.html 引用的所有脚本/样式都在本地，没有一个指向外网
//   2. 引擎会请求的每一个字体家族都能在 dist 里命中本地文件（否则引擎会回退 esm.sh）
//   3. 五个构建期补丁都在产物里留下了可见痕迹（防止补丁被静默吞掉）
//   4. server.cjs 确实下发了禁止外网的 CSP
// 最后把 dist 里残留的外链「报告」出来——它们是引擎里已下线/已隐藏功能的字符串，
// 由 CSP 兜底拦截，不算失败，但必须看得见。
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const failures = [];

function fail(message) {
  failures.push(message);
}

function readDist(relative) {
  const file = path.join(DIST, relative);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/* ---------------- 0. 构建产物存在 ---------------- */
if (!existsSync(DIST) || !statSync(DIST).isDirectory()) {
  console.error("[offline] 未找到 dist/，请先运行 npm run build。");
  process.exit(1);
}

/* ---------------- 1. index.html 全部同源 ---------------- */
const html = readDist("index.html");
if (html === null) {
  fail("dist/index.html 缺失");
} else {
  const refs = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]);
  for (const ref of refs) {
    if (/^(?:https?:)?\/\//i.test(ref)) {
      fail(`dist/index.html 引用了外网地址：${ref}`);
      continue;
    }
    if (ref.startsWith("data:") || ref.startsWith("#")) continue;
    // base 是 "./"，去掉查询串后相对 dist 根解析
    const relative = ref.replace(/^\.?\//, "").split("?")[0];
    if (relative && !existsSync(path.join(DIST, relative))) {
      fail(`dist/index.html 引用的本地文件不存在：${ref}`);
    }
  }
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) {
    fail("dist/index.html 仍含内联 <script>，与 script-src 'self' 的 CSP 冲突");
  }
}

/* ---------------- 2. 字体家族全部能落到本地 ---------------- */
const mapText = readDist("font-map.json");
if (mapText === null) {
  fail("dist/font-map.json 缺失：server.cjs 将无法把引擎的字体家族别名到普惠体");
} else {
  let map;
  try {
    map = JSON.parse(mapText);
  } catch {
    fail("dist/font-map.json 不是合法 JSON");
  }
  if (map) {
    const weights = map.weights ?? {};
    const families = map.families ?? {};
    if (typeof map.fallback !== "string" || !Object.hasOwn(weights, map.fallback)) {
      fail("font-map.json 的 fallback 未指向任何已知字重");
    }
    for (const [family, weight] of Object.entries(families)) {
      if (!Object.hasOwn(weights, weight)) fail(`字体家族 ${family} 指向未知字重 ${weight}`);
    }
    for (const [weight, relative] of Object.entries(weights)) {
      if (!relative || relative.startsWith("/") || relative.includes("..")) {
        fail(`字体字重 ${weight} 的路径不安全：${relative}`);
      } else if (!existsSync(path.join(DIST, relative))) {
        fail(`字体字重 ${weight} 指向的文件不存在：${relative}`);
      }
    }
  }
}

/* ---------------- 2.5 引擎的字体兜底 URL 必须已被补丁摘掉 ---------------- */
// 引擎 `FontFaceUrls.createUrls()` 原本会在本地 URL 之后无条件追加一个 esm.sh 前缀的 URL，
// 子集化失败时会真的去联网取它。patchFontFallback 负责摘掉这条语句，这里做产物级回归断言。
const FALLBACK_ASSEMBLY = /new URL\([A-Za-z_$][\w$]*,\s*[A-Za-z_$][\w$]*\.ASSETS_FALLBACK_URL\)/;
const distJs = walk(DIST).filter((file) => file.endsWith(".js"));
let fallbackHits = 0;
for (const file of distJs) {
  const text = readFileSync(file, "utf8");
  if (FALLBACK_ASSEMBLY.test(text)) {
    fallbackHits++;
    fail(`构建产物仍在拼装外部字体兜底 URL：${path.relative(DIST, file).split(path.sep).join("/")}`);
  }
}
if (fallbackHits === 0 && !distJs.some((file) => readFileSync(file, "utf8").includes("ASSETS_FALLBACK_URL"))) {
  // 补丁锚点整个消失了，说明引擎版本变了、补丁可能已静默失效
  fail("构建产物里找不到 ASSETS_FALLBACK_URL 锚点，字体兜底补丁可能已失效");
}

/* ---------------- 2.6 其余构建期补丁必须在产物里生效 ---------------- */
// 为什么要在产物级再验一遍：补丁链曾经用 `a() ?? b()` 短路，同一个 chunk 里的
// 后续补丁会被静默吞掉——单测（只验单个补丁函数）全绿，构建也成功，但产物没改。
// 这里直接在 dist 上断言每个补丁的「可见痕迹」，是最后一道保险。
const distJsText = distJs.map((file) => [file, readFileSync(file, "utf8")]);
const relName = (file) => path.relative(DIST, file).split(path.sep).join("/");

// 2.6.1 图片体积上限：4MiB 必须消失，64MiB 必须出现
const IMAGE_LIMIT_SRC = /4\*1024\*1024/;
const IMAGE_LIMIT_PATCHED = "67108864"; // 64 * 1024 * 1024
for (const [file, text] of distJsText) {
  if (IMAGE_LIMIT_SRC.test(text)) {
    fail(`构建产物仍残留引擎原始的 4MiB 图片上限：${relName(file)}`);
  }
}
if (!distJsText.some(([, text]) => text.includes(IMAGE_LIMIT_PATCHED))) {
  fail("构建产物里找不到 64MiB 图片上限字面量，patchFileSizeLimit 可能已静默失效");
}

// 2.6.2 引擎自带虚线网格必须已关闭（点阵由外壳自绘，两者不能叠加）
if (!distJsText.some(([, text]) => text.includes("renderGrid:!1"))) {
  fail("构建产物里找不到 renderGrid:!1，patchGridRender 可能已静默失效");
}

// 2.6.3 三个字体槽位必须已改绑到单分片家族
// 注意：`FontFamily.Excalifont` / `FontFamily.Nunito` 这两个「枚举值」在引擎里另有用途
// （字体度量表、默认家族），压缩后仍会以 `ut.Excalifont` 形式出现，属正常残留。
// 这里只针对「字体选择器数组」里的槽位绑定做断言，即 `[{value:X.<family>,icon:…,testId:"font-family-*"}]`。
const SLOT_MARKER = 'testId:"font-family-hand-drawn"';
const slotHost = distJsText.find(([, text]) => text.includes(SLOT_MARKER));
if (!slotHost) {
  fail("构建产物里找不到字体选择器数组（font-family-hand-drawn），patchFontSlots 可能已静默失效");
} else {
  const at = slotHost[1].indexOf(SLOT_MARKER);
  const arrayStart = slotHost[1].lastIndexOf("[{value:", at);
  // 从数组起点取到第三个槽位结束，覆盖三个槽位的绑定值
  const region = slotHost[1].slice(arrayStart < 0 ? at : arrayStart, at + 400);
  for (const family of ["Virgil", "Helvetica", "Cascadia"]) {
    if (!region.includes(`.${family}`)) {
      fail(`字体选择器里找不到改绑后的家族 ${family}，patchFontSlots 未完全生效`);
    }
  }
  for (const family of ["Excalifont", "Nunito"]) {
    if (region.includes(`.${family}`)) {
      fail(`字体选择器仍绑着多分片家族 ${family}，patchFontSlots 未完全生效`);
    }
  }
  if (region.includes('["Comic Shanns"]')) {
    fail('字体选择器仍绑着多分片家族 Comic Shanns，patchFontSlots 未完全生效');
  }
}

// 2.6.4 zh-CN 补译必须进入语言包（压缩会改名局部变量，所以按「补译内容」验）
const EXTRA_LOCALE = JSON.parse(
  readFileSync(path.join(ROOT, "src", "i18n", "zh-CN.extra.json"), "utf8")
);
const sampleStrings = [];
(function collect(node) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("_")) continue;
    if (typeof value === "string") sampleStrings.push(value);
    else if (value && typeof value === "object") collect(value);
  }
})(EXTRA_LOCALE);
const zhChunk = distJsText.find(([file]) => /zh-CN/.test(relName(file)));
if (!zhChunk) {
  fail("构建产物里找不到 zh-CN 语言包 chunk");
} else {
  const probe = sampleStrings.slice(0, 12);
  const missing = probe.filter((value) => !zhChunk[1].includes(value));
  if (missing.length) {
    fail(`zh-CN 语言包缺少补译内容（示例：${missing.slice(0, 3).join("、")}），patchZhCnLocale 可能已静默失效`);
  }
}

/* ---------------- 3. server.cjs 的 CSP ---------------- */
const server = readFileSync(path.join(ROOT, "server", "server.cjs"), "utf8");
for (const directive of ["default-src 'self'", "connect-src 'self'", "frame-src 'none'", "object-src 'none'", "form-action 'none'"]) {
  if (!server.includes(directive)) fail(`server.cjs 的 CSP 缺少 ${directive}`);
}
if (/script-src 'self' 'unsafe-inline'/.test(server)) {
  fail("server.cjs 的 CSP 放开了内联脚本（script-src 不应包含 unsafe-inline）");
}

/* ---------------- 4. 报告残留外链（由 CSP 拦截，不算失败） ---------------- */
// 注意：字体兜底补丁摘掉的是「拼装并尝试」这一步，esm.sh 这个字符串常量本身仍留在引擎里，
// 但它已经没有任何调用点，只是一段死代码。这里如实报告出来，避免误以为还有联网路径。
const origins = new Map();
for (const file of walk(DIST)) {
  if (!/\.(?:js|css|html|json)$/.test(file)) continue;
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/https?:\/\/[A-Za-z0-9.-]+/g)) {
    const origin = match[0];
    if (origin === "http://www.w3.org" || origin === "https://www.w3.org") continue; // SVG 命名空间
    if (!origins.has(origin)) origins.set(origin, new Set());
    origins.get(origin).add(path.relative(DIST, file).split(path.sep).join("/"));
  }
}

/* ---------------- 输出 ---------------- */
if (origins.size) {
  console.log(`[offline] 构建产物里仍有 ${origins.size} 个外部域名（均为无调用点的引擎字符串，CSP 兜底）：`);
  for (const [origin, files] of [...origins].sort()) {
    console.log(`  ${origin}  ← ${[...files].join(", ")}`);
  }
}

if (failures.length) {
  console.error(`\n[offline] 发现 ${failures.length} 处问题：`);
  for (const message of failures) console.error(`  - ${message}`);
  process.exitCode = 1;
} else {
  console.log(
    "[offline] 通过：入口全同源、字体家族全部本地命中、无外部字体兜底、CSP 已禁止外网连接与 iframe。"
  );
  console.log(
    "[offline] 构建期补丁全部生效：zh-CN 补译、字体槽位改绑、虚线网格关闭、外部字体兜底删除、图片上限 64MiB。"
  );
}
