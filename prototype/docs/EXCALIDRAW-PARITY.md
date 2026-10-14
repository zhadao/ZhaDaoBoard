# 上游对标记录 · `@excalidraw/excalidraw@0.18.1`

> 这份文档回答一个问题：**本项目的功能实现与官方 Excalidraw 差在哪、为什么差。**
> 每一处差异要么是「上游没有的、本项目自己加的」，要么是「上游有但我们**故意**不做的」，
> 不允许存在「说不清为什么不一样」的地方。
>
> 刷新基线：`node scripts/audit-upstream.mjs`（打印人类可读报告）或加 `--json`（机器可读）。
> 升级引擎版本后必须重跑，并同步更新本文件的数字。

---

## 0. 版本基线

| 项 | 值 |
| --- | --- |
| 上游包 | `@excalidraw/excalidraw` |
| 锁定版本 | **0.18.1**（`prototype/package.json` 的 `dependencies` 里写死，无 `^`/`~`） |
| 许可 | MIT |
| 用法 | **当库用（不 fork）**：`import { Excalidraw } from "@excalidraw/excalidraw"`，构建走 `dist/prod` |
| 引擎注册动作总数 | **98**（来自 `dist/types/excalidraw/actions/types.d.ts` 的 `ActionName` 联合类型） |
| 上游语言包（en）叶子键 | **513** |

### 为什么「当库用」而不是 fork

fork 一份 30 万行的 TS 工程，意味着此后每次上游更新都要手工 merge，而本项目的定制面
（字体、点阵、本地多白板、去联网）**全部落在 UI 外壳层**，不需要改引擎源码。
唯一必须改引擎源码的 5 处，用「构建期补丁」解决（见第 5 节），
特征是**锚点失配就抛错**——上游一改结构，构建直接失败，绝不静默产出错误结果。

---

## 1. 命令面板

### 1.1 为什么是外壳自建

引擎自带的命令面板在「当库用」形态下**是死的**：

- 产物里的 `VK` 组件（注册 `Ctrl+/` 监听、渲染 `.command-palette-dialog`）在整个产物中**只出现一次**
  ——就是它自己的定义，从未被任何地方挂载；
- `CommandPalette` / `useCommandPalette` **不在** `dist/types/excalidraw/index.d.ts` 的公开导出里；
- `MainMenu.DefaultItems.CommandPalette` 只是把 `openDialog` 置成 `commandPalette`，而渲染对话框的组件不存在，
  点了没有任何反应（这就是「命令面板没有内容」的根因）。

所以外壳按引擎 `CommandPalette.tsx` 的行为**逐条复刻**了一个（`src/editor/CommandPalette.tsx`）。

### 1.2 动作如何被执行：ActionManager 桥

引擎没给执行内置动作的入口（`ExcalidrawImperativeAPI` 只有 `registerAction`，没有 `executeAction`）。
确定性通路是 `ActionManager.handleKeyDown`：

```
handleKeyDown(event) → 命中唯一一个 keyTest → action.perform(elements, appState, event, app)
                                                                                    ↑ 第 4 个参数就是 App 实例
```

而 `App` 构造函数里有 `this.actionManager = new ActionManager(...)`。
于是「注册哨兵动作 → 在 `.excalidraw` 容器内派发合成 keydown → 在 `perform` 里收下 `app.actionManager`」
就成了一条稳定通路（`src/editor/engineBridge.ts`）。

这是**对内部实现的结构性依赖**，所以做了三层保护：

1. 哨兵快捷键用 `Ctrl+Alt+Shift+F12`，与引擎内置动作（全是字母/数字）不可能撞车；
2. 哨兵 `perform` 必须返回合法 `ActionResult`（`{ captureUpdate: CaptureUpdateAction.NEVER }`）
   —— 返回 `null` 会让引擎 `syncActionResult` 抛 `TypeError`（已实测）；
3. 取不到就降级为「只显示外壳命令」，面板底部明示，不报错、不影响任何已有功能。

### 1.3 分组与顺序：与上游逐条一致

上游的 `Pk()` 按这个顺序拼装：

```
N = [ ...H(elements), ...F(editor), clearCanvas(editor), exportImage(export), ...O(export) ]
j = [ 素材库(app), 搜索(app), 更改线条颜色(elements), 更改背景颜色(elements), 画布背景(editor),
      ...10 个绘图工具(tools), ...V(tools), 锁定(tools), 文生图(tools·AI), Mermaid 转图(tools·AI) ]
items = [ ...N, ...j, ...自定义项 ]
```

