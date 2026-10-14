/**
 * 真实浏览器实测（可选、较慢）：
 * 用 CDP 驱动本机 Edge/Chrome，把一个**真实运行**的白板打开，然后断言：
 *
 *   1. 全程没有任何外网请求（唯一的权威证明——静态检查只能看代码，这里看真实流量）
 *   2. 控制台没有 error / warning
 *   3. 引擎解析出的每一个字体 URL 都指向本机（esm.sh 兜底确实已被摘掉）
 *   4. 本地普惠体三个字重真的 loaded
 *   5. 中文界面 + 点阵图层按预期生效，联网入口（素材库浏览 / 字体下拉 / 嵌入网页）确实不可见
 *
 * 用法：npm run verify:browser        （会自己起一个临时服务，跑完自动关掉并清理）
 *      npm run verify:browser -- <已有地址>   （对着已跑着的服务测）
 *
 * 找不到浏览器时脚本会跳过并返回 0——它不该成为 CI 上的硬门槛。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------------- 找一个 Chromium 内核浏览器 ---------------- */
const BROWSER_CANDIDATES = [
  process.env.WHITEBOARD_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const browser = BROWSER_CANDIDATES.find((candidate) => existsSync(candidate));
if (!browser) {
  console.log("[browser] 未找到 Edge/Chrome，跳过真实浏览器实测（可用 WHITEBOARD_BROWSER 指定路径）。");
  process.exit(0);
}

/* ---------------- 起一个临时服务（除非调用方给了地址） ---------------- */
let appUrl = process.argv[2] ?? null;
let server = null;
let tempData = null;
const debugPort = 9333 + Math.floor(Math.random() * 500);

if (!appUrl) {
  if (!existsSync(path.join(ROOT, "dist", "index.html"))) {
    console.error("[browser] 未找到 dist/，请先 npm run build。");
    process.exit(1);
  }
  tempData = mkdtempSync(path.join(os.tmpdir(), "wb-verify-data-"));
  // PORT=0 让系统分配空闲端口：既不会撞端口，也不会误连到用户正在跑的那个实例
  // （服务器有「端口被同款实例占用就复用它」的行为，用固定端口会测到别人的数据目录）。
  server = spawn(process.execPath, [path.join(ROOT, "server", "server.cjs"), "--no-open"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "0", WHITEBOARD_DATA_DIR: tempData },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const address = await new Promise((resolve) => {
    let buffered = "";
    const timer = setTimeout(() => resolve(null), 20000);
    const onData = (chunk) => {
      buffered += chunk.toString();
      const match = buffered.match(/地址：(http:\/\/127\.0\.0\.1:\d+\/)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    server.stdout.on("data", onData);
    server.stderr.on("data", onData);
    server.once("exit", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });

  if (!address) {
    console.error("[browser] 临时服务启动失败（未解析到监听地址）。");
    server.kill();
    rmSync(tempData, { recursive: true, force: true });
    process.exit(1);
  }
  appUrl = address;
}

const profile = mkdtempSync(path.join(os.tmpdir(), "wb-edge-"));
const child = spawn(
  browser,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-proxy-server",
    "--disable-extensions",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

let seq = 0;
function rpc(ws, method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== id) return;
      ws.removeEventListener("message", onMessage);
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
      else resolve(msg.result);
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const consoleMessages = [];
const requests = [];
const failures = [];
const urlById = new Map();
const problems = [];

function check(ok, message) {
  if (!ok) problems.push(message);
}

try {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (res.ok) break;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }

  // 先建一块白板，否则应用停在空状态，编辑器相关断言无从谈起。
  const created = await fetch(`${appUrl.replace(/\/$/, "")}/api/boards`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "浏览器实测" }),
  }).then((r) => r.json());
  if (!created?.id) throw new Error("创建白板失败，无法继续实测");
  const boardUrl = `${appUrl.replace(/\/$/, "")}/#/board/${created.id}`;

  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" }).then((r) =>
    r.json()
  );
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === "Log.entryAdded") {
      const e = msg.params.entry;
      if (e.level === "error" || e.level === "warning") {
        consoleMessages.push(`[${e.level}] ${e.source}: ${e.text} ${e.url ?? ""}`);
      }
    }
    if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) {
      consoleMessages.push(
        `[console.${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ")}`
      );
    }
    if (msg.method === "Runtime.exceptionThrown") {
      consoleMessages.push(
        `[exception] ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`
      );
    }
    if (msg.method === "Network.requestWillBeSent") {
      requests.push(msg.params.request.url);
      urlById.set(msg.params.requestId, msg.params.request.url);
    }
    if (msg.method === "Network.loadingFailed") {
      failures.push(
        `${msg.params.errorText}${msg.params.blockedReason ? ` (blockedReason=${msg.params.blockedReason})` : ""} :: ${
          urlById.get(msg.params.requestId) ?? "?"
        }`
      );
    }
  });

  await rpc(ws, "Runtime.enable");
  await rpc(ws, "Log.enable");
  await rpc(ws, "Network.enable");
  await rpc(ws, "Page.enable");
  // 在新文档里先装探针：记录引擎构造 FontFace 时用的 src，以及 assetPath 的写入时机。
  await rpc(ws, "Page.addScriptToEvaluateOnNewDocument", {
    source: `
      window.__wbProbe = { faces: [], writes: [] };
      let ap;
      Object.defineProperty(window, "EXCALIDRAW_ASSET_PATH", {
        configurable: true,
        get() { return ap; },
        set(v) { ap = v; window.__wbProbe.writes.push(v); },
      });
      const RealFontFace = window.FontFace;
      window.FontFace = function (family, source, descriptors) {
        try {
          if (window.__wbProbe.faces.length < 400) {
            window.__wbProbe.faces.push({ family: String(family), source: String(source).slice(0, 300) });
          }
        } catch {}
        return new RealFontFace(family, source, descriptors);
      };
      window.FontFace.prototype = RealFontFace.prototype;
    `,
  });
  await rpc(ws, "Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await rpc(ws, "Page.navigate", { url: boardUrl });
  await sleep(7000);

  const evaluate = async (expression) => {
    const result = await rpc(ws, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    return result.result?.value;
  };

  const report = await evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // 点开视图设置，勾上点阵
    const buttons = [...document.querySelectorAll(".wb-topbar-right .wb-btn--icon")];
    const viewBtn = buttons[0];
    if (viewBtn) viewBtn.click();
    await wait(300);
    const menu = document.querySelector(".wb-view-menu");
    const rows = menu ? [...menu.querySelectorAll(".wb-view-row")].map((r) => r.textContent.trim()) : [];
    const toggle = menu ? menu.querySelector(".wb-switch") : null;
    if (toggle && !toggle.checked) toggle.click();
    await wait(500);

    const dotLayer = document.querySelector(".wb-dotgrid");
    const dotStyle = dotLayer ? getComputedStyle(dotLayer) : null;
    const select = menu ? menu.querySelector(".wb-select") : null;
    if (select) { select.value = "grid"; select.dispatchEvent(new Event("change", { bubbles: true })); }
    await wait(500);

    let fontExperiment = "skipped";
    try {
      const ff = new FontFace(
        "WBProbe",
        "url(" + location.origin + "/fonts/Cascadia/CascadiaCode-Regular.woff2) format('woff2')",
      );
      await ff.load();
      fontExperiment = "本地 src 加载成功";
    } catch (error) {
      fontExperiment = "本地 src 失败：" + error.message;
    }

    // 引擎解析出的字体 URL 必须全部是本地的（不得再有 esm.sh 之类的兜底）
    const fontUrls = (window.__wbProbe?.faces ?? []).map((f) => f.source);
    const remoteFontUrl = fontUrls.filter((s) => /https?:\\/\\/(?!127\\.0\\.0\\.1|localhost)/.test(s)).slice(0, 3);

    return {
      fontExperiment,
      remoteFontUrl,
      title: document.title,
      viewMenuRows: rows,
      viewMenuText: menu ? menu.textContent.replace(/\\s+/g, " ").trim().slice(0, 120) : null,
      dotEnabled: dotLayer?.dataset.enabled ?? null,
      dotDense: dotLayer?.dataset.dense ?? null,
      dotOpacity: dotStyle?.opacity ?? null,
      dotImage: (dotStyle?.backgroundImage ?? "").slice(0, 60),
      dotStep: dotLayer?.style.getPropertyValue("--wb-dot-step") ?? null,
      canvasBg: getComputedStyle(document.querySelector(".wb-canvas")).backgroundColor,
      engineCanvasBg: getComputedStyle(document.querySelector(".wb-canvas .excalidraw")).backgroundColor,
      fontLoaded: document.fonts.check("16px PuHuiTi"),
      fontFaces: [...document.fonts].filter((f) => f.family.includes("PuHuiTi")).map((f) => f.family + "/" + f.weight + "/" + f.status),
      bodyFont: getComputedStyle(document.body).fontFamily.slice(0, 40),
      langText: document.querySelector(".excalidraw")?.textContent?.replace(/\\s+/g, " ").slice(0, 200) ?? null,
      libraryButton: !!document.querySelector(".library-menu-browse-button"),
      fontDropdown: !!document.querySelector('[data-testid="font-family-show-fonts"]'),
      fontDropdownVisible: (() => {
        const el = document.querySelector(".FontPicker__container > :nth-child(2)");
        return el ? getComputedStyle(el).display : "absent";
      })(),
      toolbarEmbeds: [...document.querySelectorAll('[data-testid="toolbar-embeddable"]')].map((el) => getComputedStyle(el).display),
      visibleLibraryBrowse: (() => {
        const el = document.querySelector(".library-menu-browse-button");
        return el ? getComputedStyle(el).display : "absent";
      })(),
      toolbarTitles: [...document.querySelectorAll(".App-toolbar [title]")].map((e) => e.getAttribute("title")),
      // 工具栏上每个工具的 data-testid，用来核对「10 个绘图工具一个不少」
      toolbarTools: [...document.querySelectorAll(".App-toolbar [data-testid^='toolbar-']")].map(
        (e) => e.getAttribute("data-testid")
      ),
    };
  })()`);

  /* ---------------- 主题三态：四个入口都从外壳读、都写回外壳 ---------------- */
  const themeReport = await evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const root = document.documentElement;
    const read = () => ({ pref: root.getAttribute("data-theme-pref"), theme: root.getAttribute("data-theme") });
    const out = { initial: read(), steps: [] };

    const anchor = document.querySelector(".wb-theme-anchor");
    const trigger = anchor ? anchor.querySelector("button") : null;
    if (!trigger) return { ...out, error: "顶栏找不到主题入口（.wb-theme-anchor button）" };

    const ITEM_LABELS = ["浅色", "深色", "跟随系统"];
    for (let i = 0; i < ITEM_LABELS.length; i++) {
      trigger.click();
      await wait(120);
      const items = [...document.querySelectorAll(".wb-theme-menu-item")];
      if (items.length !== 3) {
        out.steps.push({ index: i, error: "菜单项数量不是 3，实际 " + items.length });
        continue;
      }
      items[i].click();
      await wait(200);
      const state = read();
      const canvas = document.querySelector(".wb-canvas");
      out.steps.push({
        index: i,
        expected: ITEM_LABELS[i],
        pref: state.pref,
        theme: state.theme,
        canvasBg: canvas ? getComputedStyle(canvas).backgroundColor : null,
      });
    }
    // 收尾：回到跟随系统，避免影响后续断言
    trigger.click();
    await wait(120);
    const items = [...document.querySelectorAll(".wb-theme-menu-item")];
    if (items[2]) items[2].click();
    await wait(200);
    out.final = read();
    return out;
  })()`);

  /* ---------------- 命令面板：开、搜、执行、关 ---------------- */
  const paletteReport = await evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const press = (key, opts) =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }));
    const type = (value) => {
      const input = document.querySelector(".wb-palette-input");
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    };
    const snapshot = () => {
      const panel = document.querySelector(".wb-palette");
      if (!panel) return null;
      const items = [...document.querySelectorAll(".wb-palette-item")];
      return {
        groups: [...document.querySelectorAll(".wb-palette-group-title")].map((e) => e.textContent.trim()),
        count: items.length,
        labels: items.map((e) => e.querySelector(".wb-palette-item-label")?.textContent?.trim() ?? ""),
        foot: document.querySelector(".wb-palette-foot")?.textContent ?? "",
      };
    };

    const out = { closedAtStart: document.querySelector(".wb-palette") === null };
    press("/", { ctrlKey: true });
    await wait(400);
    out.opened = snapshot();

    out.searchCn = null;
    if (type("对齐")) {
      await wait(300);
      const s = snapshot();
      out.searchCn = s && { count: s.count, labels: s.labels.slice(0, 6) };
    }
    out.searchEn = null;
    if (type("alignTop")) {
      await wait(300);
      const s = snapshot();
      out.searchEn = s && { count: s.count, labels: s.labels.slice(0, 6) };
    }
    out.searchNone = null;
    if (type("zzzzzz-no-such-command")) {
      await wait(300);
      out.searchNone = document.querySelector(".wb-palette-empty") !== null;
    }
    press("Escape", {});
    await wait(300);
    out.closedAfterEscape = document.querySelector(".wb-palette") === null;

    // Ctrl+Shift+P 也应该能打开
    press("P", { ctrlKey: true, shiftKey: true });
    await wait(400);
    out.openedByShiftP = document.querySelector(".wb-palette") !== null;
    press("Escape", {});
    await wait(200);
    return out;
  })()`);

  console.log("=== 主题 ===");
  console.log(`  ${JSON.stringify(themeReport)}`);
  console.log("=== 命令面板 ===");
  console.log(`  打开：${JSON.stringify(paletteReport?.opened && { groups: paletteReport.opened.groups, count: paletteReport.opened.count })}`);
  console.log(`  搜「对齐」：${JSON.stringify(paletteReport?.searchCn)}`);
  console.log(`  搜「alignTop」：${JSON.stringify(paletteReport?.searchEn)}`);
  console.log(`  底部提示：${JSON.stringify(paletteReport?.opened?.foot?.slice(-40))}`);

  const external = [
    ...new Set(requests.filter((u) => /^https?:/i.test(u) && !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u))),
  ];
  const fontRequests = [...new Set(requests.filter((u) => u.includes("/fonts/")))];
  const localFonts = fontRequests.filter((u) => u.startsWith(appUrl.replace(/\/$/, "")));
  const remoteFonts = fontRequests.filter((u) => !u.startsWith(appUrl.replace(/\/$/, "")));

  console.log("=== 页面状态 ===");
  for (const [key, value] of Object.entries(report)) console.log(`  ${key}: ${JSON.stringify(value)}`);
  console.log("\n=== 网络 ===");
  console.log(`  总请求 ${requests.length} 个，外网请求 ${external.length} 个`);
  console.log(`  本地字体请求 ${localFonts.length} 个，远端字体请求 ${remoteFonts.length} 个`);
  console.log(`  assetPath = ${JSON.stringify(await evaluate("window.EXCALIDRAW_ASSET_PATH"))}`);
  for (const url of localFonts.slice(0, 6)) console.log(`  本地字体：${url}`);
  for (const url of remoteFonts.slice(0, 4)) console.log(`  ! 远端字体：${url}`);
  for (const url of external.slice(0, 5)) console.log(`  ! 外网请求：${url}`);
  console.log(`  加载失败：${failures.length ? failures.slice(0, 6).join("\n             ") : "无"}`);

  console.log("\n=== 控制台 ===");
  const uniqueMessages = [...new Set(consoleMessages)];
  console.log(uniqueMessages.length ? uniqueMessages.slice(0, 15).map((m) => `  ${m}`).join("\n") : "  无 error/warning");

  /* ---------------- 断言 ---------------- */
  check(external.length === 0, `存在 ${external.length} 个外网请求：${external.slice(0, 3).join(", ")}`);
  check(remoteFonts.length === 0, `存在 ${remoteFonts.length} 个远端字体请求`);
  check(failures.length === 0, `存在 ${failures.length} 个加载失败：${failures.slice(0, 3).join(" / ")}`);
  check(uniqueMessages.length === 0, `控制台有 ${uniqueMessages.length} 条 error/warning`);
  check((report.remoteFontUrl ?? []).length === 0, "引擎构造的 FontFace 里仍有外部字体 URL");
  check(report.fontLoaded === true, "本地普惠体未加载成功");
  check(
    (report.fontFaces ?? []).filter((f) => f.endsWith("/loaded")).length === 3,
    `普惠体三个字重未全部 loaded：${JSON.stringify(report.fontFaces)}`
  );
  check(/[\u4e00-\u9fa5]/.test(report.langText ?? ""), "界面未呈现中文文案");
  check(report.dotEnabled === "true", "点阵图层未开启");
  check(report.dotStep === "20px", `点阵间距不是 20px：${report.dotStep}`);
  check(report.engineCanvasBg === "rgba(0, 0, 0, 0)", `引擎画布不是透明：${report.engineCanvasBg}`);
  // 元素不在 DOM 里（absent）与 display:none 都算「不可见」——都是我们要的结果
  const hidden = (value) => value === "none" || value === "absent";
  check(hidden(report.visibleLibraryBrowse), `素材库「浏览」联网入口仍可见：${report.visibleLibraryBrowse}`);
  check(hidden(report.fontDropdownVisible), `字体下拉（联网下载字体）仍可见：${report.fontDropdownVisible}`);
  check((report.toolbarEmbeds ?? []).every(hidden), "嵌入网页工具仍可见");
  check(/[\u4e00-\u9fa5]/.test(report.toolbarTitles?.[0] ?? ""), "工具栏提示未汉化");

  // 与上游 @excalidraw/excalidraw@0.18.1 的工具表逐条对齐：
  // 10 个绘图工具一个不少，且每个工具的提示里都带自己的快捷键（见 docs/EXCALIDRAW-PARITY.md 第 3 节）。
  const EXPECTED_TOOLS = {
    selection: "V",
    rectangle: "R",
    diamond: "D",
    ellipse: "O",
    arrow: "A",
    line: "L",
    freedraw: "P",
    text: "T",
    image: "9",
    eraser: "E",
  };
  const toolIds = new Set(report.toolbarTools ?? []);
  for (const [tool, shortcut] of Object.entries(EXPECTED_TOOLS)) {
    check(toolIds.has(`toolbar-${tool}`), `工具栏缺少绘图工具：${tool}`);
  }
  const titles = (report.toolbarTitles ?? []).join(" | ");
  for (const [tool, shortcut] of Object.entries(EXPECTED_TOOLS)) {
    check(titles.includes(`— ${shortcut}`) || titles.includes(` ${shortcut}`), `工具 ${tool} 的快捷键 ${shortcut} 未出现在工具栏提示里`);
  }

  /* ---------------- 主题三态 ---------------- */
  const EXPECTED_PREF = ["light", "dark", "system"];
  if (themeReport?.error) {
    problems.push(`主题：${themeReport.error}`);
  } else {
    check(
      ["light", "dark", "system"].includes(themeReport?.initial?.pref),
      `首屏 data-theme-pref 不是合法值：${themeReport?.initial?.pref}`
    );
    check(
      ["light", "dark"].includes(themeReport?.initial?.theme),
      `首屏 data-theme 不是解析后的具体主题：${themeReport?.initial?.theme}`
    );
    for (const [index, expected] of EXPECTED_PREF.entries()) {
      const step = themeReport?.steps?.[index];
      if (!step || step.error) {
        problems.push(`主题：第 ${index} 项（${expected}）切换失败：${step?.error ?? "无结果"}`);
        continue;
      }
      check(step.pref === expected, `主题：点第 ${index} 项后 data-theme-pref 应为 ${expected}，实际 ${step.pref}`);
      if (expected === "system") {
        check(
          step.theme === "light" || step.theme === "dark",
          `主题：跟随系统时 data-theme 仍应是解析后的具体主题，实际 ${step.theme}`
        );
      } else {
        check(step.theme === expected, `主题：点第 ${index} 项后 data-theme 应为 ${expected}，实际 ${step.theme}`);
      }
      // 画布底色必须真的跟着变：浅色是白底，深色是 #121212
      const expectedCanvas = expected === "light" ? "rgb(255, 255, 255)" : expected === "dark" ? "rgb(18, 18, 18)" : null;
      if (expectedCanvas) {
        check(step.canvasBg === expectedCanvas, `主题：${expected} 下画布底色应为 ${expectedCanvas}，实际 ${step.canvasBg}`);
      }
    }
    check(themeReport?.final?.pref === "system", `主题：收尾应回到跟随系统，实际 ${themeReport?.final?.pref}`);
  }

  /* ---------------- 命令面板 ---------------- */
  if (!paletteReport) {
    problems.push("命令面板：探针没有返回结果");
  } else {
    check(paletteReport.closedAtStart === true, "命令面板：初始就处于打开状态");
    check(!!paletteReport.opened, "命令面板：按 Ctrl+/ 没有打开");
    const opened = paletteReport.opened;
    if (opened) {
      for (const label of ["应用", "工具", "编辑器", "元素", "导出"]) {
        check(opened.groups.includes(label), `命令面板：缺少分组「${label}」，实际 ${opened.groups.join("/")}`);
      }
      // 基线 72 条（50 个引擎动作 + 10 个绘图工具 + 12 条外壳命令），见 docs/EXCALIDRAW-PARITY.md 第 1.4 节。
      // 取 70 作为下限：允许个位数浮动，但一旦整组加载失败（例如动作桥断了）会立刻暴露。
      check(opened.count >= 70, `命令面板：命令条数偏少（${opened.count}），可能有分组没加载出来`);
      check(
        (opened.labels ?? []).every((l) => l.length > 0),
        "命令面板：存在没有文案的命令项"
      );
      check(/Ctrl\+\//.test(opened.foot ?? ""), "命令面板：底部没有显示快捷键提示");
      check(!/仅显示外壳命令/.test(opened.foot ?? ""), "命令面板：引擎动作桥不可用（降级成只剩外壳命令）");
    }
    check(
      (paletteReport.searchCn?.count ?? 0) > 0,
      `命令面板：中文检索「对齐」无结果`
    );
    check(
      (paletteReport.searchEn?.count ?? 0) > 0,
      `命令面板：英文动作名检索「alignTop」无结果`
    );
    check(paletteReport.searchNone === true, "命令面板：无匹配时没有显示空状态");
    check(paletteReport.closedAfterEscape === true, "命令面板：Esc 没有关闭");
    check(paletteReport.openedByShiftP === true, "命令面板：Ctrl+Shift+P 没有打开");
  }

  ws.close();
} catch (error) {
  problems.push(`实测过程中抛出异常：${error.message}`);
} finally {
  child.kill();
  if (server) server.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
  if (tempData) rmSync(tempData, { recursive: true, force: true });
}

if (problems.length) {
  console.error(`\n[browser] 实测未通过，${problems.length} 处问题：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\n[browser] 通过：零外网请求、控制台干净、字体全本地、中文界面与点阵均生效。");
