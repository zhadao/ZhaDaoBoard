/**
 * Excalidraw 构建期补丁（仅针对 `@excalidraw/excalidraw@0.18.1` 的 dist/prod 产物）
 *
 * 为什么需要补丁：引擎把语言包加载表、字体槽位与网格绘制开关都硬编码在压缩后的
 * 模块作用域里，没有任何公开 API 可以在运行时替换。补丁只做三件事：
 *
 *   1. patchZhCnLocale —— 把 zh-CN 缺失的 91 个键合并进语言包模块的 default 导出对象
 *      （引擎 i18n 的回退顺序是 当前语言 → en → 显式 fallback，所以缺键会显示英文）
 *
 *   2. patchFontSlots —— 把「三个字体槽位」从 Excalifont / Nunito / Comic Shanns
 *      改绑到单分片的 Virgil / Helvetica / Cascadia。前者有两个家族的 unicode-range
 *      不含中文，中文会掉到 Xiaolai 回退（131 个分片），既慢又浪费。
 *
 *   3. patchGridRender —— 关掉引擎自带的虚线网格绘制，但保留「对齐到网格」能力。
 *      引擎用一个谓词同时决定「画不画网格」和「要不要吸附」，本项目用外壳自绘点阵，
 *      两者必须解耦，否则点阵与虚线网格会叠在一起。
 *
 *   4. patchFontFallback —— 去掉字体 URL 解析里的 esm.sh 兜底。
 *      引擎的 `FontFaceUrls.createUrls()` 在给出本地 URL 之后，**无条件**再追加一个
 *      `https://esm.sh/@excalidraw/excalidraw@0.18.1/dist/prod/` 前缀的 URL。
 *      这个 URL 被 `getContent()` 当成「第一个 URL 失败时的备用源」逐个尝试，
 *      于是每次字体子集化失败都会真的去联网，被 CSP 拦下并打一堆 console 报错。
 *      本项目是纯本地工具，外部兜底没有任何存在价值，直接删掉。
 *
 *   5. patchFileSizeLimit —— 放宽引擎对「单张图片」的 4MB 上限。
 *      引擎在插入图片时做 `if (size > 4 * 1024 * 1024) throw fileTooBig`，
 *      对「图片灵感板」这个定位来说过于苛刻：一张手机直出照片就可能超。
 *      本工具是纯本地存储、没有带宽成本，所以把上限提到 64MiB。
 *      服务端的 IMAGE_LIMIT / BODY_LIMIT 必须同步放大，否则会出现
 *      「画布接受、保存失败」的割裂体验（见 server/server.cjs 顶部常量）。
 *
 * 五个补丁都用「特征串锚定 + 找不到就抛错」的策略：
 * 引擎升级导致锚点失配时构建直接失败，绝不静默产出错误结果。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTRA_LOCALE_PATH = path.resolve(HERE, "../src/i18n/zh-CN.extra.json");

/** 去掉以下划线开头的说明性键，避免污染语言包。 */
function stripMeta(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith("_")) continue;
    out[key] = stripMeta(child);
  }
  return out;
}

let cachedExtraLocale = null;
function extraLocale() {
  if (!cachedExtraLocale) {
    cachedExtraLocale = stripMeta(JSON.parse(fs.readFileSync(EXTRA_LOCALE_PATH, "utf8")));
  }
  return cachedExtraLocale;
}

/** 只取路径部分，忽略 Vite 追加的 `?v=` / `?import` 等查询串。 */
const bareId = (id) => id.split("?")[0];

// ---------------------------------------------------------------------------
// 1. zh-CN 语言包补译
// ---------------------------------------------------------------------------

const ZH_CN_ID = /[\\/]locales[\\/]zh-CN[^\\/]*\.js$/;
const EXPORT_TAIL = /export\s*\{([^}]*)\}\s*;?\s*$/;
const DEFAULT_ALIAS = /([\w$]+)\s+as\s+default/;