分组枚举与排序函数 `Dk()` 完全一致：

| 分类 | 上游 | 本项目 |
| --- | --- | --- |
| `App` | `"App"`（硬编码英文，没走语言包） | `"应用"` |
| `Export` | `"Export"` | `"导出"` |
| `Editor` | `"Editor"` | `"编辑器"` |
| `Tools` | `"Tools"` | `"工具"` |
| `Elements` | `"Elements"` | `"元素"` |
| `Links` | `"Links"` | `"链接"`（保留占位） |

> 注：`Links` 这个分类在 0.18.1 的产物里**只出现一次——它自己的定义**，没有任何命令用到它。
> 本项目保留该枚举值以对齐类型，但同样不会产生 `链接` 分组的命令。

元素类动作的**可用性兜底也一致**：上游对 `H` 数组里的动作统一注入
`predicate = (elements, appState) => 有选中元素`，本项目用 `requireSelection: true` 复刻。

### 1.4 覆盖数量对照

| | 上游 | 本项目 | 说明 |
| --- | --- | --- | --- |
| 引擎动作（走 ActionManager） | 51 | 50 | 少的 1 个是 `saveToActiveFile`（见下） |
| 绘图工具 | 10 | 10 | 同一张工具表，同一批快捷键 |
| 外壳补充 | — | 12 | 三态主题 ×3、侧边栏、点阵、吸附 ×3、导出 ×3、锁定 |
| **合计** | **71** | **72** | |

`ENGINE_ACTION_GROUPS`（`src/editor/engineCommands.ts`）与上游 `H / V / F / O` 四个数组
**逐条同序**，元素组 30 条、编辑器组 15 条、工具组 2 条、导出组 3 条。

### 1.5 上游有、本项目不列的命令（逐条说明）

| 上游命令 | 本项目处理 | 原因 |
| --- | --- | --- |
| `saveToActiveFile` | 不列 | 浏览器 File System Access API 保存，与「本地服务落盘」语义冲突；`UIOptions.canvasActions.saveToActiveFile = false` 本来就会禁掉它 |
| `library`（素材库侧边栏） | 不列 | 素材库仍可用（引擎右上角原生触发按钮），只是不重复放进面板；面板里的「显示 / 隐藏侧边栏」管的是本项目自己的白板列表 |
| `search`（搜索菜单） | 不列 | 与 `DefaultItems.SearchMenu` 同因——只有动作、没有渲染方，点不动；搜索能力由本面板的模糊检索承担 |
| `changeStroke` / `changeBackground` / `canvasBackground` | 不列 | 三者依赖引擎**内部 UI 状态**（`setState({openMenu, openPopup})`），`AppClassProperties` 没有 `setState`；对应能力在属性面板 / 工具栏。`canvasBackground` 另因本项目画布底色固定透明（点阵层需要）而整体关闭 |
| `clearCanvas` | 不列 | 这是**破坏性**动作。上游面板项会把内部原子 `In` 置成 `"clearCanvas"` 弹出二次确认，而那个原子不对外；直接执行引擎的 `clearCanvas` 动作是**无确认清空**。主菜单里已有带确认的「清空画布」，因此不在面板里再放一个危险入口 |
| `textToDiagram` / `mermaidToExcalidraw` | 不列 | 上游用 `predicate: aiEnabled` 门控，需要联网调用 AI；本项目 `aiEnabled` 恒为 `false`，上游在同样条件下也不显示 |
| 属性/样式类动作（`changeFillStyle`、`changeStrokeWidth`、`changeSloppiness`、`changeOpacity`、`changeFontSize`、`changeFontFamily`、`changeTextAlign`、`changeVerticalAlign`、`changeRoundness`、`autoResize` …） | 不列 | **上游也不列**——它们由属性面板与工具栏承担，只在 `PanelComponent` 形态下渲染 |
| `paste` / `copyText` / `toggleCanvasMenu` / `toggleEditMenu` / `finalize` / `loadScene` / `toggleFullScreen` / `changeViewBackgroundColor` / 导出对话框内部项（`changeProjectName`、`changeExportScale`、`changeExportBackground`、`changeExportEmbedScene`、`exportWithDarkMode`） | 不列 | **上游也不列**，属菜单/对话框内部动作 |
| `distributeHorizontally` / `distributeVertically` / `addToLibrary` / `bindText` / `unbindText` / `createContainerFromText` / `wrapTextInContainer` / `selectAllElementsInFrame` / `removeAllElementsFromFrame` / `updateFrameRendering` / `cropEditor`(已列) / `setEmbeddableAsActiveTool` / `toggleEraserTool` / `elementStats` | 不列 | **上游也不列**。前一组是上下文菜单/选区相关；`setEmbeddableAsActiveTool` 因「嵌入网页」整体下线；`toggleEraserTool` 的橡皮已在工具表里；`elementStats` 是另一套统计入口 |
| `goToCollaborator` | 不列 | 实时协作整体下线（需要远端 WebSocket） |
| `toggleTheme` | 不列（由外壳三态主题承担） | 上游面板里那个是「切换」语义；本项目是**三态**（浅色 / 深色 / 跟随系统），见第 4 节 |
| `commandPalette` | 不列 | 面板自身 |
| `hyperlink` / `copyElementLink` / `linkToElement` | **已列** | 与上游一致（元素组最后 3 条） |

