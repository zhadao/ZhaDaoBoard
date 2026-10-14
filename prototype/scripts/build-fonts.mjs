/**
 * 把 D:/Coding/WhiteBoard/fonts 下的阿里巴巴普惠体三个字重
 * 子集化并转成 woff2，输出到 public/fonts/puhuiti/。
 *
 * 产物会被 Vite 原样复制到 dist/，本地服务再把引擎请求的所有
 * `/fonts/<任意家族>/<任意文件>` 别名到这三个文件（见 font-map.json）。
 *
 * 降级策略：若 Python / fonttools 不可用，直接拷贝原始字体文件，
 * 并按实际扩展名写出（.otf 时引擎与浏览器依然可用），同时打印告警。
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, "..");
const FONT_SOURCE = path.resolve(PROJECT, "../fonts");
const OUT_DIR = path.resolve(PROJECT, "public/fonts/puhuiti");

/** 三个字重：常规 / 中黑 / 加粗 —— 对应界面上的三个字体选项。 */
const WEIGHTS = [
  { name: "regular", candidates: ["阿里巴巴普惠体AlibabaPuHuiTi-3-55-Regular.otf"] },
  { name: "medium", candidates: ["阿里巴巴普惠体AlibabaPuHuiTi-3-65-Medium.otf"] },
  { name: "bold", candidates: ["阿里巴巴普惠体AlibabaPuHuiTi-3-85-Bold.otf"] },
];

/** 可能的 venv 位置（可被 WB_FONT_PYTHON 环境变量覆盖）。 */
function pythonCandidates() {
  const list = [];
  if (process.env.WB_FONT_PYTHON) list.push(process.env.WB_FONT_PYTHON);
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  if (home) {
    list.push(
      path.join(home, ".workbuddy-ai/binaries/python/envs/fonttools/Scripts/python.exe"),
      path.join(home, ".workbuddy-ai/binaries/python/envs/fonttools/bin/python")
    );
  }
  list.push("python3", "python");
  return list;
}

async function findPython() {
  for (const candidate of pythonCandidates()) {
    try {
      await run(candidate, ["-c", "import fontTools, brotli"], { timeout: 30_000 });
      return candidate;
    } catch {
      /* 继续尝试下一个 */
    }
  }
  return null;
}

async function pickSource(candidates) {
  for (const name of candidates) {
    const file = path.join(FONT_SOURCE, name);
    try {
      await fs.access(file);
      return file;
    } catch {
      /* 继续 */
    }
  }
  return null;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  // 每次都清理旧的 woff2/otf 产物，避免扩展名切换后残留
  for (const entry of await fs.readdir(OUT_DIR)) {
    if (/\.(woff2|otf|ttf)$/.test(entry)) await fs.rm(path.join(OUT_DIR, entry));
  }

  const python = await findPython();
  if (!python) {
    console.warn("[fonts] 未找到可用的 fonttools 环境，将直接拷贝原始字体（体积较大）。");
    console.warn("[fonts] 如需子集化：pip install fonttools brotli，或设置 WB_FONT_PYTHON。");
  } else {
    console.log(`[fonts] 使用 ${python} 子集化`);
  }

  for (const weight of WEIGHTS) {
    const source = await pickSource(weight.candidates);
    if (!source) {
      throw new Error(
        `[fonts] 未找到字重 ${weight.name} 的源文件，期望之一：${weight.candidates.join(" / ")}`
      );
    }

    if (python) {
      const target = path.join(OUT_DIR, `${weight.name}.woff2`);
      const { stdout } = await run(
        python,
        [path.join(HERE, "subset-fonts.py"), source, target],
        { timeout: 10 * 60_000, maxBuffer: 8 * 1024 * 1024 }
      );
      process.stdout.write(`[fonts] ${stdout.trim()}\n`);
    } else {
      const ext = path.extname(source);
      const target = path.join(OUT_DIR, `${weight.name}${ext}`);
      await fs.copyFile(source, target);
      const { size } = await fs.stat(target);
      console.log(`[fonts] ${weight.name}${ext}: ${(size / 1024 / 1024).toFixed(2)} MB（未子集化）`);
    }
  }

  console.log(`[fonts] 完成 → ${path.relative(PROJECT, OUT_DIR)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
