# 个人本地白板工具 · 需求对接与任务拆解

> **版本** v1.2 · **日期** 2026-10-13 · **状态** 第一轮与第二轮需求均已落地（见「决策记录」与「★ 第二轮需求」）
> **参考项目** [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw)（MIT 许可）
> **对标产品** Milanote（免费版 100 卡上限）
> **工作区** `D:/Coding/WhiteBoard`（代码在 `prototype/`）

---

## 决策记录（已确认）

| # | 决策项 | 结论 | 影响 |
|---|---|---|---|
| D1 | **运行形态** | **本地服务 + 浏览器**（含双击即用的 `WhiteBoard.exe`） | 不需要 Tauri/Electron；双击 exe 或 `npm run dev` 即用 |
| D2 | **分享方式** | **导出 `.excalidraw` 文件**（放弃"真链接"） | 不需要任何后端；发文件给对方导入即可 |
| D3 | ~~**视频支持**~~ | ~~要能内嵌播放~~ → **已被 D8 覆盖：内嵌能力整体关闭** | 见 D8 |
| D4 | ~~**多设备**~~ | ~~仅这一台电脑~~ → **已被 D5 细化：数据落本地文件系统** | 见 D5 |
| **D5** | **存储位置** | **统一落 `data/` 一个文件夹**（`boards/` `assets/` `library.json` `backups/` `trash/`） | 浏览器只存 UI 偏好；备份 = 拷走 `data/`。**放弃 IndexedDB** |
| **D6** | **界面语言** | **全部默认中文**（外壳自写 + 引擎 zh-CN 补译 91 键） | 引擎语言包硬编码，必须走构建期补丁 |
| **D7** | **字体** | **优先用本地普惠体**（`fonts/` → 子集化 → 三个字重） | 三个字体选项 = 普惠体·常规 / 中黑 / 加粗 |
| **D8** | **联网** | **所有联网入口删除或关闭**，服务器下发 CSP 做硬保证 | 内嵌网页/视频、在线素材库、在线字体、AI、协作全部关闭 |
| **D9** | **点阵模式** | 白板底部铺均匀灰点；**显示与吸附相互独立**，吸附可选「点阵节点 / 对象边缘」 | 引擎同一谓词管两件事，必须打补丁解耦 |

> 这 9 项一确认，架构就收敛了：**一个本地单页应用 + 一个零依赖 Node 本地服务 + 文件系统存储，没有账号、没有同步、没有任何外网请求。**
>
> ⚠️ 本文档 §5.3 与 §5.6 保留的是**第一轮调研时的原始结论**（当时选的是 IndexedDB + 内嵌视频）。
> 最终落地以 D5 / D8 为准，两节末尾均已加「最终决策」标注。

---

## 0. 本文档怎么用

这份文档是**动手写代码之前的需求对齐**。它做三件事：

1. **理清你的需求**（第 1–3 章）——把你散在聊天里的话，翻译成可验收的条目；
2. **讲清 Excalidraw 的底牌**（第 4 章）——哪些能力开箱即用、哪些拿不到、哪些依赖云；
3. **拆成能开工的任务**（第 6–7 章）——里程碑 + 任务清单 + 需要你拍板的问题。

**看文档的建议**：直接跳到 **第 8 章「待你确认的问题」**，那 8 个问题定了，任务拆解就能收敛。

> **关于"逆向"的说明**：Excalidraw 是 MIT 开源、源码完整，所以本次**没有使用 REA 技能**（该技能自身的规则也写明："完整源码仓库的常规分析请用普通工具，不要用 REA"）。我直接读了它的源码与 npm 包定义。REA 适合的是**没有源码**的闭源目标——比如将来你想抄 Miro / FigJam 的某个交互，那时才轮到它上场。

---

## ★ 重点需求详析（本轮强调）

### R1 · 自由放置堆叠图片 —— **最高优先级**

**结论：Excalidraw 原生全覆盖，零额外开发。** 这条不是风险项，是白送的。

| 你要的能力 | 支持 | 实证位置 |
|---|---|---|
| 截图**粘贴**进去 | ✅ `Ctrl+V` | 内置剪贴板处理 |
| **拖拽**图片文件导入 | ✅ 拖放 | 内置 |
| 自由调整**位置** | ✅ 拖拽 | 内置 |
| **调整层级（z 序）** | ✅ 4 个动作 + 快捷键 | `actions/actionZindex.tsx` |
| **调整透明度** | ✅ 属性面板滑块 | `actions/actionProperties.tsx` → `actionChangeOpacity` |
| 缩放 / 旋转 | ✅ | 内置 |

**层级快捷键**（源码 `actions/shortcuts.ts`）：

| 操作 | 快捷键 |
|---|---|
| 上移一层 bringForward | `Ctrl/Cmd + ]` |
| 下移一层 sendBackward | `Ctrl/Cmd + [` |
| 置于顶层 bringToFront | `Ctrl/Cmd + Shift + ]` |
| 置于底层 sendToBack | `Ctrl/Cmd + Shift + [` |

**透明度**：选中元素 → 属性面板 → Opacity 滑块（0–100%）。新元素默认值存在 `appState.currentItemOpacity`。

**我们要额外做的**（**可选**增强，不是必须）：
- 图片选中时浮出"快速透明度"滑块，省得去属性面板找 → T2.8
- "适应原始尺寸 / 铺满"一键
- 图片卡片描边 + 阴影，做出 Milanote 那种"卡片感"

---

### R2 · 多白板并行工作 —— **第二优先级**

#### ⚠️ 先澄清一个概念混淆（很重要）

你把 `.excalidraw` 理解成了"工作文件"——**不是**。这俩是两回事：