### 1.6 交互细节对照

| 行为 | 上游 | 本项目 |
| --- | --- | --- |
| 打开快捷键 | `CtrlOrCmd+/`、`CtrlOrCmd+Shift+P` | 同 |
| 方向键 | 捕获阶段拦截 `↑`/`↓` 循环选择 | 同 |
| 回车 | `setTimeout` 后执行 | `requestAnimationFrame` 后执行（等价） |
| Esc | 关闭 | 同 |
| 可用性判定 | `viewMode === false && appState.viewModeEnabled → 禁用`；有 `predicate` 就用它；否则默认可用 | 同（元素组额外注入「需有选中元素」，与上游一致） |
| 检索串 | `normalize(label) + keywords`，模糊匹配 | `label + keywords + 分类名`，连续子串优先 → 子序列 |
| 检索增强 | — | **额外把英文动作名塞进检索串**：界面全中文，但用户很可能按 `alignTop` / `zoomToFit` 搜（上游面板做不到这一点） |
| 面板尺寸 | `size: 720`，类名 `command-palette-dialog` | 宽度 720px 上限，类名 `wb-palette*`（自建样式） |

---

## 2. 快捷键

**策略：全部保留，一条不删。** 快捷键是否生效完全由引擎自己的 `keyTest` 决定，
本项目只做两件事：把引擎的快捷键表复刻一份用于**显示**（`ENGINE_SHORTCUTS`），以及
把「问号帮助面板」顶部的 4 个外链按钮从界面上摘掉（快捷键列表本身完整保留）。

引擎 `shortcuts.ts` 的完整表（从产物中提取，与本项目 `ENGINE_SHORTCUTS` 逐条核对）：

| 动作 | 快捷键 |
| --- | --- |
| `toggleTheme` | `Shift+Alt+D` |
| `saveScene` / `saveFileToDisk` / `saveToActiveFile` | `CtrlOrCmd+S` |
| `loadScene` | `CtrlOrCmd+O` |
| `clearCanvas` | `CtrlOrCmd+Delete` |
| `imageExport` | `CtrlOrCmd+Shift+E` |
| `commandPalette` | `CtrlOrCmd+/`、`CtrlOrCmd+Shift+P` |
| `cut` / `copy` / `paste` | `CtrlOrCmd+X` / `C` / `V` |
| `copyStyles` / `pasteStyles` | `CtrlOrCmd+Alt+C` / `CtrlOrCmd+Alt+V` |
| `selectAll` | `CtrlOrCmd+A` |
| `deleteSelectedElements` | `Delete` |
| `duplicateSelection` | `CtrlOrCmd+D`、`Alt+拖拽` |
| `sendBackward` / `bringForward` | `CtrlOrCmd+[` / `CtrlOrCmd+]` |
| `sendToBack` / `bringToFront` | macOS `CtrlOrCmd+Alt+[`/`]`，其他 `CtrlOrCmd+Shift+[`/`]` |
| `copyAsPng` | `Shift+Alt+C` |
| `group` / `ungroup` | `CtrlOrCmd+G` / `CtrlOrCmd+Shift+G` |
| `gridMode` | `CtrlOrCmd+'` |
| `zenMode` | `Alt+Z` |
| `objectsSnapMode` | `Alt+S` |
| `stats` | `Alt+/` |
| `addToLibrary` | （无） |
| `flipHorizontal` / `flipVertical` | `Shift+H` / `Shift+V` |
| `viewMode` | `Alt+R` |
| `hyperlink` | `CtrlOrCmd+K` |
| `toggleElementLock` | `CtrlOrCmd+Shift+L` |
| `resetZoom` / `zoomOut` / `zoomIn` | `CtrlOrCmd+0` / `CtrlOrCmd+-` / `CtrlOrCmd++` |
| `zoomToFitSelection` / `zoomToFit` / `zoomToFitSelectionInViewport` | `Shift+3` / `Shift+1` / `Shift+2` |
| `toggleEraserTool` / `toggleHandTool` / `setFrameAsActiveTool` | `E` / `H` / `F` |
| `toggleShortcuts` | `?` |
| `searchMenu` | `CtrlOrCmd+F`（对应功能已下线，快捷键无副作用） |
| `wrapSelectionInFrame` | （无） |

