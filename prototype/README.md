# 白板 · 本地无限画布

> 个人本地白板工具（**仅 Windows**）。Excalidraw 当引擎嵌进自写的壳里，补上**多白板管理**、
> **本地持久化**、**全中文界面**、**本地普惠体**与**点阵背景**。  
> 设计系统：`DESIGN.md` v1.0（方案 A · Linear + Notion 留白 + Excalidraw 血统）。  
> 代码审查标准与流程：`CODE_REVIEW.md`。第三方组件与许可声明：`THIRD-PARTY-NOTICES.md`。

**一句话卖点**：全程离线、零外网请求、数据只落在自己硬盘的一个 `data/` 文件夹里。

> **正式版怎么拿**：`npm run release` → 产出 `D:\Coding\WhiteBoard\release\`
> （`WhiteBoard.exe` + `白板.lnk` + `启动白板.bat` + `使用说明.md` + `THIRD-PARTY-NOTICES.md`）。
> 双击 exe 或快捷方式即可，不需要装 Node、不需要联网。

---

## 快速开始

### 方式 1 · 双击启动（日常使用，推荐）

在文件夹里双击 **`WhiteBoard.exe`**：

- 弹出一个控制台窗口（显示访问地址与数据目录），浏览器自动打开白板
- **关掉这个窗口即停止服务**；数据已经写进磁盘，不会丢
- 前端资源已内嵌在 exe 里，**不需要安装 Node，也不依赖 `dist/` 目录**

> 首次运行 Windows 可能提示"未知发布者"（exe 由 Node 注入生成，未做代码签名）——  
> 选择"更多信息 → 仍要运行"即可。它只监听 `127.0.0.1`，不对外网开放。

### 方式 2 · 开发（前端热更新 + 本地 API）

```bash
# Node 需 v22（本项目在 v22.22.2 下验证）
npm install
npm run dev        # 同时拉起：API 服务器 :4173 + Vite :5173
                   # 打开 http://localhost:5173
```

> `npm run dev` = `node scripts/dev.mjs`，**两个进程必须一起跑**，它会等后端 health 就绪再起 Vite。  
> 只跑 Vite（`npm run dev:vite`）时后端没人监听，新建/保存会失败——  
> 界面此时会在侧边栏顶部显示「本地服务未连接」横幅，而不是静默无反应。

### 其他命令

```bash
npm run check           # 门禁：lint → 类型 → 测试 → 构建 → 离线自检 → 浏览器实测（提交前必须全绿）
npm run lint            # 项目约定自检（禁止 any / 裸色值 / 通配 CORS 等）
npm run typecheck       # tsc --noEmit
npm run test            # 服务端数据安全 + 保存队列 + 构建期补丁测试
npm run build           # 产出 dist/
npm run build:fonts     # 重新子集化 public/fonts/puhuiti（改了 fonts/ 源字体才需要）
npm run build:icon      # 由 public/logo.svg 生成 build/icon.ico（回退图标源，需本机浏览器内核）
npm run verify:offline  # 静态自检：入口全同源、字体全本地、CSP 已下发
npm run verify:browser  # 真实浏览器实测：零外网请求 + 控制台干净（无浏览器时自动跳过）
npm run verify:exe      # 端到端验证 WhiteBoard.exe：图标资源 → 启动 → 存取 → 重启 → 清理
npm run serve           # build + 启动服务器（浏览器自动打开）
npm run build:exe       # 构建单文件 WhiteBoard.exe（内置前端资源 + 应用图标）
npm run release         # build:exe + 封装「本机自用」正式版到 ../release（含快捷方式）
npm run dist            # build:exe + 封装「可复制分享」发行版到 ../ZhaDaoBoard（不含快捷方式）
npm run server          # 只启动 API 服务器（不重新构建）
```

> **`release/` 与 `ZhaDaoBoard/` 别搞混**：
>
> | | `release/` | `ZhaDaoBoard/` |
> |---|---|---|
> | 用途 | **本机自用**的正式版 | **发给别人 / 存档**的发行版 |
> | 快捷方式 | 有 `白板.lnk` | **没有**（见下） |
> | 内容 | exe + bat + 说明 + 许可 + 快捷方式 | exe + bat + 说明 + 许可 |
>
> **为什么发行版不带快捷方式**：`.lnk` 里存的是**绝对路径**（IDList 逐级目录项 +
> `LinkInfo.LocalBasePath`），整目录复制到别处或换机器后就会指向原位置而失效 ——
> 接收方看到的就是「只有一个打不开的快捷方式，没有软件本体」。
> 所以发行版只放本体，接收方双击 exe 即可；要固定到桌面/任务栏，自己右键
> 「发送到 → 桌面快捷方式」，由 Windows 按当时真实路径生成。

> **构建被「批量删除保护」拦下时**：`npm run build:exe` 会先让 Vite 清空 `dist/`，
> 某些受管环境会在这一步抛 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`。  
> 正确做法是**只对这一次命令**关掉保护，不要改 `vite.config.ts`（关掉 `emptyOutDir`
> 会让 `dist/` 越积越多，是本项目明令禁止的反模式，见 `CODE_REVIEW.md` §9）：
>
> ```bash
> CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run build:exe
> ```