| | 内部工作数据 | `.excalidraw` 文件 |
|---|---|---|
| 存在哪 | **IndexedDB**（浏览器内部） | 你硬盘上的一个文件 |
| 何时使用 | **时时刻刻**，编辑自动存 | 只在**导出 / 导入 / 备份**时 |
| 格式 | IndexedDB 记录 | JSON |
| 你平时会看到吗 | ❌ 看不到，也不用管 | ✅ 只有导出时才生成 |

> **一句话**：你开 50 个白板，就是 IndexedDB 里 **50 条记录**，**跟 `.excalidraw` 文件毫无关系**。`.excalidraw` 只是"打包带走 / 存档"用的容器。
> 所以"开很多白板"这件事**不产生任何文件管理负担**——这正是纯本地架构的好处。

#### 你要的"同时开几个白板工作"，两种形态

**形态 A · 多浏览器标签页**（建议先做）

- 每个白板一个 URL：`/board/<id>`
- 列表页点开 → 当前标签；**「在新标签页打开」**（或 `Ctrl+点击`）→ 新标签
- ✅ 浏览器原生行为，实现最简单
- ✅ 各标签独立，互不干扰
- ⚠️ 需要处理跨标签数据同步（见下）

**形态 B · 单标签页分屏**

- 一个页面里左右 / 网格摆多个白板，各自独立滚动缩放
- ✅ 对照参考方便，不用来回切标签
- ⚠️ 多个 `<Excalidraw/>` 实例同时跑，**内存和性能开销明显更大**
- ⚠️ 需要自己做实例隔离、分屏布局、各自独立的 `excalidrawAPI` 引用
- 工作量显著更大

**建议**：**A 为主，B 作为后续增强**。先做到"Ctrl+点击在新标签打开、多个白板同时编辑"，跑顺了再考虑加分屏。

#### ⚠️ 必须处理的工程问题：同一白板开两个标签

浏览器多标签**共享同一个 IndexedDB**。如果同一个白板在两个标签里同时编辑 → **后保存的覆盖先保存的，会丢数据**。

处理方案（按成本排序）：

| 方案 | 做法 | 评价 |
|---|---|---|
| **1. 只读保护** | 检测到该白板已在别处打开 → 提示"已在另一标签打开"，本标签转只读 | ✅ **推荐**，最简单可靠 |
| 2. BroadcastChannel 实时互推 | 两标签实时同步变更 | ⚠️ 复杂，接近做协作，违背"不做协作"的原则 |
| 3. 不管 | — | ❌ 会丢数据 |

**跨标签列表同步**：在标签 A 新建白板，标签 B 的列表要能刷出来 → 用 `BroadcastChannel`（或 `storage` 事件）广播"列表变了"，很轻量。

> **→ 需要你选**：见 §8 Q9。

---

## ★ 第二轮需求（中文化 / 字体 / 点阵 / 离线）—— 已落地

第一轮把"能用"跑通了，第二轮解决的是"用起来是自己的"。四条需求，全部已实现并实测。

### N1 · 全中文界面（D6）

**需求原话**：「我要求我这个白板的所有功能和文字全部都默认是中文」，
「右上角有个 library 个人素材库的部分点开全是英文我不知道那是啥」。

| 层 | 处理 |
|---|---|
| 应用外壳（侧边栏 / 顶栏 / 菜单 / 错误提示） | 本来就是自写中文 |
| 引擎 UI | `<Excalidraw langCode="zh-CN">` |
| 引擎 zh-CN **缺失的 91 个键** | 构建期补丁合并 `src/i18n/zh-CN.extra.json` |
| 素材库文案 | 含在上述 91 键内，已全中文 |

> **为什么必须打补丁**：引擎的语言包加载表硬编码在压缩后的模块作用域里，
> 运行时没有任何 API 可以注入或替换。缺键时引擎会**静默**回退到英文（不报错），
> 所以只能构建期补。

### N2 · 本地普惠体优先（D7）

**需求原话**：「我希望能优先选用 `D:/Coding/WhiteBoard/fonts` 中的字体，而不是直接抄 excalidraw 的字体」。

| 步骤 | 做法 |
|---|---|
| 子集化 | `npm run build:fonts` → fontTools → `public/fonts/puhuiti/{regular,medium,bold}.woff2`（各约 3.8 MB） |
| 别名 | `font-map.json` + 服务器 `/fonts/*` 路由 + Vite dev 中间件：引擎请求的任何字体家族都改写到普惠体 |
| 槽位 | 补丁 `patchFontSlots` 把三个字体槽位改绑到单分片家族（原绑定含 209 分片的 Xiaolai 中文回退） |
| 展示 | 三个字体选项 = **普惠体·常规 / 中黑 / 加粗** |

> **取舍已确认**：接受"三槽位改绑单分片字体"这一处最小补丁。
> 代价是选「手绘体」也渲染成普惠体（只差字重）——换来中文与英文观感统一、且完全离线。

### N3 · 点阵模式（D9）

**需求原话**：「我还希望白板有个点阵模式，开启点阵模式的话，就会在白板最底下出现一些隔一段的均匀灰色点阵，像那种笔记纸一样的」。

| 子需求 | 实现 |
|---|---|
| 白板**最底下**的均匀灰点 | 外壳自绘 `.wb-dotgrid` 层（`radial-gradient`），引擎画布背景设透明，点阵在最底层 |
| 像笔记纸 | 默认间距 20px，浅色 `#c9c9c9` / 深色 `#3d3d3d` |
| **吸附可选**（用户补充） | 视图菜单三选一：**关闭 / 点阵节点 / 对象边缘** |
| 间距可选（用户补充） | 小 16 / 中 20 / 大 28 |