export function patchZhCnLocale(code, id) {
  if (!ZH_CN_ID.test(bareId(id))) return null;

  const exportTail = code.match(EXPORT_TAIL);
  if (!exportTail) {
    throw new Error(`[wb-patch] 无法解析 zh-CN 语言包的导出语句（${id}），请检查引擎版本。`);
  }
  const alias = exportTail[1].match(DEFAULT_ALIAS);
  if (!alias) {
    throw new Error(`[wb-patch] zh-CN 语言包没有 default 导出（${id}），请检查引擎版本。`);
  }

  const extra = extraLocale();
  const snippet = [
    ";",
    "(function(){",
    `var __wbExtra=${JSON.stringify(extra)};`,
    "var __wbDeep=function(target,source){",
    "for(var key in source){",
    "var value=source[key];",
    "if(value&&typeof value===\"object\"&&!Array.isArray(value)){",
    "target[key]=target[key]&&typeof target[key]===\"object\"?target[key]:{};",
    "__wbDeep(target[key],value);",
    "}else{target[key]=value;}",
    "}",
    "};",
    `__wbDeep(${alias[1]},__wbExtra);`,
    "})();",
    "",
  ].join("");

  return code + snippet;
}

// ---------------------------------------------------------------------------
// 2. 字体槽位改绑
// ---------------------------------------------------------------------------

/** 字体槽位定义位于 dist/prod/index.js（不同版本可能落在某个 chunk 里），这里放宽到整个 prod 目录。 */
const PROD_MODULE_ID = /[\\/]dist[\\/]prod[\\/][^\\/]+\.js$/;

/** 引擎里「三个字体槽位」的 testId → 当前绑定的家族 → 要改绑到的单分片家族 */
const FONT_SLOTS = [
  { testId: "font-family-hand-drawn", from: "Excalifont", to: "Virgil" },
  { testId: "font-family-normal", from: "Nunito", to: "Helvetica" },
  { testId: "font-family-code", from: "Comic Shanns", to: "Cascadia" },
];

const SLOT_VALUE = /value:([\w$]+)(?:\.([A-Za-z0-9 ]+?)|\["([^"]+)"\])(?=,)/g;

function rebindSlot(code, slot) {
  const marker = `testId:"${slot.testId}"`;
  const at = code.indexOf(marker);
  if (at < 0) {
    throw new Error(`[wb-patch] 未找到字体槽位 ${slot.testId}，请检查引擎版本。`);
  }
  // 三个槽位在源码里是连续的数组元素，向前取最近的一个 value: 才是本槽位的取值。
  const from = Math.max(0, at - 200);
  const head = code.slice(from, at);
  const matches = [...head.matchAll(SLOT_VALUE)];
  const found = matches[matches.length - 1];
  if (!found) {
    throw new Error(`[wb-patch] 无法解析字体槽位 ${slot.testId} 的取值，请检查引擎版本。`);
  }
  const family = (found[2] ?? found[3]).trim();
  if (family !== slot.from) {
    throw new Error(
      `[wb-patch] 字体槽位 ${slot.testId} 期望绑定 ${slot.from}，实际为 ${family}，请检查引擎版本。`
    );
  }
  const start = from + found.index;
  const end = start + found[0].length;
  return code.slice(0, start) + `value:${found[1]}.${slot.to}` + code.slice(end);
}

export function patchFontSlots(code, id) {
  if (!PROD_MODULE_ID.test(bareId(id))) return null;
  // 只有包含字体槽位定义的那个模块需要处理，其余模块直接跳过。
  if (!code.includes('testId:"font-family-hand-drawn"')) return null;

  let out = code;
  for (const slot of FONT_SLOTS) out = rebindSlot(out, slot);
  return out;
}

// ---------------------------------------------------------------------------
// 3. 关闭引擎自带网格绘制（保留吸附）
// ---------------------------------------------------------------------------

