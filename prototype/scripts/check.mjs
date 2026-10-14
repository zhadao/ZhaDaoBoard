// 顺序检查，任一步失败即停止并透传退出码；后续 lint 由 package 脚本追加。
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(label, args) {
  console.log(`\n[check] ${label}`);
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`${label} 失败（退出码 ${result.status ?? result.signal}），停止后续检查。`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

try {
  run("node scripts/lint.mjs", [path.join(ROOT, "scripts", "lint.mjs")]);
  run("tsc --noEmit", [path.join(ROOT, "node_modules", "typescript", "bin", "tsc"), "--noEmit"]);
  // 不依赖 shell 通配符，Windows 下也精确展开 tests/*.test.mjs。
  const tests = readdirSync(path.join(ROOT, "tests"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => path.join(ROOT, "tests", entry.name))
    .sort();
  if (!tests.length) throw new Error("未找到 tests/*.test.mjs，不能跳过测试。");
  run("node --test tests/*.test.mjs", ["--test", ...tests]);
  run("vite build", [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "build"]);
  // 构建产物必须自证「不会联网」：入口全同源 + 字体家族本地命中 + 无外部字体兜底 + CSP 已下发。
  run("node scripts/verify-offline.mjs", [path.join(ROOT, "scripts", "verify-offline.mjs")]);
  // 真实浏览器实测：唯一能证明「确实一个外网请求都没有」的检查。
  // 机器上没有 Edge/Chrome 时脚本自行跳过（退出码 0），不会挡住其他人。
  run("node scripts/verify-browser.mjs", [path.join(ROOT, "scripts", "verify-browser.mjs")]);
  console.log("\n[check] 类型、测试、前端构建、离线自检与浏览器实测全部通过。");
} catch (error) {
  console.error(`[check] ${error.message}`);
  process.exitCode = error.exitCode || 1;
}