> **关键工程点**：引擎用**同一个谓词**同时决定「画不画网格」和「要不要吸附」。
> 要"只显示点阵、不要引擎虚线网格"就必然要打补丁（`patchGridRender`）——
> 只把渲染那一处换成 `false`，`getEffectiveGridSize()` 的吸附能力原样保留。

### N4 · 联网入口全部关闭 + 离线硬保证（D8）

**需求原话**：「找出所有需要联网的入口全部先做删除关闭处理」。

| 入口 | 处理 |
|---|---|
| 素材库「浏览」（在线素材市场） | 隐藏 |
| 字体下拉（在线下载字体） | 隐藏 |
| 嵌入网页 / 视频工具 | 隐藏；粘贴 embed 链接显示"已禁用"占位块 |
| AI 功能 | 关闭 |
| 协作 / 分享 | 关闭 |
| 引擎的**字体 CDN 兜底** | 补丁 `patchFontFallback` 从源头删除 |

**硬保证（双保险）**：

1. **源头**：补丁删掉引擎的 esm.sh 兜底 URL。实测删之前每次开白板会发 **230 个外网请求**。
2. **浏览器层**：服务器对 HTML 响应下发 CSP —— `default-src 'self'`、`connect-src 'self'`、
   `font-src 'self' data:`、`frame-src 'none'`、`script-src 'self'`（**不含** `unsafe-eval`）。

**验收证据**（`npm run verify:browser`，Edge headless + CDP 采集真实流量）：

| 指标 | 结果 |
|---|---|
| 外网请求 | **0** |
| 远端字体请求 | **0** |
| 控制台 error / warning | **0** |
| 引擎 FontFace 里的外部 URL | **0** |

### N5 · 素材库（附带）

**需求原话**：「素材库的基本功能不变，只做汉化，联网入口剔除」，
存储改为「`data/library.json`」。

- 功能不变：画布选中 → 加入素材库；素材库拖回画布。
- 已汉化；「浏览在线素材库」入口已移除。
- 存储从浏览器内置存储迁到 `data/library.json`，写前备份 `data/backups/library.json`。

---

## ★ 第三轮需求（主题语义 / 命令面板 / 图片体积 / 应用标志 / 转正式版）—— 已落地

**需求原话**：

> 「第一个还是深浅色主题的含义改了…第二个是左上角 command 命令面板没有内容…第三是现在拖进去
> 图片限制 4mb 太小了…第四是现在请在功能实现的角度严格参考 https://github.com/excalidraw/excalidraw
> 的实现和汉化排查一遍功能实现，并且记录版本…第四，我想要这个应用的 logo 是 `ZhaDaOBoard.svg`
> 用作 exe 的标志和网页内的小标志。全部排查完了之后可以把右上角的版本回退给撤了，我们按正式版迭代了。」
>
> 补充：「windows 所用的图标放在了 `favicon_multi.ico` 继续封装 release，注意，**我只需要 windows 能运行，无需适配其他系统**。」

对应决策：

| # | 决策项 | 结论 | 备注 |
|---|---|---|---|
| **D10** | **深浅色主题语义** | 外壳与引擎的**两个主题入口必须双向同步** | 原来两边各切各的：外壳只切 `[data-theme]`、引擎只切 `appState.theme`，而画布底色由外壳给 → 点引擎菜单"看起来没反应"。修法是**判跳变**而不是判差异（引擎收到 `updateScene` 会先回报旧值） |
| **D11** | **左上角 command 命令面板** | 补上内容 | 面板原先打开是空的 |
| **D12** | **图片体积上限** | 放宽（原 4 MB 太小） | 服务器 `imageLimit` 已放大；仍受 `bodyLimit` 总闸约束 |
| **D13** | **应用标志** | 用 `ZhaDaOBoard.svg` 作 exe 图标 + 网页标志；**exe 图标源改用用户提供的 `favicon_multi.ico`** | 网页图标 `public/logo.svg`（文字转轮廓）+ `public/favicon.ico`；exe 图标 `assets/app.ico`（6 档 16/32/48/64/128/256，全 PNG）；侧边栏品牌标记 `.wb-brand-mark` |
| **D14** | **撤掉版本回退入口** | 顶栏「⋯ → 恢复上一版本」按钮**移除**，此后按正式版迭代 | 服务端 `POST /api/boards/:id/restore` 与 `data/backups/` 快照**保留**（有测试覆盖），改由人工从 `data/backups/<id>.json` 取回 |
| **D15** | **平台范围** | **只做 Windows**，不适配其他系统 | 构建链路（PE 图标注入、`.lnk` 写入）全部按 Windows 实现，不引入跨平台抽象 |

**功能与汉化对标**：逐项对照官方 `0.18.1` 的功能与汉化差异，记录在 `prototype/docs/EXCALIDRAW-PARITY.md`。