**已知取舍**：`Shift+Alt+D`（引擎的「切换主题」）仍然可用，但它是**二态**切换
（浅 ⇄ 深），与外壳的三态模型不完全对齐——详见第 4.1 节。

---

## 3. 绘图工具

工具表与上游 `Mm` 数组逐条一致，快捷键（字母 + 数字）全部保留：

| 工具 | 快捷键 | 数字键 |
| --- | --- | --- |
| 选择 `selection` | `V` | `1` |
| 矩形 `rectangle` | `R` | `2` |
| 菱形 `diamond` | `D` | `3` |
| 椭圆 `ellipse` | `O` | `4` |
| 箭头 `arrow` | `A` | `5` |
| 线条 `line` | `L` | `6` |
| 自由绘制 `freedraw` | `P` | `7` |
| 文字 `text` | `T` | `8` |
| 图片 `image` | `9` | `9` |
| 橡皮 `eraser` | `E` | `0` |

工具锁定（`Q`，工具栏最右侧的锁）保留，并在命令面板里也提供了「锁定 / 解锁工具」。

---

## 4. 有意保留的差异

这些是**产品定位决定的不对齐**，不是遗漏。前 5 项是用户明确要求的方向。

### 4.1 主题：二态 → 三态

| | 上游 | 本项目 |
| --- | --- | --- |
| 语义 | `light` / `dark` 二态 | `light` / `dark` / `system` **三态** |
| 存储 | `localStorage`（按「协议+主机+端口」隔离） | **`data/prefs.json`**，服务器把 `data-theme` / `data-theme-pref` 注入 `index.html` 的 `<html>` |
| 首屏 | 由前端 JS 解析 | 服务器注入 → **首屏即正确，无闪烁** |
| 入口 | 主菜单一项 | 顶栏、侧边栏、引擎主菜单、命令面板**四个入口**，互相同步 |

**为什么必须改存储**：`localStorage` 按源隔离，而本地服务器端口会漂移（4173 → 4174 …），
且 `localhost` 与 `127.0.0.1` 不同源 —— 偏好会静默丢失、回落到系统深色。
用户三次反馈「不管怎么点都是深色背景」，根因就在这里。

**属性对约定**（两个属性分工明确，不要混用）：

- `data-theme-pref` = 用户选择，**权威值**，取值 `light` / `dark` / `system`
- `data-theme` = 解析后的实际主题，驱动 CSS，取值 `light` / `dark`
  （`system` 时由前端按 `prefers-color-scheme` 解析后写入）

引擎侧用官方三态 API `<MainMenu.DefaultItems.ToggleTheme allowSystemTheme theme onSelect>`，
它内部渲染 `RadioGroup` + `<input name="theme" type="radio">`，**不碰引擎 appState** ——
外壳是主题的唯一事实来源。

> 注意：`UIOptions.canvasActions.toggleTheme` **必须保持 `true`**。
> 因为 `actionToggleTheme.predicate` 就是 `!!UIOptions.canvasActions.toggleTheme`，
> 置 `false` 会连带禁掉引擎主菜单里的主题项与 `Shift+Alt+D`。

### 4.2 字体：不用引擎的四个家族，改绑普惠体

