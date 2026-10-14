/**
 * 把构建好的 `WhiteBoard.exe` 封装成一个可以直接双击使用的正式版目录。
 *
 * 用法：
 *   npm run release                 # = build:exe + 本脚本，输出到 <仓库根>/../release
 *   node scripts/package-release.mjs [目标目录]
 *
 * 设计原则：
 *   - 正式版目录与 `prototype/` 完全隔离：exe 把用户数据写在**自己所在目录**的 `data/`，
 *     所以两份互不影响，prototype 里那些测试白板不会被搬过来（也不会被动）。
 *   - 只复制「运行所需」的东西：exe + 启动脚本 + 说明 + 许可声明 + 快捷方式。
 *     源码、node_modules、构建中间产物一律不进正式版。
 *   - `THIRD-PARTY-NOTICES.md` 是**合规文件**（exe 里内嵌了 MIT 的 Excalidraw 与各字体），
 *     必须跟着分发走，所以这里一并复制。
 *   - 快捷方式由 scripts/make-shortcut.mjs 直接写二进制生成（不用 COM / PowerShell，
 *     见那个脚本的说明），所以在任何终端里都能一次跑完。
 */
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createShortcut, parseShortcut, idListToPath } from "./make-shortcut.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXE = path.join(ROOT, "WhiteBoard.exe");
const NOTICES = path.join(ROOT, "THIRD-PARTY-NOTICES.md");

const target = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(ROOT, "..", "release");

const SHORTCUT_NAME = "白板.lnk";

/**
 * 批处理脚本必须用 CRLF 行尾。
 *
 * cmd.exe 对 LF-only 的 .bat 解析不可靠：跨行括号块、标签、以及带重定向的行都可能被
 * **静默吞掉**。模板字面量里写的都是 \n，所以落盘前统一转一次。
 * `scripts/lint.mjs` 有对应规则（`bat-crlf`）守着，防止以后再退化。
 */
const toCrlf = (text) => text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");

const BAT = `@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 白板 · 本地无限画布
echo.
echo   正在启动白板...
echo.
"WhiteBoard.exe"
echo.
echo   服务已停止。你的白板与图片都在本目录的 data\\ 里，不会丢失。
pause
`;

const GUIDE = `# 白板 · 本地无限画布

## 怎么用

双击 **WhiteBoard.exe**（或本目录里的「白板」快捷方式）即可。
程序会在本机起一个只监听 \`127.0.0.1\` 的本地服务，并自动打开浏览器。
不需要安装 Node，不需要联网。

## 数据在哪

全部内容都在 **本目录的 \`data\\\` 文件夹**里：

| 路径 | 内容 |
|---|---|
| \`data/boards/\` | 每块白板的场景与元信息（JSON） |
| \`data/assets/\` | 画布上粘贴/拖入的图片 |
| \`data/backups/\` | 每次保存前的上一版快照 |
| \`data/trash/\` | 删除的白板（软删除，可直接捞回来） |
| \`data/library.json\` | 个人素材库（自定义图形） |
| \`data/prefs.json\` | 界面偏好（主题、点阵、吸附） |

- **备份 = 复制整个目录**。换电脑时把 \`data\\\` 一起带走，白板就跟着走。
- 删除白板是**软删除**：文件先移到 \`data/trash/\`，需要时手动复制回 \`data/boards/\` 即可。
- 想从零开始：关掉程序，把 \`data\\\` 改名或删掉，下次启动会自动重建。
- **想撤销某次误改**：\`data/backups/<白板id>.json\` 是**上一次保存前**的快照。
  把它复制回 \`data/boards/<白板id>.json\`（覆盖前先备份现文件），重启程序即生效。

## 常见问题

**端口被占用 / 同时开了两个实例**
程序会先探测：如果本机已有同款实例在跑，就直接复用它的地址，不会起第二个。

**浏览器没自动打开**
看窗口里打印的 \`地址：http://127.0.0.1:xxxxx/\`，手动粘贴到浏览器即可。

**想彻底关掉**
关掉那个黑色命令行窗口，或按 \`Ctrl+C\`。

**Windows 提示"未知发布者"**
exe 没有做代码签名（个人工具，省了证书钱）。点「更多信息 → 仍要运行」即可。
它只监听 \`127.0.0.1\`，不对外网开放。

## 技术说明

- 画布引擎：[Excalidraw](https://github.com/excalidraw/excalidraw) \`0.18.1\`（MIT），**当库使用**，未 fork。
- 本程序为个人本地工具，离线运行，没有任何联网入口（CSP 已硬保证 \`connect-src 'self'\`）。
- 第三方组件与许可全文见同目录的 **\`THIRD-PARTY-NOTICES.md\`**（分发合规要求，请勿删除）。
`;

