/**
 * 从 `public/logo.svg` 生成 Windows exe 图标 `build/icon.ico`。
 *
 * 用法：npm run build:icon
 *
 * 现状（重要）：正式版已经改用**用户提供的多尺寸图标** `assets/app.ico`
 *   （由 favicon_multi.ico 而来，6 档全 PNG）。`make-exe.mjs` 与 `verify-exe.mjs`
 *   都通过 set-exe-icon.mjs 的 `resolveIconSource()` 解析图标源，优先级是
 *   `assets/app.ico` → `build/icon.ico`。所以本脚本现在是**回退路线**：
 *   只有在 assets/app.ico 不存在时才会被用到。
 *   保留它的价值在于「logo.svg 改了能一键重新光栅化」，而 SVG 仍是网页图标的正源。
 *
 * 为什么单独成一个脚本、且不进 `npm run check`：
 *   它需要一个真实浏览器内核来光栅化 SVG（本机用 Edge/Chrome），既慢又依赖环境。
 *   图标极少变动，所以产物 `build/icon.ico` 直接入库，`build:exe` 只管读取。
 *   需要换 logo 时手动跑一次本脚本即可。
 *
 * 光栅化为什么不用 `--screenshot`：
 *   新版无头模式下 `--window-size` 会被系统最小窗口尺寸钳制（实测请求 256x256
 *   拿到的是 466x159 视口），SVG 的 preserveAspectRatio 一居中就画歪了。
 *   这里改成「页面内 canvas 按精确像素绘制 → toDataURL → --dump-dom 取回」，
 *   渲染尺寸完全由 canvas 决定，与视口无关，结果可复现。
 *
 * 打包策略（兼顾兼容性与体积）：
 *   - 16/24/32/48/64：写成传统 BMP（BITMAPINFOHEADER + BGRA + AND 掩码），
 *     老版本 Shell、部分第三方软件只认这种格式；
 *   - 128/256：写成 PNG（Vista 起支持，体积小很多，256 也是任务栏大图标的来源）。
 *
 * 注意：本脚本不做任何字体替换 —— `public/logo.svg` 里的文字已转成轮廓路径。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOGO = path.join(ROOT, "public", "logo.svg");
const OUT_DIR = path.join(ROOT, "build");
const OUT_ICO = path.join(OUT_DIR, "icon.ico");

/** BMP 条目（≤ 64px）与 PNG 条目（> 64px）的分界。 */
const BMP_MAX = 64;
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const BROWSER_CANDIDATES = [
  process.env.WHITEBOARD_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].filter(Boolean);

/* ------------------------------------------------------------------ */
/* 1. 光栅化：页面内 canvas 按精确像素绘制，再用 --dump-dom 把 base64 取回 */
/* ------------------------------------------------------------------ */

function findBrowser() {
  const browser = BROWSER_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!browser) {
    throw new Error("未找到 Edge/Chrome。可用 WHITEBOARD_BROWSER 环境变量指定浏览器路径。");
  }
  return browser;
}

function buildPage(svg) {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script type="application/json" id="wb-icon-out">pending</script>
<script>
const SIZES = ${JSON.stringify(SIZES)};
const SVG = ${JSON.stringify(svg)};
async function main() {
  const results = {};
  for (const size of SIZES) {
    // 注入显式 width/height：logo.svg 只有 viewBox，没有固有尺寸，drawImage 需要它
    const sized = SVG.replace("<svg ", '<svg width="' + size + '" height="' + size + '" ');
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("SVG 加载失败：" + size));
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(sized);
    });
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    results[size] = canvas.toDataURL("image/png");
  }
  document.getElementById("wb-icon-out").textContent = JSON.stringify(results);
}
main().catch((error) => {
  document.getElementById("wb-icon-out").textContent = "ERROR: " + error.message;
});
<\/script>
</body></html>`;
}

function renderPngs(browser, dir) {
  const svg = readFileSync(LOGO, "utf8");
  const htmlPath = path.join(dir, "rasterize.html");
  writeFileSync(htmlPath, buildPage(svg), "utf8");

  const dom = execFileSync(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      `--user-data-dir=${path.join(dir, "profile")}`,
      // 让无头浏览器把异步的图片加载/toDataURL 跑完再导出 DOM
      "--virtual-time-budget=10000",
      "--dump-dom",
      `file:///${htmlPath.replace(/\\/g, "/")}`,
    ],
    { encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "ignore"] }
  );

  const matched = dom.match(
    /<script type="application\/json" id="wb-icon-out">([\s\S]*?)<\/script>/
  );
  if (!matched) throw new Error("浏览器没有返回光栅化结果（未找到输出节点）");
  const payload = matched[1];
  if (payload.startsWith("ERROR")) throw new Error(payload);
  if (payload === "pending") throw new Error("浏览器在光栅化完成前就返回了（虚拟时间预算不足）");

  let decoded;
  try {
    decoded = JSON.parse(payload);
  } catch {
    throw new Error("光栅化结果不是合法 JSON");
  }

  const pngs = new Map();
  for (const size of SIZES) {
    const dataUrl = decoded[size];
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
      throw new Error(`缺少 ${size}px 的 PNG 结果`);
    }
    const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
    const { width, height } = readIhdr(png);
    if (width !== size || height !== size) {
      throw new Error(`光栅化尺寸不符：期望 ${size}x${size}，实际 ${width}x${height}`);
    }
    pngs.set(size, png);
  }
  return pngs;
}