**正式版封装**：`npm run release` → `D:\Coding\WhiteBoard\release\`
（`WhiteBoard.exe` + `启动白板.bat` + `白板.lnk` + `使用说明.md` + `THIRD-PARTY-NOTICES.md`）。

---

## 1. 背景与动机

| 项目 | 情况 |
|---|---|
| 现在用什么 | Milanote（视觉化白板，放灵感 / 截图 / 链接 / 脑暴） |
| 卡在哪 | 免费版上限 **100 张卡片（笔记+图片+链接合计）+ 10 个文件上传**，稍微铺开就爆 |
| 想要什么 | 一个**自己用、纯本地、不限数量**的无限白板 |
| 为什么选 Excalidraw | 它的功能集（无限画布、手绘风、图形/箭头/文字/自由涂鸦/图片、导出 PNG/SVG/JSON）**恰好匹配**，而且是 MIT 开源 |

**一句话目标**：把 Excalidraw 当"引擎"嵌进一个自己写的壳里，补上**多白板管理**和**本地持久化**，做一个自用、离线、不限量的视觉白板。

---

## 2. 需求梳理

### 2.1 目标（要什么）

| # | 需求 | 说明 |
|---|---|---|
| G1 | **无限画布** | 可无限延伸、缩放、平移 |
| G2 | **多白板** | 想开几个开几个，可命名、可切换、可删除、可复制 |
| G3 | **纯本地存储** | 所有数据（含图片）存本机，不依赖任何服务器 |
| G4 | **基础编辑** | 放图片、涂鸦（自由画）、敲字、画框、连线/箭头 |
| G5 | **放"卡片"** | 文字块、框体、截图，像 Milanote 那样摆放 |
| G6 | **链接 / 视频** | 能贴链接、能嵌视频 |
| G7 | **导入 / 复制** | 白板之间可复制内容；可导入外部白板文件 |
| G8 | **导出** | 导出图片 / PDF / 白板文件 / （可选）分享链接 |

### 2.2 非目标（明确不要，避免范围膨胀）

- ❌ **多人协作 / 实时同步**——单人自用，不碰 CRDT、不碰 WebSocket
- ❌ **账号系统 / 云盘**——没有登录、没有后端
- ❌ **端到端加密分享**——那是 excalidraw.com 依赖 Firebase 做的，纯本地做不了等价物
- ❌ **AI 功能 / 文字转图**——Excalidraw 有 mermaid/TTD 插件，但不在本次范围
- ❌ **移动端 / 触摸手势专门优化**——先保证桌面浏览器好用
- ❌ **插件市场 / 第三方扩展**

### 2.3 典型使用场景（验收时按这个走）

1. **灵感收集**：新建白板「项目 A 灵感」，把 5 张截图拖进去，散落摆放，旁边写文字批注，画箭头把它们连起来。
2. **脑暴过程**：一张白板上涂鸦画流程图，用框体圈出重点，用箭头标注因果。
3. **素材归档**：开一个新白板专放某个主题的链接和截图，命名成「参考素材 · 交互设计」。
4. **导出交付**：把某块内容框选，导出成 PNG 发微信；或整板导出 PDF 存档。
5. **复用**：把「周报模板」白板复制一份，改改内容变成这周的。

---

## 3. 功能需求清单（分级）

> **P0 = MVP 必须有**｜**P1 = 第一版之后尽快有**｜**P2 = 锦上添花 / 待定**

### 3.1 白板管理（**我们自己写的核心**）

| ID | 功能 | 级别 |
|---|---|---|
| B1 | 白板列表页（缩略图 + 名称 + 更新时间） | P0 |
| B2 | 新建 / 重命名 / 删除白板 | P0 |
| B3 | 复制（另存为）白板 | P0 |
| B4 | 打开 / 返回列表 | P0 |
| B5 | 自动保存（编辑时防抖落盘） | P0 |
| B6 | 缩略图自动生成 | P1 |
| B7 | 文件夹 / 标签 / 搜索 | P1 |
| B8 | 白板模板（新建时选模板） | P2 |

### 3.2 画布编辑（**Excalidraw 开箱提供**）

| ID | 功能 | 级别 | 来源 |
|---|---|---|---|
| C1 | 无限画布、缩放、平移 | P0 | Excalidraw 内置 |
| C2 | 矩形 / 椭圆 / 菱形 / 箭头 / 直线 | P0 | 内置 |
| C3 | 自由涂鸦（freedraw）+ 橡皮 | P0 | 内置 |
| C4 | 文字 | P0 | 内置 |
| C5 | 图片（拖拽 / 粘贴 / 上传） | P0 | 内置 |
| C6 | 箭头绑定 / 标签箭头 | P0 | 内置 |
| C7 | 撤销 / 重做 | P0 | 内置 |
| C8 | 分组 / 对齐 / 层级 | P0 | 内置 |
| C9 | Frame（画框，可命名分组） | P1 | 内置 |
| C10 | 素材库（自定义图形库） | P1 | 内置 |
| C11 | 深色模式 | P1 | 内置 |
| C12 | 中文字体优化（手绘体对中文支持弱） | P1 | **需定制** |

### 3.3 卡片 / 媒体（**Milanote 的差异点，部分需定制**）

| ID | 功能 | 级别 | 可行性 |
|---|---|---|---|
| M1 | 文字块、框体、截图摆放 | **P0** | ✅ Excalidraw 原生 |
| **M1a** | **截图粘贴 / 拖放导入** | **P0** | ✅ 内置 |
| **M1b** | **图片层级调整**（上移/下移/置顶/置底） | **P0** | ✅ 内置 + 快捷键 |
| **M1c** | **图片透明度调整** | **P0** | ✅ 内置属性面板滑块 |
| M2 | 贴**超链接**（点击跳转） | P0 | ✅ 元素自带 `link` 字段 |
| M3 | 贴**网页/视频链接**并内嵌预览 | **P1** | ⚠️ 白名单制，**B站不在内**，见 §5.6 |
| M4 | 放**本地视频文件** | P2 | ❌ 原生不支持，需自写元素 |
| M5 | 拖入本地文件（PDF/视频）作为附件卡片 | P2 | ❌ 需自写 |

### 3.4 导入 / 导出

| ID | 功能 | 级别 | 可行性 |
|---|---|---|---|
| E1 | 导出 PNG | P0 | ✅ `exportToBlob` |
| E2 | 导出 SVG | P0 | ✅ `exportToSvg` |
| E3 | 导出 `.excalidraw` 文件（可再导入） | P0 | ✅ `serializeAsJSON` |
| E4 | 导入 `.excalidraw` / 图片 | P0 | ✅ `loadFromBlob` |
| E5 | 导出 PDF | P1 | ⚠️ 需自己接 jsPDF |
| E6 | 复制到剪贴板（粘贴到别处） | P1 | ✅ `exportToClipboard` |
| E7 | **分享链接** | P2 | ❌ 见 §5.5，纯本地做不了等价物 |

---

## 4. Excalidraw 底牌分析（源码实证）

### 4.1 项目概况

| 项 | 值 |
|---|---|
| 许可 | **MIT**（可自由 fork / 商用 / 闭源改造） |
| 语言 | TypeScript |
| Star | 13.4 万 |
| npm 包 | `@excalidraw/excalidraw`，当前 **v0.18.1** |
| peer 依赖 | React `^17 \|\| ^18 \|\| ^19` |
| 仓库结构 | monorepo：`packages/`（引擎）+ `excalidraw-app/`（excalidraw.com 这个网站） |

**关键区分**：
- `packages/excalidraw` → 发布成 npm 包，**是"引擎"**，我们用它；
- `excalidraw-app/` → excalidraw.com 这个**网站**，里面有多人协作、Firebase、分享链接——**这些是网站层的东西，不是引擎能力**。

`packages/` 下的子包：
```
common/  element/  excalidraw/  math/  utils/
fractional-indexing/  laser-pointer/
```

### 4.2 数据模型（核心中的核心）

Excalidraw 的一切都是 **element**，基类 `_ExcalidrawElementBase`（源码：`packages/element/src/types.ts`）：

```ts
{
  id, x, y,                       // 位置
  strokeColor, backgroundColor,   // 颜色
  fillStyle, strokeWidth, strokeStyle, roughness,  // 手绘风参数
  roundness, opacity, width, height, angle,
  seed,                           // 固定随机种子，保证手绘形状每次渲染一致
  version, versionNonce,          // 版本号 + 随机数，用于合并/撤销
  index,                          // 分数索引，决定 z 序（便于协作时插入）
  isDeleted, groupIds, frameId,   // 软删除 / 分组 / 归属画框
  boundElements,                  // 被绑定到我的元素（箭头绑定）
  updated, created, link, locked, customData,
}
```

**元素类型**（`type` 字段取值）：

```
rectangle  椭圆 ellipse  菱形 diamond  选择框 selection
箭头 arrow  肘形箭头 elbowArrow  直线 line  自由涂鸦 freedraw
文字 text  便签 stickynote
图片 image  画框 frame  magicframe
嵌入 embeddable  内联框架 iframe
```

**对我们的启示**：
- `link` 字段 → **M2（贴链接）原生支持**；
- `embeddable` / `iframe` 类型 → **M3（嵌视频/网页）有原生通道**，但有白名单限制；
- `image` 元素的数据存在一个 `files` 字典里（`{id, mimeType, dataURL, created}`），**图片本体和元素是分开存的**——这直接影响我们的存储设计。

### 4.3 我们能直接用的 API

**组件**（`<Excalidraw />`，可自定义槽位）：
```
MainMenu  Sidebar  Footer  WelcomeScreen  LiveCollaborationTrigger
```

**导出的工具函数**（源码：`packages/excalidraw/index.ts`）：
```ts
exportToCanvas / exportToBlob / exportToSvg / exportToClipboard
serializeAsJSON / loadFromBlob / loadFromJSON / getDataURL
restore / restoreElements / restoreAppState / restoreLibraryItems
convertToExcalidrawElements / zoomToFitBounds / getCommonBounds
mutateElement / newElementWith
```
→ **E1/E2/E3/E4/E6 全部开箱即用。**

**组件 props（关键几个）**：
- `initialData={{ elements, appState, files }}` —— 传入初始场景
- `onChange={(elements, appState, files) => …}` —— 每次变更回调（我们在这存盘）
- `excalidrawAPI={(api) => …}` —— 拿到命令式句柄（`getSceneElements()` / `updateScene()` / `getAppState()` / `scrollToContent()`）
- `UIOptions` —— 裁剪掉不需要的 UI（比如协作按钮）

**CSS 导入**（v0.18 起）：
```ts
import "@excalidraw/excalidraw/index.css";
```

### 4.4 拿不到 / 有坑的地方

| 能力 | 结论 | 说明 |
|---|---|---|
| **本地视频文件** | ❌ 不支持 | `image` 元素只吃图片（mimeType 限 image/*）。放 mp4 需要自己写自定义元素 + 自定义渲染，**工作量大** |
| **任意网页内嵌** | ⚠️ 白名单制 | `embeddable` 只认固定几家 provider，**B站不在内**，详见 §5.6 |
| **链接分享** | ❌ 做不了等价物 | 见 §5.5 |
| **多白板管理** | ❌ 引擎没有 | **引擎只管"一个场景"，多白板完全是外层的事**——这正是我们的主要工作量 |
| **PDF 导出** | ❌ 需自接 | 引擎只出 PNG/SVG，PDF 要自己接 jsPDF |
| **中文字体** | ⚠️ 一般 | 手绘体（Virgil）只有拉丁字形，中文走系统字体，观感不统一 |

### 4.5 excalidraw.com 网站层里"依赖云"的部分（我们不要）

| 功能 | 依赖 |
|---|---|
| 实时协作 | WebSocket + Firebase |
| 分享链接 | 加密后上传到 Firebase 存 key |
| 云端保存 | Firebase Storage |
| 版本历史 | 后端 |

**这些全部排除**，我们只拿引擎。

### 4.6 Milanote 的差异（我们真正要补的"感觉"）

Excalidraw 是**画图工具**，Milanote 是**信息摆放板**。差别：

| 维度 | Excalidraw | Milanote | 我们要的 |
|---|---|---|---|
| 心智 | 画示意图 | 摆卡片 | 偏 Milanote |
| 文字 | 画布上的文字元素 | 独立"笔记卡" | 用框体 + 文字近似 |
| 图片 | 画布上的图元素 | 可缩放的图片卡 | Excalidraw 够用 |
| 链接 | 元素带 link | 自动抓标题/封面的链接卡 | **P1：链接卡（可后续做）** |
| 视频 | 只能嵌链接 | 可嵌 | 见 §4.4 |

> **结论**：不用从零造。**Excalidraw 的"框体 + 文字 + 图片 + 箭头"已经能覆盖 80% 的 Milanote 用法**。剩下的 20%（链接卡、视频、卡片感）是 P1/P2，可迭代补。

---

## 5. 关键技术决策

### 5.1 集成方式：**当库用**（推荐）

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **A. 当库用** `@excalidraw/excalidraw` | 上手快；上游更新能直接吃；维护成本低 | 改不了内核 | ✅ **推荐** |
| B. Fork 整个仓库 | 能改内核 | 要跟进上游、构建复杂、体积大 | 除非要改渲染，否则不用 |
| C. 从零写（canvas + roughjs） | 完全自主 | 工作量 ×10 | ❌ 不推荐 |

**理由**：你的需求里没有一项必须改内核。多白板管理、本地存储、导出——**全都能在壳里做**。先用 A 跑起来，真遇到瓶颈再局部 fork。

### 5.2 多白板管理：**自建外层**（本项目的核心工作量）

Excalidraw 引擎只负责"渲染一个场景"。所以我们要自己写：

```
应用外壳（我们写）
├── 白板列表页         ← 列出所有白板
├── 白板元数据层       ← id/名称/时间/缩略图
├── 路由               ← 列表 ↔ 编辑器
├── 场景加载/保存      ← 把元素灌给 Excalidraw，再把改动存回来
└── 导出/导入          ← 包一层 UI
        ↓
   <Excalidraw />      ← 引擎（不碰）
