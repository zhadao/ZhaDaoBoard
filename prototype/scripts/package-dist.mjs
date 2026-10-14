/**
 * 打一份「可以复制、可以分享」的发行版目录（默认 `../ZhaDaoBoard`）。
 *
 * 用法：
 *   npm run dist                          # = build:exe + 本脚本，输出到 <仓库根>/../ZhaDaoBoard
 *   node scripts/package-dist.mjs [目标目录]
 *
 * ## 和 `npm run release` 的区别（别把两者搞混）
 *
 * | | `release/`（package-release.mjs） | `ZhaDaoBoard/`（本脚本） |
 * |---|---|---|
 * | 用途 | **本机自用**的正式版 | **发给别人 / 备份留存**的发行版 |
 * | 快捷方式 | 有（`白板.lnk`） | **没有** |
 * | 数据目录 | 会跟着长起来 | 首次运行时才创建 |
 *
 * **为什么发行版不带快捷方式**：`.lnk` 里存的是**绝对路径**（IDList 里逐级的目录项 +
 * LinkInfo 的 LocalBasePath），一旦整个文件夹被复制到别处、或换一台机器，快捷方式就
 * 指向原来的位置而失效 —— 看起来就是「这个文件夹里只有一个坏掉的快捷方式，没有软件本体」。
 * 所以发行版只放**本体**，接收方双击 exe 即可；想固定到桌面/开始菜单，自己右键
 * 「发送到 → 桌面快捷方式」或「固定到任务栏」，Windows 会按当时的真实路径生成，一定是对的。
 *
 * ## 只放什么
 *
 * 1. `WhiteBoard.exe`              —— 软件本体（前端资源已内嵌，不需要 Node、不需要联网）
 * 2. `启动白板.bat`                 —— 双击启动器（带中文提示的降级入口）
 * 3. `使用说明.md`                  —— 给接收方看的说明
 * 4. `THIRD-PARTY-NOTICES.md`      —— 分发合规（exe 里内嵌了 MIT 的 Excalidraw 与各字体）
 *
 * ## 明确不放什么
 *
 * - **任何用户数据**（`data/`：白板、图片、备份、回收站）—— 发行版是干净的软件本体
 * - **开发侧的一切**：源码、`node_modules`、`dist/`、构建脚本、测试、设计/需求/审查文档
 * - **对话记忆**（`.workbuddy-ai/`）
 * - **快捷方式**（理由见上）
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXE = path.join(ROOT, "WhiteBoard.exe");
const NOTICES = path.join(ROOT, "THIRD-PARTY-NOTICES.md");

const target = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(ROOT, "..", "ZhaDaoBoard");

/** 发行版里允许存在的文件名（多一个都算「夹带了不该带的东西」）。 */
const MANIFEST = ["WhiteBoard.exe", "启动白板.bat", "使用说明.md", "THIRD-PARTY-NOTICES.md"];

/** 批处理必须 CRLF 行尾，否则 cmd.exe 会静默吞掉带重定向的行（见 lint.mjs 的 bat-crlf）。 */
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

个人本地白板工具（Windows）。**不需要安装任何东西，不需要联网。**

## 怎么用