---

## 数据目录（重要）

**所有业务数据都只落在一个文件夹里：`data/`**（exe 运行时即 exe 旁边的 `data/`）。

```
data/
├── boards/            每块白板一个 JSON 文件
│   └── <id>.json      { id, name, createdAt, updatedAt, thumbnail, elementCount, revision, scene, assets }
├── assets/            图片本体（不把 base64 塞进 board json）
│   └── <fileId>.<ext>
├── library.json       个人素材库（右上角「素材库」里的自定义图形）
├── backups/           每次保存前自动留下的上一份有效快照（误改可回滚）
│   ├── <id>.json
│   └── library.json   素材库的上一版
└── trash/             删除的白板移到这里，不是直接抹掉
    └── <id>.<时间戳>.<随机>.json
```

- **备份 / 迁移**：整个拷走 `data/` 即可；还原时拷回来。
- **回滚单块白板**：`data/backups/<id>.json` 永远是**上一次保存前**的快照。  
  把它复制回 `data/boards/<id>.json`（覆盖前先备份现文件），重启程序即生效。  
  服务器的 `POST /api/boards/:id/restore` 也能做同样的事（自动化/脚本用）。  
  > 编辑器顶栏曾经有个「⋯ → 恢复上一版本」按钮，已按需求撤掉——界面不再暴露这个入口，  
  > 但**备份快照照旧每次保存都写**，所以兜底能力没有削弱，只是改成人工取回。
- **删除**：界面里删 → 进 `data/trash/`；确认不要了可以手动清空该目录。
- **素材库**：改动后写 `data/library.json`，上一版留在 `data/backups/library.json`。  
  它只存在本地文件里，**不再往浏览器存储或云端同步**。
- 浏览器 `localStorage` 只存**纯界面偏好**（`wb-theme`、`wb-sidebar-collapsed`、  
  点阵开关与吸附模式），不含任何白板内容。删掉只会重置外观，不会丢数据。

> `dist/`、`public/fonts/` 是程序资源，不是用户数据。

---

## 技术栈

| 项     | 选型                                       |
| ----- | ---------------------------------------- |
| 构建    | Vite 5                                   |
| 框架    | React 18 + TypeScript（strict，禁用 `any`）   |
| 画布引擎  | `@excalidraw/excalidraw@0.18.1`（MIT）     |
| 本地服务器 | **零依赖** Node（`server/server.cjs`，仅用内置模块） |
| 持久化   | 本地文件系统 `data/`（原子写 JSON + 二进制）           |
| 路由    | `react-router-dom` · `HashRouter`        |
| UI    | 纯手写 CSS（颜色只来自 `tokens.css`）              |

> 无云端、无登录、无协作、无 CDN 依赖。

---

## 架构

```
┌──────────────────────────┐        ┌───────────────────────────────┐
│  前端（Vite / 静态产物）  │        │  本地 Node 服务器             │
│  :5173（dev）            │  HTTP  │  :4173                        │
│  · 240px 侧边栏 + 大画布  │ ─────► │  · 托管 dist/（exe 下为内嵌）  │
│  · <Excalidraw/>         │        │  · REST /api/boards           │
│  · storage/boardRepo.ts  │        │  · 二进制 /assets/:fileId     │
│  · editor/saveQueue.ts   │        │  · 原子落盘 data/             │
└──────────────────────────┘        └───────────────────────────────┘
```