```

### 5.3 本地存储：**IndexedDB**（⚠️ 已被 D5 覆盖，见本节末尾）

| 存储 | 容量 | 适合 | 用不用 |
|---|---|---|---|
| localStorage | ~5 MB | 小配置 | ⚠️ 只存 UI 偏好 |
| **IndexedDB** | 几百 MB ~ GB | **场景 + 图片 blob** | ⚠️ 原计划主力，**已放弃** |
| File System Access API | 无限（用户目录） | 手动"保存到文件夹" | P2 可选 |

> **实证**：excalidraw.com 自己就是这么干的——`excalidraw-app/data/LocalData.ts` 用 `idb-keyval` 把元素和图片存 IndexedDB，只把 appState 存 localStorage。**我们照抄这个思路。**

推荐库：`idb-keyval`（极简，5KB）或 `Dexie`（要复杂查询时）。

**存储设计草案**：
```
IndexedDB: whiteboard
├── store "boards"    → { id, name, createdAt, updatedAt, thumbnail, elementCount }
├── store "scenes"    → { boardId, elements, appState }     // 按白板 id 存
└── store "files"     → { fileId, boardId, mimeType, dataURL/blob }  // 图片本体
```

> ### ✅ 最终决策（D5）：改为**本地文件系统 `data/` 文件夹**，不用 IndexedDB
>
> **为什么改**：用户明确要求"所有直接读取的文件尽量都放在同一个文件夹里，方便用户管理"。
> IndexedDB 里的数据用户**看不见、摸不着、也备份不了**——这对一个"自己的东西"是硬伤。
>
> **最终落地形态**：
> ```
> data/
> ├── boards/<id>.json      每块白板（含 scene 与 assets 索引）
> ├── assets/<fileId>.<ext> 图片本体
> ├── library.json          个人素材库
> ├── backups/              每次写前留的上一版（含 library.json）
> └── trash/                软删除
> ```
>
> **代价与补偿**：文件写入必须自己做原子性（临时文件 → `fsync` → `rename`），
> 并发要自己做租约与版本 CAS。这些都已实现，见 `README.md`「持久化与并发安全」。
> 收益是：**备份 = 拷走一个文件夹**。

### 5.4 导出方案

| 格式 | 实现 |
|---|---|
| PNG | `exportToBlob({ elements, appState, files })` → 下载 |
| SVG | `exportToSvg(...)` |
| `.excalidraw` | `serializeAsJSON(...)` → 存文件（**这就是"白板文件"，可再导入**） |
| PDF | `exportToBlob` 出 PNG → `jsPDF` 塞进 A4/A3 |
| 剪贴板 | `exportToClipboard(...)` |

### 5.5 ⚠️ "分享链接"这一项：需要你重新定义

你说的"导出为特定的链接格式分享"，**在纯本地架构下没有等价物**：

- excalidraw.com 的分享链接 = 把加密后的场景**上传到 Firebase**，链接里带 key。**这需要服务器**，违背"纯本地"。
- 纯本地能做到的"链接"只有这几种：

| 替代方案 | 效果 | 代价 |
|---|---|---|
| **A. 导出 `.excalidraw` 文件** | 发给别人，对方用你的工具/官网打开 | ✅ 零成本，**推荐** |
| **B. 导出单文件 HTML** | 一个 `.html`，双击就能看（只读） | 中（要内联引擎） |
| **C. URL 内嵌场景**（#data=...） | 超链接直接带内容 | ⚠️ 只适合极小场景（URL 长度限制） |
| **D. 真·分享链接** | 和官网一样 | ❌ 需要后端，**违背前提** |

→ **✅ 已确认选 A**：导出 `.excalidraw` 文件。不引入任何后端，保持纯本地。

### 5.6 视频 / 链接（已确认要内嵌播放）⚠️ 重要发现

**源码实证**（`packages/element/src/embeddable.ts`）：Excalidraw 的 `embeddable` 元素**只认一份硬编码白名单**，不是"任意 iframe"。实际支持的 provider：

| ✅ 支持 | ❌ 不支持 |
|---|---|
| **YouTube**（watch / shorts / live / playlist） | **B站 / 哔哩哔哩** ← ⚠️ 不在名单 |
| **Vimeo** | 优酷 / 腾讯视频 / 爱奇艺 |
| **Google Drive 视频链接** | 任意其他网站 |
| Figma / GitHub Gist / Twitter(X) / Reddit / Giphy / Val.town / Microsoft Forms | |
| 裸 `<iframe>` / `<blockquote>` 嵌入代码（通用通道） | |

**这意味着什么**：

- 你的场景如果是贴 **YouTube**，开箱即用 ✅
- 如果是贴 **B站**，**默认不支持** ⚠️。三条变通路径：
  1. **贴裸 iframe 代码**——B站播放页有"嵌入代码"，通用通道 `RE_GENERIC_EMBED` 可能吃得下，**需实测**；
  2. **退化成链接卡**——只贴链接，点击跳浏览器打开（成本最低，但失去"内嵌播放"）；
  3. **自己加 provider**——当库用改不了白名单，要么 fork 引擎，要么**在外层写一个自定义"视频卡"组件**（在画布上叠一层自己的 React 元素，而不是用 Excalidraw 的 embeddable）。

| 需求 | 方案 | 代价 |
|---|---|---|
| 贴一个链接能点开 | 用元素的 `link` 字段 | ✅ 极小 |
| 嵌 **YouTube** 播放 | 用 `embeddable` 元素 | ✅ 开箱即用 |
| 嵌 **B站** 播放 | 实测 iframe 通道 / 外层自定义视频卡 | ⚠️ 中，**待实测确认** |
| 放本地 mp4 播放 | 自写自定义元素 + 自定义渲染层 | ❌ 大，建议 P2 |

> **→ 需要你回答**：你主要贴的是 **YouTube 还是 B站**？（见 §8 Q3'）这决定了这块是"零成本"还是"要动点手脚"。

> ### ✅ 最终决策（D8）：**内嵌能力整体关闭**
>
> 第二轮明确「找出所有需要联网的入口全部先做删除关闭处理」。
> 内嵌网页 / 视频无论走哪个 provider，**本质都是加载外部 iframe**——这与"纯离线"直接冲突。
>
> **落地**：`[data-testid="toolbar-embeddable"]` 已隐藏；粘贴 embed 链接时渲染
> 「嵌入网页已在本工具中禁用」占位块（`renderEmbeddable` 返回占位元素）；
> CSP 额外下发 `frame-src 'none'` / `child-src 'none'` 兜底。
>
> 本节上面的 provider 白名单分析保留，作为**将来若重新开启**时的技术底账。

---

## 6. 架构草案

```
┌─────────────────────────────────────────────────┐
│  应用外壳（我们自己写）                          │
│  ┌───────────────┐   ┌────────────────────────┐ │
│  │  白板列表页    │   │  白板编辑器页          │ │
│  │  BoardList    │←→│  BoardEditor           │ │
│  └───────────────┘   │   ├─ <Excalidraw/>     │ │
│         ↕            │   ├─ 自定义主菜单项     │ │
│  ┌───────────────┐   │   └─ 导出菜单          │ │
│  │  白板仓库层    │   └────────────────────────┘ │
│  │  boardRepo    │              ↕               │
│  └───────────────┘   ┌────────────────────────┐ │
│         ↕            │  场景适配层 useScene    │ │
│  ┌───────────────────────────────────────────┐ │
│  │  IndexedDB（idb-keyval）                   │ │
│  │  boards / scenes / files                   │ │
│  └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
              ↑ 完全不联网
