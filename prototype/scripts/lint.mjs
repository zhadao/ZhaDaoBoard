// 项目自检（零依赖）：把 DESIGN.md 的视觉铁律与本项目的数据安全约束变成可执行规则。
// 与 tsc 互补——tsc 管类型，这里管「类型检查管不到、但评审一定会挑」的约定。
//
// 用法：node scripts/lint.mjs   （作为 npm run check 的一环）
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const violations = [];

function walk(dir, filter) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, filter));
    else if (entry.isFile() && filter(full)) out.push(full);
  }
  return out;
}

const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");

/** 逐行规则：pattern 命中即违规，allow 可放行（例如注释里说明原因的行）。 */
function checkLines(file, rules) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((text, index) => {
    const code = text.replace(/\/\/.*$/, "");
    for (const rule of rules) {
      if (rule.pattern.test(code) && !rule.allow?.(text, lines, index)) {
        violations.push({ file: rel(file), line: index + 1, rule: rule.id, detail: rule.detail, text: text.trim() });
      }
    }
  });
}

/* ---------------- 1. 前端源码 ---------------- */
const TS_FILES = walk(path.join(ROOT, "src"), (f) => /\.(ts|tsx)$/.test(f));
const TYPES_ENTRY = "src/types.ts";

for (const file of TS_FILES) {
  const name = rel(file);
  checkLines(file, [
    {
      id: "no-any",
      // 用真实 Excalidraw 类型替代 any（types.ts 只做 re-export，不写具体逻辑）
      pattern: /(?::\s*any\b|<any>|as\s+any\b|\bany\[\])/,
      detail: "禁止 any：请从 @excalidraw/excalidraw 的公开类型中取准确类型",
      allow: (text) => /lint-allow-any/.test(text),
    },
    {
      id: "no-ts-escape",
      pattern: /@ts-(?:ignore|expect-error|nocheck)|eslint-disable/,
      detail: "禁止用 @ts-ignore / eslint-disable 绕过检查；请修正类型或写清原因",
    },
    {
      id: "no-console-log",
      pattern: /console\.log\(/,
      detail: "前端禁止 console.log（console.error/warn 用于真实异常）",
    },
    {
      id: "no-debugger",
      pattern: /\bdebugger\b/,
      detail: "禁止提交 debugger",
    },
    {
      id: "no-hardcoded-api-origin",
      pattern: /https?:\/\/(?:localhost|127\.0\.0\.1):4173/,
      detail: "禁止硬编码后端地址：必须走 src/api.ts 的 apiUrl（生产为同源）",
    },
    {
      id: "no-indexeddb",
      pattern: /\bindexedDB\b|\bidb-keyval\b/,
      detail: "白板数据必须落在 data/ 文件夹；禁止回到浏览器 IndexedDB",
    },
    {
      id: "localstorage-allowlist",
      pattern: /\blocalStorage\b/,
      detail: "localStorage 仅允许存 UI 偏好（theme.ts / App.tsx / viewPrefs.ts）",
      allow: (_t, _l, i) =>
        ["src/theme.ts", "src/App.tsx", "src/viewPrefs.ts"].includes(name) || i < 0,
    },
  ]);
}

/* ---------------- 2. 样式：颜色只能来自 tokens.css ---------------- */
const CSS_FILES = walk(path.join(ROOT, "src", "styles"), (f) => f.endsWith(".css"));
for (const file of CSS_FILES) {
  const name = rel(file);
  if (name.endsWith("tokens.css")) continue;
  checkLines(file, [
    {
      id: "tokens-only-color",
      pattern: /#[0-9a-fA-F]{3,8}\b|\brgba?\(/,
      detail: "除 tokens.css 外禁止裸色值（DESIGN.md：颜色只有一套令牌来源）",
      allow: (text) => /lint-allow-color/.test(text),
    },
  ]);
}

/* ---------------- 3. 服务端 ---------------- */
const SERVER_FILES = walk(path.join(ROOT, "server"), (f) => f.endsWith(".cjs"));
for (const file of SERVER_FILES) {
  checkLines(file, [
    {
      id: "no-wildcard-cors",
      pattern: /access-control-allow-origin"?\s*[,:]\s*["']\*/i,
      detail: "禁止通配 CORS：本地服务只能回显白名单 Origin",
    },
    {
      id: "no-public-bind",
      pattern: /["']0\.0\.0\.0["']|listen\([^)]*,\s*["']0\.0\.0\.0["']/,
      detail: "只允许监听 127.0.0.1，禁止对外暴露本地数据",
    },
  ]);
}

/* ---------------- 4. 构建脚本不得在打包时启动服务 ---------------- */
for (const file of walk(path.join(ROOT, "scripts"), (f) => f.endsWith(".mjs"))) {
  const name = rel(file);
  // 两类豁免：
  //   - dev.mjs 的职责就是起服务；lint.mjs 自身含规则正则，跳过
  //   - verify-*.mjs 是「验证脚本」：允许为了实测而临时拉起被测对象。
  //     它们必须用随机端口 + 临时数据目录，跑完立即回收（见 verify-browser.mjs）。
  if (name === "scripts/dev.mjs" || name === "scripts/lint.mjs") continue;
  if (/^scripts\/verify-/.test(name)) continue;
  checkLines(file, [
    {
      id: "no-autostart-in-build",
      pattern: /\bstart\(\)|openBrowser|execFile\(|spawn\([^)]*server\.cjs/,
      detail: "构建/打包脚本不得自动启动服务或打开浏览器",
      allow: (text) => /lint-allow-autostart/.test(text),
    },
  ]);
}

/* ---------------- 5. 必备文件 ---------------- */
for (const required of [
  "CODE_REVIEW.md",
  "THIRD-PARTY-NOTICES.md",
  "server/server.cjs",
  "src/types.ts",
  "src/editor/saveQueue.ts",
]) {
  try {
    if (!statSync(path.join(ROOT, required)).isFile()) throw new Error();
  } catch {
    violations.push({ file: required, line: 0, rule: "required-file", detail: "缺少该文件", text: "" });
  }
}

/* ---------------- 6. 批处理脚本必须用 CRLF 行尾 ---------------- */
// cmd.exe 对 LF-only 的 .bat 解析不可靠：跨行括号块、标签、以及带重定向的行都可能被吞掉，
// 而且**不报错**。本项目的 .bat 是「双击即用」的降级入口，坏了就是双击没反应。
// 实测踩到过：`> "%~dp0proof.txt" echo launched` 这行在 LF 行尾下被静默吞掉，
// 而同文件的后续行照常执行 —— 典型的"看起来在跑、其实少做了事"。
for (const file of walk(ROOT, (f) => f.toLowerCase().endsWith(".bat"))) {
  const raw = readFileSync(file, "latin1");
  const bareLf = (raw.match(/(?<!\r)\n/g) || []).length;
  if (bareLf > 0) {
    violations.push({
      file: rel(file),
      line: 0,
      rule: "bat-crlf",
      detail: `批处理必须用 CRLF 行尾（发现 ${bareLf} 处裸 LF），否则 cmd.exe 会误解析`,
      text: "",
    });
  }
}

/* ---------------- 7. 版本号只能有一个真相源 ---------------- */
// server.cjs 跑在 SEA 里，**读不到 package.json**（打包时只嵌 dist/），只能把版本硬编码在
// /api/health 的响应里。既然免不了有两处，就把它们钉死成必须相等，否则迟早各走各的 ——
// 本轮就实测撞上过：health 报 0.4.0、package.json 还写着 0.3.0。
{
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const healthSource = readFileSync(path.join(ROOT, "server", "server.cjs"), "utf8");
  const hit = healthSource.match(/\bversion:\s*"([^"]+)"/);
  if (!hit) {
    violations.push({
      file: "server/server.cjs",
      line: 0,
      rule: "version-sync",
      detail: "找不到 /api/health 里的 version 字段，无法与 package.json 对齐",
      text: "",
    });
  } else if (hit[1] !== pkg.version) {
    violations.push({
      file: "server/server.cjs",
      line: 0,
      rule: "version-sync",
      detail: `/api/health 报 ${hit[1]}，package.json 写 ${pkg.version}，两者必须一致`,
      text: "",
    });
  }
}

/* ---------------- 输出 ---------------- */
if (violations.length) {
  console.error(`[lint] 发现 ${violations.length} 处违规：\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.rule}] ${v.detail}`);
    if (v.text) console.error(`      ${v.text}`);
  }
  console.error("\n修复后重新运行 npm run lint。规则说明见 CODE_REVIEW.md。");
  process.exitCode = 1;
} else {
  console.log(`[lint] 通过：${TS_FILES.length} 个 TS/TSX、${CSS_FILES.length} 个 CSS、${SERVER_FILES.length} 个服务端文件。`);
}