- **dev**：Vite 把 `/api`、`/assets` 代理到 `:4173`（`changeOrigin: true`，因为服务器校验 Host）。
- **生产 / exe**：服务器同时托管前端与 API，**同源**——开发与生产走完全相同的请求路径。

### REST API

| 方法     | 路径                          | 说明                                                         |
| ------ | --------------------------- | ---------------------------------------------------------- |
| GET    | `/api/health`               | 应用标识、数据目录、端口、限额（启动器据此确认连的是本实例）                             |
| GET    | `/api/boards`               | 元数据列表（按 updatedAt 倒序，不含 scene）                             |
| POST   | `/api/boards`               | 新建                                                         |
| GET    | `/api/boards/:id`           | 单块（含 scene / assets / revision）                            |
| PUT    | `/api/boards/:id`           | 只改元数据：`name` / `thumbnail` / `elementCount`                |
| DELETE | `/api/boards/:id`           | 软删除到 `data/trash/`（body 需 `{ owner }`）                     |
| POST   | `/api/boards/:id/duplicate` | 复制（共享图片不复制文件）                                              |
| POST   | `/api/boards/:id/lease`     | 取得/续期编辑租约（45s），他人持有时 409                                   |
| DELETE | `/api/boards/:id/lease`     | 释放租约（body 需 `{ owner }`）                                   |
| PUT    | `/api/boards/:id/scene`     | **原子保存场景 + 新图片**（`owner` / `revision` / `scene` / `files`） |
| POST   | `/api/boards/:id/restore`   | 从 `data/backups/` 恢复上一版本                                   |
| GET    | `/api/library`              | 读个人素材库（返回 `{ libraryItems }`，文件不存在时返回空数组）                  |
| PUT    | `/api/library`              | 整份覆盖素材库（写前自动备份到 `data/backups/library.json`）               |
| GET    | `/assets/:fileId`           | 读取图片本体                                                     |
| GET    | `/fonts/*`                  | 字体别名路由：把引擎请求的字体家族映射到本地普惠体（见下）                              |

**约定**：写操作必须 `content-type: application/json`；服务端对未知字段返回 400；  
场景与图片必须在**同一次** `/scene` 请求里提交，避免出现"场景更新了但图片没到"的半残状态。

---

## 功能

### 整体布局：小侧边栏 + 大画布

- 左侧 **240px 侧边栏**（资源管理），可一键折叠到 0
- 右侧主区占满剩余空间，**无限画布是绝对主体**
- 空工作区时主区显示空状态（含新建入口）

### 侧边栏（资源管理）

- 白板列表（缩略图 + 名称 + 相对更新时间），当前白板高亮
- 顶部：标题 + 白板计数 + **「新建」文字按钮**（无图标，避免尺寸/对齐问题）
- 搜索框过滤
- 每条操作：打开 / 在新标签页打开 / 重命名（就地）/ 复制 / 删除（就地确认）
- 底部：浅 / 深主题切换
- **后端不可用时**：顶部出现连接失败横幅 + 「重试连接」按钮（恢复后自动消失）

### 编辑器（主区）`/#/board/:id`

- `<Excalidraw/>` 占满主区（顶栏之下）
- 44px 极薄顶栏：侧边栏折叠 / 白板名（点击就地重命名）/ 保存状态 / 主题 / 导出菜单 / 更多菜单
- 导出 PNG、SVG、`.excalidraw`；导入 `.excalidraw`；在新标签页打开
- 保存状态点：保存中（灰）→ **已保存（绿，仅在服务端确认后）**；失败（红）可点击重试；只读（说明原因）

### 持久化与并发安全（核心）