| | 上游 | 本项目 |
| --- | --- | --- |
| 手绘 | Excalifont | **Virgil**（单分片） |
| 常规 | Nunito | **Helvetica**（单分片） |
| 代码 | Comic Shanns | **Cascadia**（单分片） |
| 中文字体 | 无（回退 Xiaolai，131 个分片） | **普惠体**（常规 / 中黑 / 加粗三个字重） |

三个槽位由构建期补丁 `patchFontSlots` 改绑；普惠体放在 `dist/fonts/puhuiti/`，
由 `dist/font-map.json` 建立「家族 → 字重」映射，`server.cjs` 在字体请求上做别名。
界面上只保留三个**字重**按钮（所有家族都被别名到普惠体，列出家族名只会让人困惑）。

引擎的 esm.sh 字体兜底 URL 由 `patchFontFallback` 摘掉——纯本地工具不需要外部兜底，
留着只会在 CSP 下刷一堆 console 报错。

### 4.3 点阵模式 + 吸附选项

| | 上游 | 本项目 |
| --- | --- | --- |
| 网格 | 虚线网格（`gridMode` 一个开关同时管「画网格」和「吸附网格」） | 外壳自绘**点阵**（笔记纸质感） |
| 吸附 | 网格吸附 / 对象吸附 | 三选一：不吸附 / 吸附点阵节点 / 吸附对象边缘 |

引擎把「画不画网格」和「要不要吸附」耦合在同一个谓词里，所以用 `patchGridRender`
把**渲染**那一处替换成常量 `false`，`getEffectiveGridSize()`（驱动吸附）原样保留 ——
显示与吸附彻底解耦。

### 4.4 本地多白板 + 数据全落 `data/`

上游是「单画布 + 浏览器存储 + 可选云端」。本项目是**多白板 + 本地文件**：

```
data/
├── boards.json          白板列表
├── boards/<id>.json     每块白板的场景
├── assets/<id>.<ext>    图片（按内容哈希去重）
├── library.json         素材库
├── prefs.json           界面偏好
└── backups/             每次保存前留一份上一版
```

保存走「租约 + revision 递增 + 原子写」：客户端先取租约（45s），保存时带 revision，
版本落后返回 409 由前端提示，避免多标签页互相覆盖。所有写操作串行化 + 先写临时文件再 rename。

素材库用引擎公开的 `useHandleLibrary` + `LibraryPersistenceAdapter`
（`src/editor/useLibrary.ts`）把持久化改到 `/api/library` → `data/library.json`，
**素材库功能本身不变**，只是不再走浏览器内置存储。

### 4.5 去联网：入口摘掉 + CSP 硬兜底

两道防线：

1. **界面**：素材库的「浏览社区素材库」按钮、字体下拉里的家族列表、
   「嵌入网页」工具、快捷键帮助面板顶部的 4 个外链按钮、主菜单里的
   Socials（GitHub / X / Discord）与实时协作入口 —— 全部从界面上摘掉。
2. **CSP**（`server/server.cjs`）：`default-src 'self'`、`connect-src 'self'`、
   `frame-src 'none'`、`object-src 'none'`、`form-action 'none'`、`script-src 'self'`（无 `unsafe-inline`）。
   就算有人绕过界面，请求也发不出去。

`npm run verify:offline` 把这件事变成可执行断言：入口全同源、字体家族全部本地命中、
无外部字体兜底、CSP 指令齐全；`npm run verify:browser` 再用真实浏览器统计**实际网络流量**
（当前基线：36 个请求，外网请求 0 个）。

### 4.6 图片体积上限：4 MiB → 64 MiB

上游在插入图片时 `if (size > 4 * 1024 * 1024) throw fileTooBig`。
对「图片灵感板」这个定位来说太苛刻（一张手机直出照片就可能超），
所以用 `patchFileSizeLimit` 把上限提到 **64 MiB**。

三个数字必须同步，否则会出现「画布接受、保存失败」的割裂体验：

| 位置 | 值 |
| --- | --- |
| 引擎常量（`scripts/excalidraw-patch.mjs` 的 `MAX_IMAGE_BYTES`） | 64 MiB |
| 服务端 `IMAGE_LIMIT`（`server/server.cjs`） | 64 MiB |
| 服务端 `BODY_LIMIT`（请求体，图片 base64 内联会膨胀约 4/3） | 256 MiB |