/**
 * 引擎里同一个谓词被用在两处：
 *   - `getEffectiveGridSize()` → 返回 `gridSize` 或 `null`，决定要不要对齐到网格（要保留）
 *   - `renderConfig.renderGrid`  → 决定要不要画虚线网格（要关掉，改用外壳点阵）
 *
 * 只有把「渲染」这一处替换成常量 `false`，才能让点阵的「显示」与「吸附」彻底解耦。
 * `gridModeEnabled` 仍然照常驱动吸附，只是不再有任何像素被画出来。
 */
const GRID_RENDER = /renderGrid:\s*[A-Za-z_$][\w$]*\(this\)/g;
/**
 * App 模块独有、且与 renderGrid 同处一个 renderConfig 字面量里的标记。
 * 用它区分「App 模块但锚点丢了」（要报错）与「别的 prod 模块」（直接跳过）。
 */
const APP_RENDER_CONFIG = "embedsValidationStatus:this.";

export function patchGridRender(code, id) {
  if (!PROD_MODULE_ID.test(bareId(id))) return null;

  const matches = [...code.matchAll(GRID_RENDER)];
  if (matches.length === 0) {
    if (code.includes(APP_RENDER_CONFIG)) {
      throw new Error("[wb-patch] App 模块中找不到 renderGrid 调用，请检查引擎版本。");
    }
    return null;
  }
  if (matches.length > 1) {
    throw new Error(
      `[wb-patch] 期望在 App 模块中命中 1 处 renderGrid 调用，实际 ${matches.length} 处，请检查引擎版本。`
    );
  }
  return code.replace(GRID_RENDER, "renderGrid:!1");
}

// ---------------------------------------------------------------------------
// 4. 去掉字体 URL 的 esm.sh 兜底
// ---------------------------------------------------------------------------

/**
 * 原始形态（0.18.1，`createUrls` 的返回语句）：
 *
 *   return r.push(new URL(n, jn.ASSETS_FALLBACK_URL)), r}
 *
 * 其中 `r` 是已经按 `window.EXCALIDRAW_ASSET_PATH` 拼好的本地 URL 数组。
 * 补丁把它化简成 `return r}`：本地 URL 全部保留，外部兜底整条删除。
 *
 * 注意：`window.EXCALIDRAW_ASSET_PATH` 由 `src/main.tsx` 无条件设置，
 * 因此化简后 `r` 至少含一个本地 URL，不会出现空数组。
 */
const FONT_FALLBACK_TAIL =
  /return\s+([A-Za-z_$][\w$]*)\.push\(new URL\([A-Za-z_$][\w$]*,[A-Za-z_$][\w$]*\.ASSETS_FALLBACK_URL\)\),\1\}/g;

export function patchFontFallback(code, id) {
  if (!PROD_MODULE_ID.test(bareId(id))) return null;

  const matches = [...code.matchAll(FONT_FALLBACK_TAIL)];
  if (matches.length === 0) {
    // 只有定义了 ASSETS_FALLBACK_URL 的模块才应该出现这个锚点。
    if (code.includes("ASSETS_FALLBACK_URL")) {
      throw new Error("[wb-patch] 找到 ASSETS_FALLBACK_URL 但解析不出 createUrls 的兜底语句，请检查引擎版本。");
    }
    return null;
  }
  if (matches.length > 1) {
    throw new Error(
      `[wb-patch] 期望命中 1 处字体兜底语句，实际 ${matches.length} 处，请检查引擎版本。`
    );
  }
  return code.replace(FONT_FALLBACK_TAIL, "return $1}");
}

// ---------------------------------------------------------------------------
// 5. 放宽单张图片体积上限（4MiB → 64MiB）
// ---------------------------------------------------------------------------