- 白板元数据 + 场景 → `data/boards/<id>.json`；图片 → `data/assets/<fileId>.<ext>`
- `onChange` **500ms 防抖自动保存**，保存队列串行合并，**只在后端确认后**才标记已保存
- **原子写**：临时文件 → `fsync` → `rename`，写入中断不会损坏原文件
- **保存前留备份** → `data/backups/<id>.json`，可一键回滚
- **同一白板多标签互斥**：编辑前取租约；拿不到就转**只读**并说明原因，未保存内容仍可导出
- **版本 CAS**：场景提交带 `revision`，不匹配返回 409，**不会静默覆盖**别人的修改
- 跨标签页列表同步（`BroadcastChannel`）
- 保存失败 / 只读时保留未保存快照，支持导出带走

### 主题

- 外壳 `--wb-*` 令牌走 `[data-theme="dark"]` 覆盖；与 Excalidraw `theme` 同步

---

## 本地化改造（中文 · 字体 · 点阵 · 离线）

这一层全部围绕「**这是一台只属于自己的、不联网的白板**」来做。四件事都需要改动引擎内部，  
所以统一收敛到一处构建期补丁：`scripts/excalidraw-patch.mjs`。

### 1 · 全中文界面

- 应用外壳（侧边栏 / 顶栏 / 菜单 / 错误提示）本来就是中文。
- 引擎部分通过 `<Excalidraw langCode="zh-CN">` 切到中文，但 **0.18.1 的 zh-CN 语言包缺 91 个键**，  
  缺键会静默回退英文。补丁 `patchZhCnLocale` 在构建期把 `src/i18n/zh-CN.extra.json`  
  深度合并进语言包模块，补掉这 91 条（含素材库、工具提示、菜单项）。
- 语言包加载表被硬编码在引擎模块作用域里，**运行时无法注入**——这是必须走构建期补丁的原因。

### 2 · 本地普惠体

- 源字体放在仓库根的 `fonts/`，`npm run build:fonts` 用 fontTools 子集化出三个字重到  
  `public/fonts/puhuiti/{regular,medium,bold}.woff2`（各约 3.8 MB）。
- `font-map.json` 记录「引擎字体家族 → 本地字重」的映射，`src/fonts.ts` 在前端侧预加载。
- **引擎请求的字体家族被别名到普惠体**：引擎按 `./fonts/<Family>/<file>.woff2` 取字体，  
  服务器（`/fonts/*` 路由）与 Vite dev 中间件都会按 `font-map.json` 改写路径，  
  于是不论选哪个字体都命中本地普惠体。三个字体选项对应三个字重：  
  **普惠体·常规 / 中黑 / 加粗**。
- 补丁 `patchFontSlots` 把引擎默认的三个字体槽位（Excalifont / Nunito / Comic Shanns）  
  改绑到单分片的 Virgil / Helvetica / Cascadia。默认那两个家族的 `unicode-range` 不含中文，  
  中文会掉到 209 分片的 Xiaolai 回退——既慢又浪费，改绑后中文走普惠体。

### 3 · 点阵背景 + 吸附

- 引擎自带的虚线网格用**同一个谓词**同时决定「画不画网格」和「要不要吸附」，无法用 props 解耦。  
  补丁 `patchGridRender` 只把「渲染」那一处换成常量 `false`，**保留 `getEffectiveGridSize()` 的吸附能力**。
- 点阵由外壳自绘（`src/editor/DotGrid.tsx`）：`radial-gradient` 圆点铺在引擎画布**底下**，  
  引擎画布背景设成透明，视觉上点阵在「最底下」。
- 视图菜单（`src/editor/ViewMenu`）提供三项独立控制：
  - **点阵背景** 开关
  - **吸附**：关闭 / 吸附点阵节点 / 吸附对象边缘
  - **点阵间距**：小（16）/ 中（20）/ 大（28）
- 点阵的「显示」与「吸附」互不影响——这正是要打补丁的原因。

### 4 · 纯离线硬保证

**双保险**：补丁从源头摘掉外部请求，CSP 在浏览器层再拦一道。

- 补丁 `patchFontFallback` 删掉引擎 `FontFaceUrls.createUrls()` 里的 esm.sh 兜底 URL。  
  引擎原本会在本地 URL 之后**无条件**追加一个 `https://esm.sh/...` 的备用源，  
  字体子集化失败时真的会去联网取它——实测每次开白板会打出 **230 个外网请求**。