`tests/server.test.mjs` 里有一条断言直接把服务端 `/api/health` 报出来的上限
与 `MAX_IMAGE_BYTES` 绑在一起，两处数字无法各自漂移。

> 用户的原则：「画板上的内容太多了，性能优化不是用户的事，是画板自己的事。」
> 所以上限只拦「大得离谱」的文件，不做画质压缩。

### 4.7 其它上游能力

| 上游能力 | 本项目 | 原因 |
| --- | --- | --- |
| 实时协作（房间 / WebSocket） | 下线 | 需要远端服务；本地单机工具用不到 |
| 云端分享 / 发布链接 | 下线 | 同上 |
| 「在 excalidraw.com 打开」 | 下线 | 同上 |
| 素材库社区浏览 | 下线（本地素材库保留） | 同上 |
| 嵌入网页（`iframe` / 可嵌入链接） | 下线 | 与 `frame-src 'none'` 冲突，且是本项目不需要的联网入口 |
| AI 文生图 / Mermaid 转图 | 不启用（`aiEnabled = false`） | 需要联网调用 AI |
| 「保存到活动文件」（File System Access） | 关闭 | 与本地服务落盘语义冲突 |
| 欢迎页 / 教程弹窗 | 关闭（`showWelcomeScreen: false`） | 双击 exe 即用，不需要引导 |
| 画布底色可改 | 关闭 | 点阵层需要透明画布，底色由外壳提供 |

---

## 5. 构建期补丁清单

全部位于 `scripts/excalidraw-patch.mjs`，策略统一为**特征串锚定 + 找不到就抛错**。

| # | 补丁 | 作用 | 产物级验证 |
| --- | --- | --- | --- |
| 1 | `patchZhCnLocale` | 把 zh-CN 缺失的 91 个键合并进语言包模块的 `default` 导出 | `verify:offline` 抽查补译内容确实出现在 zh-CN chunk 里 |
| 2 | `patchFontSlots` | 三个字体槽位从 Excalifont / Nunito / Comic Shanns 改绑到 Virgil / Helvetica / Cascadia | 断言选择器数组里只剩单分片家族 |
| 3 | `patchGridRender` | 关掉引擎自带虚线网格绘制，保留 `getEffectiveGridSize` 的吸附能力 | 断言产物含 `renderGrid:!1` |
| 4 | `patchFontFallback` | 删掉 `FontFaceUrls.createUrls()` 里无条件追加的 esm.sh 兜底 URL | 断言产物里不存在 `new URL(..., ASSETS_FALLBACK_URL)` |
| 5 | `patchFileSizeLimit` | 单张图片上限 4 MiB → 64 MiB | 断言产物里 `4*1024*1024` 消失、`67108864` 出现 |

### 踩过的坑：补丁链不能短路

补丁链最初写成 `patchA(code) ?? patchB(code) ?? ...`。问题在于引擎把**多个补丁目标塞进了同一个 chunk**：

- `chunk-K2UTITRG.js` 同时含 `ASSETS_FALLBACK_URL` 与 `4*1024*1024`
- `index.js` 同时含字体槽位与 `renderGrid`

于是「第一个命中的补丁」会把后面所有补丁**静默吞掉**：构建成功、日志干净、产物却没改。

现在改成逐个顺序应用（`applyPatches()`），并且加了三条**产物级**回归断言
（`tests/excalidraw-patch.test.mjs` + `scripts/verify-offline.mjs` 第 2.6 节）——
单测只验单个补丁函数，管不住这类「链」的 bug。

---

## 6. 汉化

### 6.1 覆盖情况

| 项 | 数量 |
| --- | --- |
| 上游 en 语言包叶子键 | 513 |
| 引擎自带 zh-CN 叶子键 | 429 |
| zh-CN 相对 en 缺失 | **91** |
| 本项目补译（`src/i18n/zh-CN.extra.json`） | 94 条（91 条补缺 + 3 条字体标签覆盖） |
| 补完后仍缺 | **0** |

补译在**构建期**注入语言包模块（`patchZhCnLocale`），不是在运行时覆盖 ——
因为引擎 i18n 的回退顺序是「当前语言 → en → 显式 fallback」，
运行时覆盖只能盖住已经渲染过的节点，缺键在首屏仍会闪一下英文。

### 6.2 补译范围