/**
 * 引擎原始形态（0.18.1，位于某个 prod chunk 的常量区）：
 *
 *   Vi=10,OE=1440,AE=4*1024*1024,re="http://www.w3.org/2000/svg"
 *
 * 其中 `AE` 被导出到 index.js（`AE as oa` → `oa as Zd`），只在插入图片时
 * 用于 `if (size > Zd) throw errors.fileTooBig`。全产物里 `4*1024*1024` 仅此一处。
 *
 * 锚点用「紧随其后的 SVG 命名空间赋值」来定位，避免误伤其它同值常量；
 * 若值本身被上游改掉（不再等于 4*1024*1024），补丁会静默跳过，
 * 由 `scripts/verify-offline.mjs` 的产物级断言（必须出现 64MiB 字面量）兜底。
 */
const FILE_SIZE_LIMIT =
  /([A-Za-z_$][\w$]*)=4\*1024\*1024,(?=[A-Za-z_$][\w$]*="http:\/\/www\.w3\.org\/2000\/svg")/g;

/** 64MiB：本地存储没有带宽成本，只拦「大得离谱」的文件。 */
export const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

export function patchFileSizeLimit(code, id) {
  if (!PROD_MODULE_ID.test(bareId(id))) return null;

  const matches = [...code.matchAll(FILE_SIZE_LIMIT)];
  if (matches.length === 0) {
    if (code.includes("4*1024*1024")) {
      throw new Error("[wb-patch] 找到 4*1024*1024 但锚点不匹配，请检查引擎版本。");
    }
    return null;
  }
  if (matches.length > 1) {
    throw new Error(
      `[wb-patch] 期望命中 1 处图片体积上限常量，实际 ${matches.length} 处，请检查引擎版本。`
    );
  }
  // 保留原变量名：它同时出现在该模块的 export 列表里，改名会让导出断链。
  // 注意 FILE_SIZE_LIMIT 把结尾的 `,` 也纳入了匹配（它同时是「下一个常量赋值」的分隔符），
  // 所以替换串必须把这个逗号补回来，否则会产出 `AE=67108864re="…"` 这种语法错误。
  return code.replace(FILE_SIZE_LIMIT, (_match, name) => `${name}=${MAX_IMAGE_BYTES},`);
}

// ---------------------------------------------------------------------------
// Vite 插件入口
// ---------------------------------------------------------------------------

/**
 * 五个补丁的执行顺序。它们各自锚定不同的特征串，互不重叠。
 *
 * 注意：这里必须**逐个顺序应用**，不能用 `a() ?? b()` 短路。
 * 引擎把多个补丁目标放在同一个 chunk 里（例如 `chunk-K2UTITRG.js` 同时含
 * `ASSETS_FALLBACK_URL` 与 `4*1024*1024`，`index.js` 同时含字体槽位与 `renderGrid`），
 * 短路链会让「第一个命中的补丁」把后面所有补丁全部吞掉 —— 表现为构建成功、
 * 但产物里补丁根本没生效（且不报错）。
 */
export const PATCH_PIPELINE = [
  patchZhCnLocale,
  patchFontSlots,
  patchGridRender,
  patchFontFallback,
  patchFileSizeLimit,
];

/**
 * 按顺序应用全部补丁，返回「是否至少命中一个」。
 * 抽成独立函数是为了能被测试直接驱动，不必经过 Vite。
 *
 * @param {string} code
 * @param {string} id
 * @returns {{ code: string, hits: string[] }}
 */
export function applyPatches(code, id) {
  let out = code;
  const hits = [];
  for (const patch of PATCH_PIPELINE) {
    const next = patch(out, id);
    if (next === null || next === undefined) continue;
    hits.push(patch.name);
    out = next;
  }
  return { code: out, hits };
}

/**
 * Vite 插件入口。
 * @returns {import("vite").Plugin}
 */
export function wbExcalidrawPatch() {
  return {
    name: "wb-excalidraw-patch",
    enforce: "pre",
    transform(code, id) {
      if (!bareId(id).includes("node_modules")) return null;
      const { code: patched, hits } = applyPatches(code, id);
      return hits.length > 0 ? patched : null;
    },
  };
}