```

**建议目录结构**：
```
whiteboard/
├── src/
│   ├── main.tsx
│   ├── App.tsx                  # 路由：列表 ↔ 编辑器
│   ├── boards/
│   │   ├── BoardList.tsx        # 白板列表页
│   │   ├── BoardCard.tsx        # 单个白板卡片
│   │   └── useBoards.ts         # 白板 CRUD
│   ├── editor/
│   │   ├── BoardEditor.tsx      # 包住 <Excalidraw/>
│   │   ├── useScene.ts          # 场景加载 + 防抖保存
│   │   └── MenuItems.tsx        # 自定义菜单（导出/返回）
│   ├── storage/
│   │   ├── db.ts                # IndexedDB 封装
│   │   ├── boardRepo.ts
│   │   └── fileRepo.ts          # 图片 blob
│   ├── exporter/
│   │   ├── image.ts             # PNG / SVG
│   │   ├── pdf.ts               # PDF
│   │   └── scene.ts             # .excalidraw 文件
│   └── types.ts
├── index.html
├── package.json
└── vite.config.ts
```

**核心数据模型**：
```ts
type Board = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;          // dataURL 缩略图
  elementCount: number;
};

type Scene = {
  boardId: string;
  elements: ExcalidrawElement[];
  appState: Partial<AppState>;
};
```

---

## 7. 任务拆解（里程碑）

### M0 · 骨架跑通
> 目标：本地能起一个页面，Excalidraw 能画、能存、刷新不丢

- [ ] T0.1 初始化 Vite + React + TS 项目
- [ ] T0.2 装 `@excalidraw/excalidraw`，渲染出画布
- [ ] T0.3 接入 `onChange`，场景存 IndexedDB
- [ ] T0.4 启动时从 IndexedDB 恢复场景
- [ ] T0.5 验证：画几笔 → 刷新 → 还在

### M1 · MVP（可用）
> 目标：多白板能管起来，图片能存，导出能用

- [ ] T1.1 白板仓库层（IndexedDB 增删改查）
- [ ] T1.2 白板列表页（卡片 + 缩略图）
- [ ] T1.3 新建 / 重命名 / 删除 / 复制白板
- [ ] T1.4 列表 ↔ 编辑器路由
- [ ] T1.5 多白板场景隔离（各存各的）
- [ ] T1.6 图片存进 IndexedDB files 表，恢复时不丢
- [ ] T1.7 导出 PNG / SVG / `.excalidraw`
- [ ] T1.8 导入 `.excalidraw`
- [ ] T1.9 自定义主菜单：返回列表 / 导出
- [ ] **T1.10 路由 `/board/:id`，支持「在新标签页打开」白板**
- [ ] **T1.11 跨标签白板列表同步（BroadcastChannel）**
- [ ] **T1.12 同一白板重复打开的只读保护**
- [ ] **T1.13 验收图片层级 + 透明度操作（内置功能实测）**

### M2 · 增强
- [ ] T2.1 导出 PDF
- [ ] T2.2 复制到剪贴板
- [ ] T2.3 白板搜索 / 标签
- [ ] T2.4 缩略图自动生成
- [ ] T2.5 中文字体优化
- [ ] T2.6 深色模式跟随系统
- [ ] **T2.7 单标签页分屏（左右并排两个白板）**
- [ ] **T2.8 图片快速透明度浮层**

### M3 · 进阶（按需）
- [ ] T3.1 白板模板
- [ ] T3.2 链接卡（自动抓标题/封面）
- [ ] T3.3 导出单文件 HTML
- [ ] T3.4 本地视频元素（**大工程，先评估**）

---

## 8. 问题清单 ⭐

### 8.1 已确认 ✅

| # | 问题 | 结论 |
|---|---|---|
| Q1 | 运行形态 | **纯网页**（本地服务 + 浏览器） |
| Q2 | 分享方式 | **导出 `.excalidraw` 文件**（不做真链接） |
| Q3 | 视频支持 | **要能内嵌播放** |
| Q4 | 多设备 | **仅这一台电脑** |

### 8.2 还需你拍板

| # | 问题 | 状态 |
|---|---|---|
| **Q3'** | 你主要贴 YouTube 还是 B站？ | ✅ **已作废**——内嵌能力整体关闭（D8），不再区分 provider |
| **Q9** | 多白板并行用哪种形态？ | ✅ **已落地形态 A**（多标签页）：`/#/board/:id` + 租约只读保护 + `BroadcastChannel` 列表同步。形态 B（分屏）仍为 P2 |
| **Q5** | 白板组织？ | ✅ **平铺列表 + 搜索框**；文件夹/标签仍为 P1 |
| **Q6** | 技术栈偏好？ | ✅ Vite + React 18 + TS（strict） |
| **Q7** | 视觉风格？ | ✅ 自写外壳（`DESIGN.md` 方案 A）+ Excalidraw 原生画布 |
| **Q8** | 现在就开工？ | ✅ 已开工并完成两轮 |