function createReleaseShortcut(dir) {
  const linkPath = path.join(dir, SHORTCUT_NAME);
  const exePath = path.join(dir, "WhiteBoard.exe");
  createShortcut(linkPath, exePath, {
    workingDir: dir,
    iconPath: exePath,
    name: "白板 · 本地无限画布",
  });
  // 写完立刻解析回来对账：快捷方式坏了是「双击没反应」，肉眼看不出来
  const parsed = parseShortcut(linkPath);
  const problems = [];
  if (parsed.linkInfo?.localBasePath !== exePath) problems.push(`LinkInfo 指向 ${parsed.linkInfo?.localBasePath}`);
  if (parsed.strings.workingDir !== dir) problems.push(`工作目录是 ${parsed.strings.workingDir}`);
  if (parsed.strings.iconLocation !== exePath) problems.push(`图标位置是 ${parsed.strings.iconLocation}`);
  // IDList 才是 Shell 解析目标时真正用的那一份，必须也还原成同一个路径
  const fromIdList = idListToPath(parsed.idList ?? []);
  if (fromIdList !== exePath) problems.push(`IDList 还原成 ${fromIdList}`);
  if (problems.length) throw new Error(`快捷方式自检失败：${problems.join("；")}`);
  return linkPath;
}

function main() {
  if (!existsSync(EXE)) {
    throw new Error(`缺少 ${EXE}，请先运行 npm run build:exe。`);
  }
  if (!existsSync(NOTICES)) {
    // 合规文件缺失不该静默通过：exe 里内嵌了 MIT 的 Excalidraw 与各字体，必须随分发提供。
    throw new Error(`缺少 ${NOTICES}（第三方许可声明是分发合规要求），无法封装正式版。`);
  }
  mkdirSync(target, { recursive: true });

  const exeTarget = path.join(target, "WhiteBoard.exe");
  copyFileSync(EXE, exeTarget);
  copyFileSync(NOTICES, path.join(target, "THIRD-PARTY-NOTICES.md"));
  writeFileSync(path.join(target, "启动白板.bat"), toCrlf(BAT), "utf8");
  writeFileSync(path.join(target, "使用说明.md"), GUIDE, "utf8");

  // 快捷方式失败**不阻断封装**（exe 与 .bat 才是主入口，功能完全一致），
  // 但必须显式喊出来 —— 静默降级是本项目明令禁止的。
  let shortcut = null;
  let shortcutError = null;
  try {
    shortcut = createReleaseShortcut(target);
  } catch (error) {
    shortcutError = error.message;
  }

  const size = (statSync(exeTarget).size / 1024 / 1024).toFixed(1);
  console.log(
    `[release] 已封装到 ${target}\n` +
      `          WhiteBoard.exe（${size} MB）、启动白板.bat、使用说明.md、THIRD-PARTY-NOTICES.md` +
      `${shortcut ? `、${SHORTCUT_NAME}` : ""}\n` +
      (shortcut
        ? `          快捷方式目标：${shortcut}\n`
        : `          ⚠️ 未生成快捷方式：${shortcutError}\n` +
          `          ⚠️ 双击「启动白板.bat」同样能启动，功能完全一致。\n`) +
      `          用户数据将在首次启动时写入 ${path.join(target, "data")}（本脚本不复制、不修改任何已有数据）。`
  );
}

try {
  main();
} catch (error) {
  console.error(`[release] 封装失败：${error.message}`);
  process.exitCode = 1;
}
