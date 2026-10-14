// 用法：node scripts/build-exe.mjs [输出 exe 路径]，或设置 OUTPUT_DIR。
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        const error = new Error(`构建步骤失败（退出码 ${code ?? signal}）：${args.join(" ")}`);
        error.exitCode = code ?? 1;
        reject(error);
      }
    });
  });
}

function collectAssets(directory, assets) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectAssets(absolutePath, assets);
    else if (entry.isFile()) {
      const relativePath = path.relative(DIST, absolutePath).split(path.sep).join("/");
      if (relativePath === "__manifest") throw new Error("dist/__manifest 与 SEA 资源清单保留名冲突。");
      assets[relativePath] = absolutePath;
    } else throw new Error(`dist 不允许符号链接或非普通文件：${absolutePath}`);
  }
}

async function main() {
  if (process.platform !== "win32") throw new Error("请使用 Windows managed Node 构建 Windows exe。");
  if (process.argv.length > 3) throw new Error("用法：node scripts/build-exe.mjs [输出 exe 路径]");
  console.log(`构建运行时：${process.execPath}`);
  await run([path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "build"]);

  const buildDir = mkdtempSync(path.join(ROOT, ".sea-build-"));
  try {
    const assets = Object.create(null);
    collectAssets(DIST, assets);
    if (!Object.hasOwn(assets, "index.html")) throw new Error("Vite 构建缺少 dist/index.html。");
    const relativePaths = Object.keys(assets).sort();
    const manifestPath = path.join(buildDir, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify(relativePaths), "utf8");
    assets.__manifest = manifestPath;

    const template = JSON.parse(readFileSync(path.join(ROOT, "sea-config.json"), "utf8"));
    const config = {
      ...template,
      main: path.join(ROOT, "server", "server.cjs"),
      output: path.join(ROOT, "sea-prep.blob"),
      useSnapshot: false,
      useCodeCache: false,
      assets,
    };
    const configPath = path.join(buildDir, "sea-config.json");
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
    console.log(`嵌入 ${relativePaths.length} 个 dist 文件及 __manifest；不打包用户 data。`);
    await run(["--experimental-sea-config", configPath]);
    await run([path.join(ROOT, "scripts", "make-exe.mjs"), ...process.argv.slice(2)]);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = error.exitCode || 1;
});