- 服务器对所有 HTML 响应下发 CSP：
  ```
  default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self';
  media-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none';
  frame-src 'none'; child-src 'none'; base-uri 'self'; form-action 'none'
  ```
- 联网入口全部**关闭或隐藏**：素材库「浏览」（在线素材市场）、字体下拉（在线下载字体）、  
  嵌入网页工具、AI 功能、协作/分享入口。
- 实测结果（`npm run verify:browser`，Edge headless + CDP 采集真实流量）：
  | 指标                   | 结果    |
  | -------------------- | ----- |
  | 外网请求                 | **0** |
  | 远端字体请求               | **0** |
  | 控制台 error / warning  | **0** |
  | 引擎 FontFace 里的外部 URL | **0** |

### 素材库

- 只做汉化 + 本地化，**基本功能不变**：画布选中图形 → 加入素材库；素材库拖回画布。
- 存储从浏览器内置存储改为 **`data/library.json`**，跟着 `data/` 一起备份/迁移。
- 「浏览在线素材库」入口已移除（那是唯一需要联网的部分）。

---

## 目录结构

```
prototype/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts             # base/define/proxy（/api、/assets → :4173）
├── sea-config.json            # SEA 打包模板
├── CODE_REVIEW.md             # ★ 代码审查标准与流程
├── THIRD-PARTY-NOTICES.md     # ★ 第三方组件与许可声明（分发合规，必须随 exe 一起给）
├── WhiteBoard.exe             # npm run build:exe 产出（双击启动，已内嵌前端 + 图标）
├── 启动白板.bat                # 双击启动器（降级路径：改用 node 跑服务器）；CRLF 行尾
├── assets/
│   └── app.ico                # ★ exe 图标源（6 档全 PNG）；由 favicon_multi.ico 而来
├── build/
│   └── icon.ico               # 回退图标源（npm run build:icon 由 public/logo.svg 生成）
├── data/                      # ★ 所有用户数据（boards / assets / backups / trash）
├── dist/                      # 构建产物（含 static/ 与 fonts/）
├── docs/
│   └── EXCALIDRAW-PARITY.md   # 对标官方 0.18.1 的功能与汉化差异排查记录
├── public/
│   ├── logo.svg               # 网页标志（文字已转轮廓，零字体依赖）
│   ├── favicon.ico            # 网页位图图标（与 exe 同一份）
│   └── fonts/                 # 内置 Excalidraw 字体（离线，不走 CDN）
├── server/
│   └── server.cjs             # 零依赖本地服务器（托管前端 + REST + 原子存储 + 租约）
├── tests/
│   ├── server.test.mjs        # 数据安全 / 租约 / 备份 / 请求校验
│   ├── saveQueue.test.mjs     # 保存队列语义
│   ├── shortcut.test.mjs      # .lnk 字节格式（含非 ASCII 路径必须报错）
│   └── excalidraw-patch.test.mjs  # 构建期补丁锚点
├── scripts/
│   ├── dev.mjs                # npm run dev：等后端 health 后一起拉起
│   ├── build-exe.mjs          # 构建 dist + 生成 SEA 配置 + 注入
│   ├── make-exe.mjs           # SEA 注入（产出 WhiteBoard.exe）
│   ├── set-exe-icon.mjs       # 用 resedit 写 PE 图标资源（纯 JS，不 spawn 外部进程）
│   ├── make-shortcut.mjs      # 手写 .lnk 二进制（MS-SHLLINK，含 LinkTargetIDList）
│   ├── package-release.mjs    # 封装「本机自用」正式版（exe + bat + 说明 + 许可 + 快捷方式）
│   ├── package-dist.mjs       # 封装「可复制分享」发行版（不带快捷方式，见下）
│   ├── build-icon.mjs         # 由 logo.svg 光栅化回退图标（需本机浏览器内核）
│   ├── build-fonts.mjs        # 子集化普惠体
│   ├── excalidraw-patch.mjs   # 构建期补丁：语言包 / 字体槽位 / 网格谓词
│   ├── lint.mjs               # 项目约定自检（含 bat-crlf / version-sync）
│   ├── check.mjs              # 门禁：lint → tsc → test → build → 离线自检 → 浏览器实测
│   ├── verify-exe.mjs         # 端到端验证打包好的 exe（含手写 PE 解析读图标）
│   ├── verify-offline.mjs     # 静态自检：入口全同源、字体全本地、CSP 已下发
│   ├── verify-browser.mjs     # 真实浏览器实测：零外网请求 + 控制台干净
│   └── audit-upstream.mjs     # 拉官方仓库对照，生成功能/汉化差异
└── src/
    ├── main.tsx
    ├── App.tsx                # 外壳：侧边栏 + 主区；HashRouter 路由
    ├── api.ts                 # 同源请求 + 超时 + 中文错误映射
    ├── theme.ts               # 浅/深主题（跟随系统 + localStorage）
    ├── viewPrefs.ts           # 点阵开关与吸附模式（localStorage 只存 UI 偏好）
    ├── icons.tsx              # 内联 SVG 线性图标（无 emoji）
    ├── types.ts               # 引擎公开类型的统一出口（禁止 any）
    ├── utils.ts               # 相对时间 / 带 hash 的 URL
    ├── styles/
    │   ├── tokens.css         # DESIGN.md 的 --wb-* 令牌 + [data-theme=dark]
    │   └── app.css            # 外壳样式
    ├── storage/
    │   └── boardRepo.ts       # HTTP 客户端（CRUD + 租约 + 场景/图片 + 跨标签广播）
    ├── boards/
    │   ├── Sidebar.tsx        # 左侧资源管理侧边栏
    │   ├── BoardRow.tsx       # 侧边栏中的单条白板
    │   └── useBoards.ts       # 列表状态与 CRUD（含错误状态与乐观回滚）
    └── editor/
        ├── BoardEditor.tsx    # 包住 <Excalidraw/>
        ├── useScene.ts        # 场景加载 + 租约 + 防抖保存
        ├── saveQueue.ts       # 单写入者保存队列（合并/失败保留/只读降级）
        ├── TopBar.tsx         # 44px 顶栏 + 导出/更多菜单
        └── exporter.ts        # PNG / SVG / .excalidraw 导出与文件选择
```

