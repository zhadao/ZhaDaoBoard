# 第三方组件与许可声明

本程序（白板 · 本地无限画布）把前端资源与字体**内嵌进 `WhiteBoard.exe`** 分发，
属于许可证里所说的 "copies or substantial portions of the Software"。
因此本文件随分发一起提供，列出所有第三方组件及其许可。

> 这份文件是**合规产物**，不是说明书。改动依赖、换版本、加字体时都要回来同步。
> 上架 GitHub 时放在仓库根目录即可满足「保留版权声明与许可全文」的要求。

---

## 1. 引擎与运行时（MIT，已核实）

### 1.1 Excalidraw `0.18.1`

- 来源：<https://github.com/excalidraw/excalidraw>
- 使用方式：**当 npm 库使用，未 fork、未改动其源码仓库**（构建期只做语言包与字体槽位的注入补丁，见 `scripts/excalidraw-patch.mjs`）
- 说明：npm 包里**没有附带 `LICENSE` 文件**（已核实 `node_modules/@excalidraw/excalidraw/` 下无许可文件），
  以下全文取自官方仓库 `v0.18.1` 标签。

```
MIT License

Copyright (c) 2020 Excalidraw

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 1.2 React / React DOM `18.3.1`

```
MIT License

Copyright (c) Facebook, Inc. and its affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 1.3 react-router-dom `6.x`

```
MIT License

Copyright (c) React Training LLC 2015-2019
Copyright (c) Remix Software Inc. 2020-2021

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

> 构建期工具（Vite / TypeScript / postject / resedit）只在打包时使用，
> **不进入分发的 exe**，故不在此列。它们的许可可在 `node_modules/<pkg>/LICENSE*` 查到。

---

## 2. 字体

### 2.1 阿里巴巴普惠体（本项目的界面中文字体）

- 文件：`fonts/`（源字体，TTF/OTF）→ `npm run build:fonts` 子集化 → `public/fonts/puhuiti/*.woff2`
- 授权：阿里巴巴官方发布，声明**免费商用**。授权条款以官方页面为准：
  <https://fonts.alibabagroup.com/>
- 用途：界面 UI 文本 + 画布中文渲染（引擎请求的字体家族被别名到它，见 `server/server.cjs` 的 `/fonts/*` 路由）

### 2.2 引擎自带字体（随 Excalidraw 0.18.1 分发）

这些字体在 `public/fonts/<Family>/` 下，被内嵌进 exe。

| 家族 | 目录 | 来源 |
|------|------|------|
| Virgil | `Virgil/` | Excalidraw 手绘体（Ellinor Rapp） |
| Excalifont | `Excalifont/` | Excalidraw 官方手绘体 |
| Nunito | `Nunito/` | Google Fonts |
| Cascadia Code | `Cascadia/` | Microsoft |
| Comic Shanns | `ComicShanns/` | Shannon Miwa |
| Lilita One | `Lilita/` | Google Fonts |
| Liberation Sans | `Liberation/` | Liberation Fonts 项目 |
| Assistant | `Assistant/` | Google Fonts |
| Xiaolai（小赖字体） | `Xiaolai/` | 落霞孤鹜 |
| Helvetica / Emoji | （未随本仓库分发） | 引擎内置回退槽位 |

> ⚠️ **上架前唯一未闭环的合规项**
>
> 已实测：Excalidraw 官方仓库 `v0.18.1` 的 `packages/excalidraw/fonts/` 下
> **没有任何 license / ofl / copying 文件**，npm 包里也没有。
> 也就是说「字体许可全文」需要**从各字体的原始上游项目单独取回**并附在本文件里。
>
> 待办（发布前做完，逐项打勾）：
>
> - [ ] 从各字体上游仓库取 `OFL.txt` / `LICENSE` 全文，追加到本节
> - [ ] 若某个字体查不到可商用授权，则从 `public/fonts/` 移除该家族并重跑 `npm run build:exe`
>
> 本程序**只把这些字体当作引擎的显示字体使用，未做任何修改**（普惠体是子集化，属格式转换）。

---

## 3. 本项目自身

本仓库**没有 `LICENSE` 文件**，即默认「保留所有权利」。
作者需在上架前自行选定（MIT / AGPL-3.0 / 保留所有权利，权衡见 `README.md` 的「许可与来源」一节）。

---

*本文件随 `npm run release` 一起复制进正式版目录，跟着 exe 走。*
