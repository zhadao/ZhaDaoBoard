/**
 * 把图标写进 exe 的 PE 资源节（RT_GROUP_ICON #1 + RT_ICON）。
 *
 * 用法：
 *   node scripts/set-exe-icon.mjs <exe> <ico>     # 命令行
 *   或 import { setExeIcon, resolveIconSource } from "./set-exe-icon.mjs"
 *      （make-exe.mjs 构建时写入、verify-exe.mjs 校验时读同一个源）
 *
 * 图标源优先级（见 resolveIconSource）：
 *   1. `assets/app.ico`  —— 正式图标（多尺寸 ICO，6 档：16/32/48/64/128/256，全部 PNG 压缩）
 *   2. `build/icon.ico`  —— 由 `npm run build:icon` 从 public/logo.svg 光栅化生成（回退）
 * 构建与验证都走同一个函数，避免「exe 里装的是 A、验证脚本按 B 断言」这种假绿。
 *
 * 为什么用纯 JS 而不是 PowerShell + kernel32：
 *   原来那版是 P/Invoke `BeginUpdateResource` / `UpdateResource`，在本机实测
 *   「从 Node 里 spawn powershell.exe」会被宿主直接挡掉（`EBUSY`，加不加沙箱都一样），
 *   于是 `npm run build:exe` 必然在最后一步失败，只能人工补跑一次脚本。
 *   换成 `resedit`（纯 JS 的 PE 资源编辑器）之后，整个构建不再依赖任何外部进程，
 *   在任何终端里都能一次跑完。
 *
 * 资源语言用 1033（en-US）：必须与 node.exe 自带资源的语言一致，
 * 否则 Shell 按「线程语言 → LANG_NEUTRAL」查找时会落空，看起来就是「图标没换掉」。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRequire = createRequire(path.join(ROOT, "package.json"));

/** node.exe 自带图标组的 ID 与语言（见文件头说明）。 */
const ICON_GROUP_ID = 1;
const RESOURCE_LANG = 1033;

/**
 * 图标源候选，按优先级排列。第一个存在的即被采用。
 * 相对仓库根的路径，便于日志里打印出「到底用了哪个」。
 */
export const ICON_SOURCE_CANDIDATES = ["assets/app.ico", "build/icon.ico"];

/**
 * 解析出实际要用的图标源。
 * @returns {string | null} 绝对路径；两个候选都不存在时返回 null（调用方决定是报错还是跳过）。
 */
export function resolveIconSource() {
  for (const relative of ICON_SOURCE_CANDIDATES) {
    const absolute = path.join(ROOT, relative);
    if (existsSync(absolute)) return absolute;
  }
  return null;
}

/** 读 ICO 目录，返回每个条目的尺寸与类型。用于日志与校验，不参与写资源。 */
export function readIcoEntries(ico) {
  if (ico.length < 6 || ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) {
    throw new Error("不是合法的 ICO 文件（type 必须为 1）");
  }
  const count = ico.readUInt16LE(4);
  if (count === 0) throw new Error("ICO 里没有任何图像");
  const entries = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    const width = ico[at] === 0 ? 256 : ico[at];
    const height = ico[at + 1] === 0 ? 256 : ico[at + 1];
    const bytes = ico.readUInt32LE(at + 8);
    const offset = ico.readUInt32LE(at + 12);
    if (offset + bytes > ico.length) throw new Error(`ICO 第 ${i} 个条目越界`);
    const data = ico.subarray(offset, offset + bytes);
    const isPng = data.length > 8 && data.readUInt32BE(0) === 0x89504e47;
    entries.push({ width, height, bytes, kind: isPng ? "png" : "bmp" });
  }
  return entries;
}

/**
 * 加载 resedit。优先用工程依赖；找不到时退回 managed Node 的隔离 workspace
 * （与 make-exe.mjs 找 postject 的策略一致，避免依赖全局 npm）。
 */
function loadResEdit() {
  try {
    return projectRequire(projectRequire.resolve("resedit"));
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
  }
  const moduleDirs = [
    ...(process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean),
    path.resolve(path.dirname(process.execPath), "..", "..", "workspace", "node_modules"),
  ];
  for (const dir of moduleDirs) {
    const candidate = path.resolve(dir, "resedit");
    try {
      return projectRequire(candidate);
    } catch {
      /* 换下一个 */
    }
  }
  throw new Error("未找到 resedit：请 npm i -D resedit（或通过 NODE_PATH 指定其 node_modules）。");
}

/**
 * 就地替换 exe 的图标资源。
 * @returns {{ sizes: number[], kinds: string[], groupId: number, language: number }}
 */
export function setExeIcon(exePath, icoPath) {
  const ResEdit = loadResEdit();
  const ico = readFileSync(icoPath);
  const entries = readIcoEntries(ico);

  const data = readFileSync(exePath);
  // node.exe 带 Authenticode 签名，必须 ignoreCert 才能解析；
  // 注入 SEA 载荷本来就会让签名失效（Node 官方文档说明这是可选的清理步骤）。
  const exe = ResEdit.NtExecutable.from(data, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const iconFile = ResEdit.Data.IconFile.from(ico);
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    ICON_GROUP_ID,
    RESOURCE_LANG,
    iconFile.icons.map((icon) => icon.data)
  );
  res.outputResource(exe);

  writeFileSync(exePath, Buffer.from(exe.generate()));
  return {
    sizes: entries.map((entry) => entry.width),
    kinds: entries.map((entry) => entry.kind),
    groupId: ICON_GROUP_ID,
    language: RESOURCE_LANG,
  };
}

function main() {
  const [exeArg, icoArg] = process.argv.slice(2);
  if (!exeArg || !icoArg) throw new Error("用法：node scripts/set-exe-icon.mjs <exe> <ico>");
  const result = setExeIcon(path.resolve(exeArg), path.resolve(icoArg));
  console.log(
    `[icon] 已写入图标：${result.sizes
      .map((size, i) => `${size}(${result.kinds[i]})`)
      .join(" ")}（组 ${result.groupId}，语言 ${result.language}）`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[icon] 写入失败：${error.message}`);
    process.exitCode = 1;
  }
}
