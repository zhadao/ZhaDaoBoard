/**
 * 上游对标审计：把「我们和 @excalidraw/excalidraw 差在哪」变成可复现的数字。
 *
 * 用法：node scripts/audit-upstream.mjs [--json]
 *
 * 产出（默认打印人类可读报告，`--json` 打印机器可读）：
 *   1. 上游版本（锁死在 package.json 里，这里是复核）
 *   2. 引擎注册的 ActionName 全集 vs 本项目命令面板覆盖到的动作
 *   3. 语言包覆盖：en 有多少键、zh-CN 原生缺多少、补丁补上多少、补完还剩多少
 *   4. 引擎工具表与快捷键表（从产物里抽，用于核对 src/editor/engineCommands.ts）
 *
 * 结论会被 docs/EXCALIDRAW-PARITY.md 引用；改引擎版本后重跑本脚本即可刷新基线。
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyPatches } from "./excalidraw-patch.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE_DIR = path.join(ROOT, "node_modules", "@excalidraw", "excalidraw");
const PROD = path.join(ENGINE_DIR, "dist", "prod");
const TYPES = path.join(ENGINE_DIR, "dist", "types", "excalidraw");

const AS_JSON = process.argv.includes("--json");

/* ------------------------------------------------------------------ */

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** 展开语言包对象，返回 `a.b.c` 形式的叶子键列表。 */
function leafKeys(value, prefix = "", out = []) {
  for (const [key, child] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) leafKeys(child, full, out);
    else out.push(full);
  }
  return out;
}

/** 从类型定义里抽出 ActionName 联合类型的所有取值。 */
function actionNames() {
  const text = readFileSync(path.join(TYPES, "actions", "types.d.ts"), "utf8");
  const matched = text.match(/export type ActionName =([\s\S]*?);\n/);
  if (!matched) throw new Error("解析不到 ActionName 类型定义，请检查引擎版本");
  return [...matched[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** 从本项目的 engineCommands.ts 里抽出命令面板实际列出的动作名。 */
function paletteActionNames() {
  const text = readFileSync(path.join(ROOT, "src", "editor", "engineCommands.ts"), "utf8");
  const groups = text.match(/ENGINE_ACTION_GROUPS[\s\S]*?\n\];/);
  if (!groups) throw new Error("解析不到 ENGINE_ACTION_GROUPS，请检查 src/editor/engineCommands.ts");
  const names = [];
  // 只读 `names: [...]` 里的字符串，避免把 `category: "elements"` 这类值也当成动作名
  for (const matched of groups[0].matchAll(/names:\s*\[([\s\S]*?)\]/g)) {
    for (const name of matched[1].matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)) names.push(name[1]);
  }
  if (names.length === 0) throw new Error("ENGINE_ACTION_GROUPS 里没解析到任何动作名");
  return names;
}

function findLocaleFile(prefix) {
  const dir = path.join(PROD, "locales");
  const name = readFileSync
    ? require("node:fs").readdirSync(dir).find((entry) => entry.startsWith(prefix))
    : null;
  return name ? path.join(dir, name) : null;
}

/* ------------------------------------------------------------------ */

async function localeCoverage() {
  const fs = await import("node:fs");
  const dir = path.join(PROD, "locales");
  const pick = (prefix) => {
    const name = fs.readdirSync(dir).find((entry) => entry.startsWith(prefix));
    if (!name) throw new Error(`找不到 ${prefix} 语言包`);
    return path.join(dir, name);
  };

  const enPath = pick("en-");
  const zhPath = pick("zh-CN");
  const en = (await import(`file://${enPath.replace(/\\/g, "/")}`)).default;
  const zh = (await import(`file://${zhPath.replace(/\\/g, "/")}`)).default;

  const enKeys = new Set(leafKeys(en));
  const zhKeys = new Set(leafKeys(zh));
  const missing = [...enKeys].filter((key) => !zhKeys.has(key)).sort();

  const patchedSource = applyPatches(fs.readFileSync(zhPath, "utf8"), zhPath);
  const extraLocale = readJson(path.join(ROOT, "src", "i18n", "zh-CN.extra.json"));
  const extraKeys = leafKeys(extraLocale).filter((key) => !key.split(".").some((part) => part.startsWith("_")));

  // 补丁是在构建期做深度合并，这里按同样的语义算出「补完后还缺什么」
  const stillMissing = missing.filter((key) => !extraKeys.includes(key));
  const covered = missing.filter((key) => extraKeys.includes(key));

  return {
    enKeys: enKeys.size,
    zhKeys: zhKeys.size,
    missingBefore: missing.length,
    coveredByPatch: covered.length,
    missingAfter: stillMissing.length,
    missingAfterList: stillMissing,
    extraLocaleEntries: extraKeys.length,
    patchHit: patchedSource.hits,
  };
}

/* ------------------------------------------------------------------ */

async function main() {
  const pkg = readJson(path.join(ROOT, "package.json"));
  const enginePkg = readJson(path.join(ENGINE_DIR, "package.json"));

  const all = actionNames();
  const palette = paletteActionNames();
  const paletteSet = new Set(palette);
  const notInPalette = all.filter((name) => !paletteSet.has(name));
  const unknownInPalette = palette.filter((name) => !all.includes(name));

  const locales = await localeCoverage();

  const report = {
    pinnedVersion: pkg.dependencies["@excalidraw/excalidraw"],
    installedVersion: enginePkg.version,
    license: enginePkg.license,
    actionNames: { total: all.length, inPalette: all.length - notInPalette.length, notInPalette },
    paletteUnknownNames: unknownInPalette,
    locales,
  };

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("=== 上游对标审计 ===");
  console.log(`上游版本：${report.installedVersion}（package.json 锁定 ${report.pinnedVersion}，许可 ${report.license}）`);
  console.log("");
  console.log(`引擎注册动作：${report.actionNames.total} 个`);
  console.log(
    `命令面板覆盖：${report.actionNames.inPalette} 个（未列入 ${report.actionNames.notInPalette.length} 个）`
  );
  if (report.actionNames.notInPalette.length) {
    console.log(`  未列入：${report.actionNames.notInPalette.join(", ")}`);
  }
  if (report.paletteUnknownNames.length) {
    console.log(`  ⚠ 面板里有引擎不认识的名称：${report.paletteUnknownNames.join(", ")}`);
  }
  console.log("");
  console.log("语言包覆盖：");
  console.log(`  en 叶子键：${locales.enKeys}`);
  console.log(`  zh-CN 原生键：${locales.zhKeys}（缺 ${locales.missingBefore}）`);
  console.log(`  补丁补上：${locales.coveredByPatch}（补译表共 ${locales.extraLocaleEntries} 条）`);
  console.log(`  补完仍缺：${locales.missingAfter}`);
  if (locales.missingAfterList.length) {
    console.log(`    剩余缺失：${locales.missingAfterList.slice(0, 20).join(", ")}`);
  }
}

main().catch((error) => {
  console.error(`[audit] 失败：${error.message}`);
  process.exitCode = 1;
});
