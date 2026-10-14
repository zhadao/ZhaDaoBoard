<div align="center">
  <img src="ZhaDaOBoard.svg" alt="ZhaDaoBoard" width="180" />

# ZhaDaoBoard · 白板

**一个纯本地、离线、不限量的视觉白板工具**

以 [Excalidraw](https://github.com/excalidraw/excalidraw) 为画布引擎，套一层自写的壳，
补上多白板管理、本地文件持久化、全中文界面与点阵背景。

零外网请求 · 数据只落在自己硬盘的一个 `data/` 文件夹里 · 双击 `WhiteBoard.exe` 即用

</div>

---

## 这是什么

对标 Milanote 的个人本地白板（免费版卡片有上限，铺开就爆）。
目标是把 Excalidraw 当"引擎"嵌进一个自己写的壳里，做一个**自用、离线、不限量**的视觉白板：

- 无限画布 + 手绘风图形 / 箭头 / 文字 / 自由涂鸦 / 图片（Excalidraw 原生能力，**不裁剪**）
- 想开几块白板就开几块，可命名 / 搜索 / 复制 / 软删除
- 所有数据（含图片）落本机文件系统，**备份 = 拷走一个文件夹**
- 界面全中文，优先使用本地普惠体，白板底部可铺笔记纸质感的点阵
- 所有联网入口删除或关闭，服务器下发 CSP 做硬保证

**只做 Windows**（`WhiteBoard.exe` 内置前端资源，不需要装 Node）。

## 特性一览

| 模块 | 说明 |
|---|---|
| 画布引擎 | `@excalidraw/excalidraw@0.18.1`（MIT），**当库用、未 fork** |
| 多白板 | 侧边栏列表 + 搜索；新建 / 重命名 / 复制 / 软删除；多标签页并行，同板加租约只读保护 |
| 本地持久化 | 原子写（临时文件 → fsync → rename）、保存前留备份、`revision` 版本 CAS 防覆盖 |
| 全中文 | 外壳自写中文 + 引擎 `zh-CN` + 构建期补译引擎缺失的 91 个键 |
| 字体 | 阿里巴巴普惠体（常规 / 中黑 / 加粗），引擎字体家族请求被别名到本地普惠体 |
| 点阵背景 | 外壳自绘点阵层，「显示」与「吸附」解耦（不吸附 / 吸附点阵节点 / 吸附对象边缘） |
| 离线 | 摘掉引擎字体 CDN 兜底 + CSP `default-src 'self'`，实测开板外网请求 **0** |
| 导出 / 导入 | PNG / SVG / `.excalidraw` |
| 素材库 | 引擎原生素材库能力汉化 + 改存 `data/library.json` |

## 快速开始

### 方式 1 · 双击启动（日常使用）

在 [Releases](https://github.com/zhadao/ZhaDaoBoard/releases) 下载 `WhiteBoard.exe`（或自行 `npm run release` 生成），双击：

- 起一个只监听 `127.0.0.1` 的本地服务并自动打开浏览器，**不需要装 Node、不需要联网**
- 关掉控制台窗口即停止服务；数据已经写进磁盘，不会丢

> 首次运行 Windows 可能提示"未知发布者"（exe 未做代码签名）——选择"更多信息 → 仍要运行"即可。

### 方式 2 · 从源码开发

```bash
# Node 需 v22
cd prototype
npm install
npm run dev        # 同时拉起：API 服务器 :4173 + Vite :5173
                   # 打开 http://localhost:5173
```

提交前请跑门禁（lint → 类型 → 测试 → 构建 → 离线自检 → 浏览器实测）：

```bash
npm run check
```

打包正式版（产出到仓库根的 `release/`）：

```bash
npm run release    # build:exe + 封装正式版（exe + bat + 说明 + 许可 + 快捷方式）
npm run dist       # build:exe + 封装「可复制分享」发行版（不带快捷方式）
```

完整命令清单、架构图、REST API、目录结构、数据模型见 **[prototype/README.md](prototype/README.md)**。

## 数据目录

所有业务数据只落一个文件夹（exe 运行时即 exe 旁边的 `data/`）：

```
data/
├── boards/<id>.json   每块白板（元信息 + 场景 + 图片索引）
├── assets/<fileId>.<ext>  图片本体
├── library.json       个人素材库
├── prefs.json         界面偏好（主题 / 点阵 / 吸附）
├── backups/           每次保存前的上一版快照（误改可回滚）
└── trash/             删除的白板（软删除，可直接捞回）
```

浏览器 `localStorage` 只存纯界面偏好，不含任何白板内容。`dist/`、`public/fonts/` 是程序资源，不是用户数据。

## 技术栈

| 项 | 选型 |
|---|---|
| 构建 | Vite 5 |
| 框架 | React 18 + TypeScript（strict，禁用 `any`） |
| 画布引擎 | `@excalidraw/excalidraw@0.18.1`（MIT） |
| 本地服务器 | **零依赖** Node（`prototype/server/server.cjs`，仅用内置模块） |
| 持久化 | 本地文件系统 `data/`（原子写 JSON + 二进制） |
| 路由 | `react-router-dom` · `HashRouter` |
| UI | 纯手写 CSS（颜色只来自 `tokens.css`） |

```
┌──────────────────────────┐        ┌───────────────────────────────┐
│  前端（Vite / 静态产物）  │        │  本地 Node 服务器             │
│  :5173（dev）            │  HTTP  │  :4173                        │
│  · 侧边栏 + 大画布        │ ─────► │  · 托管 dist/（exe 下为内嵌）  │
│  · <Excalidraw/>         │        │  · REST /api/boards           │
│  · storage/boardRepo.ts  │        │  · 二进制 /assets/:fileId     │
│  · editor/saveQueue.ts   │        │  · 原子落盘 data/             │
└──────────────────────────┘        └───────────────────────────────┘
```

## 与上游 Excalidraw 的关系

本项目**当库使用** `@excalidraw/excalidraw`（精确锁 `0.18.1`），**没有 fork** 上游源码仓库。
定制面（字体、点阵、本地多白板、去联网）全部落在 UI 外壳层；
必须改动引擎内部的 5 处，统一收敛到一处**构建期补丁**
（`prototype/scripts/excalidraw-patch.mjs`，策略为「特征串锚定，找不到就抛错」）：

| # | 补丁 | 作用 |
|---|---|---|
| 1 | `patchZhCnLocale` | 把 zh-CN 缺失的 91 个键合并进语言包模块 |
| 2 | `patchFontSlots` | 三个字体槽位改绑到单分片家族，中文走普惠体 |
| 3 | `patchGridRender` | 关掉引擎虚线网格绘制，保留吸附能力 |
| 4 | `patchFontFallback` | 删掉 `FontFaceUrls` 里的 esm.sh 兜底 URL |
| 5 | `patchFileSizeLimit` | 单张图片上限 4 MiB → 64 MiB |

逐项的功能与汉化差异排查记录见 **[prototype/docs/EXCALIDRAW-PARITY.md](prototype/docs/EXCALIDRAW-PARITY.md)**
（覆盖命令面板、快捷键、绘图工具、主题、字体、点阵、去联网、图片上限、主菜单等），
刷新基线的命令为 `npm run audit:upstream`。

> 说明：上游是 MIT 开源的完整源码仓库，因此本项目的差异分析使用的是常规源码阅读，
> **未使用 REA（reverse-engineer-anything）**——该技能的规则本身也要求：完整源码仓库的常规分析请用普通工具。

## 许可与来源

### 本项目自身

本项目以 **MIT License** 授权，全文见 [LICENSE](LICENSE)。
可自由使用、修改、分发（含商用），只需保留版权声明与许可全文。

> 如果你想改成 `AGPL-3.0`（强制"改了并对外提供服务就必须开源"）或「保留所有权利」，
> 只需替换根目录的 `LICENSE` 文件并同步本节文字即可。

### 第三方组件（随分发必须附带许可全文）

本程序把 Excalidraw 的编译产物、React、react-router-dom 及若干字体**内嵌进了 exe**，
属于 MIT 所说的 "copies or substantial portions of the Software"，
因此必须随分发保留版权声明与许可全文。

完整清单与全文见 **[prototype/THIRD-PARTY-NOTICES.md](prototype/THIRD-PARTY-NOTICES.md)**。

| 组件 | 版本 | 许可 | 分发形态 |
|---|---|---|---|
| [Excalidraw](https://github.com/excalidraw/excalidraw) | `0.18.1`（当库使用，未 fork） | MIT | 编译产物内嵌进 exe |
| React / React DOM | 18 | MIT | 编译产物内嵌进 exe |
| react-router-dom | 6 | MIT | 编译产物内嵌进 exe |
| 阿里巴巴普惠体 | — | 阿里官方免费商用授权 | 子集化 woff2 内嵌进 exe |
| 引擎自带字体（Virgil / Excalifont / Nunito / Cascadia / ComicShanns / Lilita / Liberation / Assistant） | — | 各自的 OFL / 开源字体许可 | `public/fonts/` 随 exe 内嵌 |

> **合规待办（发布前完成）**：`THIRD-PARTY-NOTICES.md` 第 2.2 节列出了上游字体许可全文的补齐清单。
> 已实测 Excalidraw 官方 `v0.18.1` 的 `packages/excalidraw/fonts/` 下没有任何 license 文件，
> 需从各字体上游项目单独取回后追加。

## 仓库结构

```
.
├── LICENSE                     MIT 许可
├── README.md                   本文件
├── REQUIREMENTS.md             需求对齐与任务拆解（决策记录 D1–D15）
├── DESIGN.md                   设计系统
├── ZhaDaOBoard.svg / .webp     应用标志
├── favicon_multi.ico           exe 图标源（多尺寸 ICO）
└── prototype/                  ★ 全部代码
    ├── src/                    前端（外壳 + 编辑器 + 存储 + 样式）
    ├── server/server.cjs       零依赖本地服务器（REST + 原子存储 + 租约）
    ├── scripts/                构建 / 打包 / 门禁 / 构建期补丁
    ├── tests/                  单元与集成测试
    ├── docs/                   上游对标记录
    ├── public/                 网页标志与内置字体
    └── README.md               详细文档
```

## 已知边界

- 不做 PDF 导出、复制到剪贴板、文件夹 / 标签（属后续里程碑）
- 服务仅监听 `127.0.0.1`，不对外网开放
- 未做代码签名，Windows 首次运行需手动放行
- 页面被强制结束进程时，最后一次尚未落盘的改动（500ms 防抖窗口内）可能丢失

---

<div align="center">
基于 <a href="https://github.com/excalidraw/excalidraw">Excalidraw</a>（MIT）构建 · 本项目以 <a href="LICENSE">MIT</a> 授权
</div>