/* ------------------------------------------------------------------ */
/* 2. 极简 PNG 解码（只支持 8bit RGBA / 非隔行，也就是浏览器截图这一种）  */
/* ------------------------------------------------------------------ */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readIhdr(png) {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("不是合法 PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function decodePng(png) {
  const { width, height } = readIhdr(png);
  const bitDepth = png[24];
  const colorType = png[25];
  const interlace = png[28];
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`只支持 8bit RGBA 非隔行 PNG，实际 depth=${bitDepth} type=${colorType} interlace=${interlace}`);
  }

  const idat = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") idat.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
    if (type === "IEND") break;
  }
  const raw = inflateSync(Buffer.concat(idat));

  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const target = out.subarray(y * stride, (y + 1) * stride);
    const prev = y === 0 ? null : out.subarray((y - 1) * stride, y * stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? target[x - bpp] : 0;
      const up = prev ? prev[x] : 0;
      const upLeft = prev && x >= bpp ? prev[x - bpp] : 0;
      let value = line[x];
      switch (filter) {
        case 0: break;
        case 1: value = (value + left) & 0xff; break;
        case 2: value = (value + up) & 0xff; break;
        case 3: value = (value + ((left + up) >> 1)) & 0xff; break;
        case 4: value = (value + paeth(left, up, upLeft)) & 0xff; break;
        default: throw new Error(`未知的 PNG 行过滤器：${filter}`);
      }
      target[x] = value;
    }
  }
  return { width, height, rgba: out };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/* ------------------------------------------------------------------ */
/* 3. 打包 ICO                                                         */
/* ------------------------------------------------------------------ */

/** 把 RGBA 像素写成 ICO 用的 BMP 条目：BITMAPINFOHEADER + 自下而上的 BGRA + AND 掩码。 */
function toBmpEntry({ width, height, rgba }) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(width, 4); // biWidth
  header.writeInt32LE(height * 2, 8); // biHeight：XOR 图 + AND 掩码，高度写两倍
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // biCompression = BI_RGB
  header.writeUInt32LE(width * height * 4, 20); // biSizeImage

  const xor = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 4; // BMP 自下而上
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4;
      const d = (y * width + x) * 4;
      xor[d] = rgba[s + 2]; // B
      xor[d + 1] = rgba[s + 1]; // G
      xor[d + 2] = rgba[s]; // R
      xor[d + 3] = rgba[s + 3]; // A
    }
  }
  // 32bit 条目靠 alpha 通道做透明，AND 掩码全 0 即可（每行按 4 字节对齐）
  const maskStride = Math.ceil(width / 32) * 4;
  const mask = Buffer.alloc(maskStride * height);
  return Buffer.concat([header, xor, mask]);
}

function packIco(entries) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // type = icon
  dir.writeUInt16LE(entries.length, 4);

  const table = Buffer.alloc(entries.length * 16);
  let offset = 6 + entries.length * 16;
  entries.forEach((entry, index) => {
    const at = index * 16;
    table[at] = entry.width >= 256 ? 0 : entry.width; // 256 用 0 表示
    table[at + 1] = entry.height >= 256 ? 0 : entry.height;
    table[at + 2] = 0; // 调色板数量（真彩为 0）
    table[at + 3] = 0; // reserved
    table.writeUInt16LE(1, at + 4); // planes
    table.writeUInt16LE(32, at + 6); // bitCount
    table.writeUInt32LE(entry.data.length, at + 8);
    table.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([dir, table, ...entries.map((entry) => entry.data)]);
}

/* ------------------------------------------------------------------ */

function main() {
  if (!existsSync(LOGO)) throw new Error(`缺少源文件：${LOGO}`);
  const browser = findBrowser();
  const tmp = mkdtempSync(path.join(os.tmpdir(), "wb-icon-"));
  try {
    console.log(`[icon] 用 ${path.basename(browser)} 光栅化 ${SIZES.join("/")} px…`);
    const pngs = renderPngs(browser, tmp);

    const entries = SIZES.map((size) => {
      const png = pngs.get(size);
      const decoded = decodePng(png);
      const useBmp = size <= BMP_MAX;
      return {
        width: size,
        height: size,
        kind: useBmp ? "bmp" : "png",
        data: useBmp ? toBmpEntry(decoded) : png,
      };
    });

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_ICO, packIco(entries));
    const total = entries.reduce((sum, entry) => sum + entry.data.length, 0);
    console.log(
      `[icon] 已生成 ${path.relative(ROOT, OUT_ICO)}（${entries.length} 个尺寸，` +
        `${(total / 1024).toFixed(1)} KB）：` +
        entries.map((entry) => `${entry.width}(${entry.kind})`).join(" ")
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`[icon] 生成失败：${error.message}`);
  process.exitCode = 1;
}