- **属性面板与形状弹层**：`labels.changeStroke`（更改线条颜色）、
  `labels.changeBackground`（更改背景颜色）、`labels.more_options`（更多选项）等；
- **箭头类型**：`labels.arrowtypes`、`labels.arrowhead_*` 系列
  （`arrowhead_crowfoot_one` = 鸦爪形（单）…）；
- **字体标签**：三个槽位的展示名改成普惠体的三个字重；
- **命令面板**：`commandPalette.search.placeholder` 等；
- **三态主题**：`buttons.systemMode` = 「跟随系统」。

### 6.3 引擎没走语言包、只能在外壳里翻的文案

| 位置 | 上游 | 本项目 |
| --- | --- | --- |
| 命令面板分类名 | 硬编码 `App` / `Export` / `Tools` / `Editor` / `Elements` / `Links` | 外壳翻成 `应用` / `导出` / `工具` / `编辑器` / `元素` / `链接` |
| 外壳自建 UI（顶栏、侧边栏、命令面板外壳、点阵/吸附开关） | — | 全部中文，文案写在外壳源码里 |

### 6.4 保留英文的地方（刻意）

- **命令面板的检索**：把英文动作名（`alignTop`、`zoomToFit`…）也塞进检索串，
  界面显示中文、但中英都能搜到；
- **`.excalidraw` / `.excalidrawlib` 文件格式名与扩展名**：这是上游的互操作格式，不翻译；
- **快捷键提示里的 `Ctrl` / `Shift` / `Alt` / `Enter` / `Esc`**：按键名不翻译。

---

## 7. 主菜单

上游 `MainMenu.DefaultItems` 一共 12 项，本项目用 7 项：

| 上游默认项 | 本项目 | 说明 |
| --- | --- | --- |
| `LoadScene`（打开） | ✅ | |
| `Export`（导出） | ✅ | |
| `SaveAsImage`（导出图片） | ✅ | |
| `ToggleTheme`（主题） | ✅ | 改用 `allowSystemTheme` 三态 |
| `ClearCanvas`（清空画布） | ✅ | 带二次确认 |
| `Help`（帮助） | ✅ | 外链按钮已摘掉，快捷键列表完整保留 |
| `CommandPalette` | 🔁 替换 | 上游这个只是置 `openDialog`，在库形态下点不动；换成外壳自建面板的入口 |
| `SearchMenu` | ❌ 去掉 | 同上，只有动作没有渲染方 |
| `SaveToActiveFile` | ❌ 去掉 | 与本地服务落盘语义冲突 |
| `ChangeCanvasBackground` | ❌ 去掉 | 画布底色固定透明（点阵层需要） |
| `Socials` | ❌ 去掉 | GitHub / X / Discord 外链 |
| `LiveCollaborationTrigger` | ❌ 去掉 | 实时协作需远端服务 |

---

## 8. 验证方式

| 命令 | 覆盖内容 |
| --- | --- |
| `npm run audit:upstream` | 版本基线、动作覆盖数、语言包覆盖数（本文件的数字来源） |
| `npm run typecheck` | 类型 |
| `npm run lint` | 代码规范（含「tokens 外不许裸色值」「localStorage 白名单」等自定义规则） |
| `npm test` | 单元 + 集成：补丁链、服务端数据安全、租约与版本冲突、偏好注入、体积上限 |
| `npm run build` | 构建（补丁锚点失配会直接失败） |
| `npm run verify:offline` | 产物级：入口全同源、字体全本地、**5 个补丁全部生效**、CSP 完整 |
| `npm run verify:browser` | 真实浏览器：零外网请求、控制台干净、字体全本地、中文界面、点阵生效、命令面板可用 |

---

## 9. 升级上游时要做的事

1. 改 `prototype/package.json` 里的版本号（保持**精确版本**，不用 `^`）；
2. `npm install`；
3. `npm run build` —— 补丁锚点失配会直接抛错，按报错逐个修正 `scripts/excalidraw-patch.mjs`；
4. `npm test` —— 补丁链与产物断言会再验一遍；
5. `npm run audit:upstream` —— 刷新本文件的数字（动作数、语言包键数、覆盖数）；
6. `npm run verify:offline && npm run verify:browser`；
7. 复核第 1.5 / 4.x 节里每一张「上游有我们不列」的表 —— 上游可能新增或删除了动作；
8. 更新本文件顶部的版本号与第 0 节的基线表。