双击 **\`WhiteBoard.exe\`**。

程序会在本机起一个只监听 \`127.0.0.1\` 的本地服务，并自动打开浏览器，就可以开始画了。
关掉那个黑色命令行窗口 = 停止程序；数据已经写进磁盘，不会丢。

> 想固定到桌面/任务栏：右键 \`WhiteBoard.exe\` →「发送到 → 桌面快捷方式」，
> 或右键任务栏图标 →「固定到任务栏」。**请不要复制别人给的快捷方式** ——
> 快捷方式里存的是绝对路径，换台机器/换个目录就失效了。

## 数据在哪

全部内容都在 **本目录的 \`data\\\` 文件夹**里（首次运行时自动创建）：

| 路径 | 内容 |
|---|---|
| \`data/boards/\` | 每块白板的场景与元信息（JSON） |
| \`data/assets/\` | 画布上粘贴/拖入的图片 |
| \`data/backups/\` | 每次保存前的上一版快照 |
| \`data/trash/\` | 删除的白板（软删除，可直接捞回来） |
| \`data/library.json\` | 个人素材库（自定义图形） |
| \`data/prefs.json\` | 界面偏好（主题、点阵、吸附） |

- **备份 = 复制整个目录**。换电脑时把整个文件夹一起带走，白板就跟着走。
- 删除白板是**软删除**：文件先移到 \`data/trash/\`，需要时手动复制回 \`data/boards/\` 即可。
- 想从零开始：关掉程序，把 \`data\\\` 改名或删掉，下次启动会自动重建。
- **想撤销某次误改**：\`data/backups/<白板id>.json\` 是**上一次保存前**的快照。
  把它复制回 \`data/boards/<白板id>.json\`（覆盖前先备份现文件），重启程序即生效。

## 常见问题

**整个文件夹能直接拷给别人吗？**
可以。它就是完整本体，拷过去双击 \`WhiteBoard.exe\` 就能用。
注意两点：① 别把 \`data\\\` 一起给出去，那是你的白板内容；② 路径尽量用纯英文。

**端口被占用 / 同时开了两个实例**
程序会先探测：如果本机已有同款实例在跑，就直接复用它的地址，不会起第二个。

**浏览器没自动打开**
看窗口里打印的 \`地址：http://127.0.0.1:xxxxx/\`，手动粘贴到浏览器即可。

**Windows 提示「未知发布者」**
exe 没有做代码签名。点「更多信息 → 仍要运行」即可。它只监听 \`127.0.0.1\`，不对外网开放。

## 技术说明

- 画布引擎：[Excalidraw](https://github.com/excalidraw/excalidraw) \`0.18.1\`（MIT），**当库使用**，未 fork。
- 前端资源、字体、图标全部内嵌在 exe 里，离线运行，没有任何联网入口。
- 第三方组件与许可全文见同目录的 **\`THIRD-PARTY-NOTICES.md\`**（分发合规要求，请勿删除）。
`;

function main() {
  if (!existsSync(EXE)) throw new Error(`缺少 ${EXE}，请先运行 npm run build:exe。`);
  if (!existsSync(NOTICES)) {
    throw new Error(`缺少 ${NOTICES}（分发合规要求），无法打发行版。`);
  }

  // 防呆：别把发行版打进构建目录或覆盖 release/
  const rel = path.relative(ROOT, target);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new Error(`发行版目录不能放在构建目录内部（${target}）。`);
  }
  if (path.basename(target).toLowerCase() === "release") {
    throw new Error("发行版不要输出到 release/ —— 那是本机自用版，两者职责不同。");
  }

  mkdirSync(target, { recursive: true });

  copyFileSync(EXE, path.join(target, "WhiteBoard.exe"));
  copyFileSync(NOTICES, path.join(target, "THIRD-PARTY-NOTICES.md"));
  writeFileSync(path.join(target, "启动白板.bat"), toCrlf(BAT), "utf8");
  writeFileSync(path.join(target, "使用说明.md"), GUIDE, "utf8");

  // 对账：目标目录里除了清单内的文件，只允许出现 data/（用户自己跑出来的），其余一律点出来。
  // 不自动删 —— 删别人的文件是不可逆操作，宁可让用户自己决定。
  const extras = readdirSync(target).filter(
    (name) => !MANIFEST.includes(name) && name !== "data"
  );

  const size = (statSync(path.join(target, "WhiteBoard.exe")).size / 1024 / 1024).toFixed(1);
  console.log(
    `[dist] 已生成发行版：${target}\n` +
      MANIFEST.map((name) => `         · ${name}`).join("\n") +
      `\n         WhiteBoard.exe ${size} MB（前端资源 + 字体 + 图标已内嵌，可整目录复制分享）\n` +
      `         未包含：用户数据 data/、源码、构建产物、开发文档、对话记忆、快捷方式（理由见脚本头注释）`
  );
  if (extras.length) {
    console.warn(
      `[dist] ⚠️ 目标目录里还有不属于发行版的东西，请自行确认是否要留着：\n` +
        extras.map((name) => `         · ${name}`).join("\n")
    );
  }
}

try {
  main();
} catch (error) {
  console.error(`[dist] 打包失败：${error.message}`);
  process.exitCode = 1;
}