### 8.3 第二轮新增（已确认）

| # | 问题 | 结论 |
|---|---|---|
| Q10 | 字体范围 | **三个字体选项 = 三个字重**（普惠体·常规 / 中黑 / 加粗） |
| Q11 | 点阵吸附 | **视觉点阵 + 独立吸附选项**（点阵节点 / 对象边缘 / 关闭） |
| Q12 | 素材库 | **基本功能不变，只做汉化，联网入口剔除** |
| Q13 | 联网入口 | **全部删除或关闭** |
| Q14 | 字体实现 | **接受一处最小补丁**（三槽位改绑单分片字体） |
| Q15 | 素材库存储 | **改存 `data/library.json`** |
| Q16 | 离线硬保证 | **加上**（服务器下发 CSP） |

---

## 9. 附录 · Excalidraw API 速查

```ts
// 组件
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

<Excalidraw
  initialData={{ elements, appState, files }}
  onChange={(elements, appState, files) => saveToIndexedDB(elements, appState, files)}
  excalidrawAPI={(api) => setApi(api)}
  UIOptions={{ canvasActions: { loadScene: false } }}  // 按需裁剪
/>

// 导出
exportToBlob({ elements, appState, files, mimeType: "image/png" })
exportToSvg({ elements, appState, files })
exportToClipboard({ elements, appState, files, type: "png" })
serializeAsJSON({ elements, appState, files }, "local")

// 导入
loadFromBlob(blob, localAppState, localElements)

// 恢复（从本地存档）
restore({ elements, appState, files }, localAppState, localElements)
restoreElements(elements)
restoreAppState(appState, localAppState)

// 命令式
api.getSceneElements()  api.getAppState()  api.updateScene({ elements })
api.scrollToContent()   api.getFiles()
```

**源码定位速查**（本次实证位置）：
| 内容 | 路径 |
|---|---|
| 元素数据模型 | `packages/element/src/types.ts` |
| 公共导出 API | `packages/excalidraw/index.ts` |
| 导出实现 | `packages/excalidraw/data/` + `packages/utils/src/export.ts` |
| 本地持久化 | `excalidraw-app/data/LocalData.ts`（用 idb-keyval） |
| 文件/图片管理 | `excalidraw-app/data/FileManager.ts` |
| 分享链接（云端） | `excalidraw-app/share/ShareDialog.tsx` |

---

*本文档 v1.2：第一轮 4 项关键决策 + 第二轮 5 项决策（D5–D9）全部落地并实测。
当前实现状态与验收命令见 `prototype/README.md`；代码审查门禁见 `prototype/CODE_REVIEW.md`。*