---

## 应用标志与图标

标志源是 `ZhaDaOBoard.svg`（「Zha」字标 + 拼图几何），网页与 exe 共用同一套几何。

| 用途 | 文件 | 说明 |
|------|------|------|
| **exe 图标（Windows）** | `assets/app.ico` | 6 档：16 / 32 / 48 / 64 / 128 / 256 px，全部 PNG 压缩（35 KB） |
| 网页图标（矢量） | `public/logo.svg` | 源 SVG 的**文字已转轮廓路径**，不依赖本机装没装 Adieu 字体 |
| 网页图标（位图） | `public/favicon.ico` | 与 exe 同一份，供 Windows 任务栏/收藏夹取多尺寸位图 |
| 侧边栏品牌标记 | `public/logo.svg` → `.wb-brand-mark` | 见 `src/boards/Sidebar.tsx` |
| 回退图标源 | `build/icon.ico` | `npm run build:icon` 由 `logo.svg` 光栅化（7 档，BMP+PNG 混合） |

**构建链路**（`scripts/`）：

```
public/logo.svg ──(npm run build:icon，需本机浏览器内核)──► build/icon.ico ┐
                                                                          ├─► resolveIconSource()
assets/app.ico（正式图标源，手工提供）──────────────────────────────────────┘        │
                                                                                   ▼
                    make-exe.mjs：注入 SEA 载荷 ──► set-exe-icon.mjs（resedit，纯 JS）
                                                                                   │
                                                                                   ▼
                                          WhiteBoard.exe 的 PE 资源 RT_GROUP_ICON #1（语言 1033）
```

- **图标源优先级**：`assets/app.ico` → `build/icon.ico`，两者都缺时构建会打警告并跳过（不静默）。
  构建与验证共用 `resolveIconSource()`，避免「exe 里装的是 A、验证脚本按 B 断言」。
- **为什么图标要在 SEA 注入之后写**：顺序反过来会让 postject 报
  `Relocation corrupted: BlockSize is out of bound the binary's virtual size`
  —— 它按自己的规则解析重定位表，读不了 pe-library 重新生成后的布局。
