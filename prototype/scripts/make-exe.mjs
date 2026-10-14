// 用法：node scripts/make-exe.mjs [输出 exe 路径]；默认读取工程根目录的 sea-prep.blob。
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  setExeIcon as writeIcon,
  resolveIconSource,
  ICON_SOURCE_CANDIDATES,
} from "./set-exe-icon.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRequire = createRequire(path.join(ROOT, "package.json"));

/** 把图标写进 exe 的 PE 资源节（纯 JS，见 scripts/set-exe-icon.mjs 的说明）。 */
function setExeIcon(stagedExe) {
  const iconPath = resolveIconSource();
  if (!iconPath) {
    console.warn(
      `[exe] 未找到任何图标源（依次尝试 ${ICON_SOURCE_CANDIDATES.join(" → ")}），跳过图标设置。`
    );
    return;
  }
  const result = writeIcon(stagedExe, iconPath);
  console.log(
    `[exe] 图标源 ${path.relative(ROOT, iconPath)}；已写入 ` +
      `${result.sizes.map((size, i) => `${size}(${result.kinds[i]})`).join(" ")}（资源语言 ${result.language}）`
  );
}

function loadPostject() {
  let entry;
  try {
    entry = projectRequire.resolve("postject");
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
  }
  if (entry) return projectRequire(entry);

  // 此 managed runtime 的隔离依赖位于 node/workspace/node_modules，不使用全局 npm。
  const moduleDirs = [
    ...(process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean),
    path.resolve(path.dirname(process.execPath), "..", "..", "workspace", "node_modules"),
  ];
  for (const dir of moduleDirs) {
    const candidate = path.resolve(dir, "postject");
    if (!existsSync(candidate)) continue;
    return projectRequire(candidate);
  }
  throw new Error("未找到 postject：请安装到项目或 managed Node 的隔离 workspace，或通过 NODE_PATH 指定其 node_modules。");
}

async function main() {
  if (process.platform !== "win32") throw new Error("此脚本用于构建 Windows exe，请使用 Windows managed Node。");
  if (process.argv.length > 3) throw new Error("用法：node scripts/make-exe.mjs [输出 exe 路径]");
  const outPath = process.argv[2]
    ? path.resolve(ROOT, process.argv[2])
    : path.resolve(ROOT, process.env.OUTPUT_DIR || ".", "WhiteBoard.exe");
  if (path.extname(outPath).toLowerCase() !== ".exe") throw new Error("输出文件必须使用 .exe 扩展名。");
  const nodePath = realpathSync(process.execPath).toLowerCase();
  if (outPath.toLowerCase() === nodePath || (existsSync(outPath) && realpathSync(outPath).toLowerCase() === nodePath)) {
    throw new Error("输出路径不能覆盖正在使用的 managed Node。");
  }
  const blobPath = path.join(ROOT, "sea-prep.blob");
  if (!existsSync(blobPath)) throw new Error("缺少 sea-prep.blob，请先使用同一 Node 运行 scripts/build-exe.mjs。");
  const blob = readFileSync(blobPath);
  const { inject } = loadPostject();
  const stagingDir = mkdtempSync(path.join(ROOT, ".sea-exe-"));
  try {
    const stagedExe = path.join(stagingDir, "WhiteBoard.exe");
    copyFileSync(process.execPath, stagedExe);
    // Node 22 官方 SEA 文档说明 Windows 移除签名是可选步骤；成功注入后不再修改签名。
    // https://nodejs.org/download/release/v22.22.2/docs/api/single-executable-applications.html
    await inject(stagedExe, "NODE_SEA_BLOB", blob, {
      sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    });
    // 顺序不能反：先注入 SEA 载荷、再写图标。
    // 实测把顺序倒过来（先改资源再 inject）会让 postject 直接报
    // 「Relocation corrupted: BlockSize is out of bound the binary's virtual size」——
    // 它按自己的规则解析重定位表，而 pe-library 重新生成后的布局它读不了。
    // 反过来的话，resedit 只是把 .rsrc 里的资源项整体重写一遍（NODE_SEA_BLOB 是其中一项），
    // 两边都能跑通。
    setExeIcon(stagedExe);
    mkdirSync(path.dirname(outPath), { recursive: true });
    copyFileSync(stagedExe, outPath);
    const size = (statSync(outPath).size / 1024 / 1024).toFixed(1);
    console.log(`已生成 ${outPath}（${size} MB）；未运行程序，未复制或修改用户 data。`);
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`EXE 注入失败：${error.message}`);
  process.exitCode = 1;
});