- **为什么用纯 JS 写 PE 资源**：原方案是 PowerShell P/Invoke `UpdateResource`，
  但本机宿主会挡掉「从 Node 里 spawn `powershell.exe`」（`EBUSY`），
  于是构建必然在最后一步失败、只能人工补跑。换成 `resedit` 后一次跑完。
- **验证**：`npm run verify:exe` 里用手写 PE 解析器（**刻意不复用 resedit**，
  否则「写错也读得出来」的假绿是必然的）读回 `RT_GROUP_ICON`，逐档与图标源比对。

---

## 数据模型

```ts
type Board = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string | null; // dataURL（小图，直接存在 json 里）
  elementCount: number;
  revision: number;          // 乐观并发控制：每次场景保存 +1
};

// data/boards/<id>.json 额外包含：
//   scene:  { elements, appState }
//   assets: [{ id, mimeType, ext }]   ← 指向 data/assets/<id>.<ext>
```

---

## 开发约定

- **提交前必须 `npm run check` 全绿**（lint → 类型 → 测试 → 构建）。
- 动存储层或服务端后，重跑 `node scripts/verify-exe.mjs`（会验证 exe 重启后数据仍在）。
- 详细审查清单、分级与流程见 **`CODE_REVIEW.md`**。

---

## 未实现 / 已知边界

- 不做 PDF 导出、复制到剪贴板、文件夹/标签（属 M2）
- 不做单标签页分屏、图片快速透明度浮层（M2）
- 视频/链接内嵌依赖 Excalidraw 白名单（B 站不在内，见 `REQUIREMENTS.md` §5.6）
- 服务仅监听 `127.0.0.1`，不对外网开放
- 页面**强制关闭**（任务管理器结束进程）时，最后一次尚未落盘的改动可能丢失——
  保存是 500ms 防抖，正常关闭窗口会先 flush
- `WhiteBoard.exe` 未做代码签名，Windows 首次运行需手动放行

---

## 许可与来源（上架 GitHub 前必读）

### 本项目自身

**目前仓库里没有 `LICENSE` 文件** —— 也就是说默认「保留所有权利」。
上架前请自己挑一个，常见三种：

| 选择 | 适合的场景 |
|------|-----------|
| `MIT` | 想让别人随便用、随便改，只保留署名。与「MIT 的 Excalidraw」生态最一致 |
| `AGPL-3.0` | 想强制「改了并对外提供服务就必须开源」。Excalidraw 自己用的是这个 |
| 不加（保留所有权利） | 只想公开源码给人看，不授权使用/分发 |

> 注意：**你选什么都可以，但必须做下面那件事。**

### 第三方：必须随分发附带许可全文

本程序把 Excalidraw 的编译产物**内嵌进了 exe**（SEA 打包），
这属于 MIT 所说的 "copies or substantial portions of the Software"，
所以 MIT 要求**随分发保留版权声明与许可全文**。字体同理。

- 完整清单与全文见 **`THIRD-PARTY-NOTICES.md`**。
- `npm run release` 会把它一起复制进正式版目录，跟着 exe 走。
- 上架 GitHub 时把这个文件放在仓库根目录即可满足要求。

### 依赖一览

| 组件 | 版本 | 许可 | 分发形态 |
|------|------|------|---------|
| [Excalidraw](https://github.com/excalidraw/excalidraw) | `0.18.1`（**当库使用，未 fork**） | MIT | 编译产物内嵌进 exe |
| React / React DOM | 18 | MIT | 编译产物内嵌进 exe |
| react-router-dom | 6 | MIT | 编译产物内嵌进 exe |
| 阿里巴巴普惠体 | — | 阿里官方免费商用授权 | 子集化 woff2 内嵌进 exe |
| 引擎自带字体（Virgil / Excalifont / Nunito / Cascadia / ComicShanns / Lilita / Liberation / Assistant / Xiaolai） | — | 各自的 OFL / 开源字体许可 | `public/fonts/` 随 exe 内嵌 |

**引擎版本锁定与排查记录**：见 `docs/EXCALIDRAW-PARITY.md`（逐项对照官方 0.18.1 的功能与汉化差异）。
