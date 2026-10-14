# DESIGN.md — 个人本地白板工具 · 应用外壳设计系统

> **版本** v1.0 · **作者** 设计系统专家 彩格调（Cai）
> **阶段** Phase 2 · 设计系统选型 + 设计令牌
> **下游** 原型构建师（筑原型）→ 直接落地为 CSS 变量
> **调性锚点** Phase 1 结论 B ——「干净克制的中性外壳，画布为主角」

---

## 0. 一句话设计宪法

> **外壳不是主角，是画布的"安静画框"。**
> 所有 token 与 Excalidraw 的 UI 变量**同源对齐**——列表页与画布看起来必须是**同一个产品**，而不是"Excalidraw 塞进了一个后台模板"。

**三条不可违背的铁律：**

1. **同源优先**：外壳 token = Excalidraw 变量的镜像 + 少量扩展。不另起体系、不引入第二套中性色。
2. **唯一强调色**：indigo/violet（Excalidraw 的 `--color-primary`）。除此之外**不许有第二个彩色**（语义色除外，且只在危险/成功语义下出现）。
3. **外壳字体 = 系统无衬线（含中文）**；Virgil 手写体**只允许出现在画布内**，外壳任何角落都不出现。

---

## 1. Visual Theme（视觉主题）

- **Philosophy**：像一块好的取景框——它存在，但你不该注意到它。
- **Direction**：`minimal, neutral, quiet, desktop-utility`
- **Personality**：安静、利落、有品味、不喧哗（面向对"土味后台模板"敏感的中文开发者/创作者）
- **Reference**：Linear 的克制精度 × Notion 的柔和留白，色彩与圆角最终服从 Excalidraw 引擎变量

**视觉方向定位（5 大学派坐标）**：
主坐标 = **Modern Minimal（现代极简）**，副调 = **Soft Warm 的"柔和度"**（只取大留白 + 柔和圆角 + 低对比，**不取**其暖色/渐变/圆润字体）。
明确排除：Tech Utility（太暗太密）、Brutalist（太吵）、Editorial Monocle（衬线不合工具场景）。

---

## 2. 候选设计系统推荐

针对「中性现代极简外壳 + 与 Excalidraw 同源」这个目标，从 71 套内置系统中筛出 3 套差异化候选：

| 方案 | 设计系统 | 匹配度 | 特征 | 适合原因 |
|------|---------|--------|------|---------|
| **A** | **Linear** | ★★★★★ | 低对比表面分层、1px 细边框、极克制阴影、**indigo/violet 品牌强调色**、桌面工具级精度 | 强调色与 Excalidraw 的 `--color-primary` **天然同色系**；表面分层逻辑（page/surface/island）几乎可以直接映射到 Excalidraw 变量；"安静但精密"正中受众品味 |
| B | **Notion** | ★★★★☆ | 暖中性灰、文档式大留白、柔和圆角、低饱和 | "不冷硬"这条最贴合；留白节奏好。但更偏"文档/内容"气质，工具精度感弱于 Linear，且其暖色底需要向 Excalidraw 的纯中性收敛 |
| C | **Raycast** | ★★★☆☆ | 深色命令面板、精密菜单/右键菜单、键盘优先 | 右键菜单/下拉菜单的交互范式极佳，可借鉴。但整体偏深色/科技工具感，与"安静、不冷硬"的诉求有张力，只适合作为**深色模式与菜单组件**的局部参考 |

> 差异化说明：A 精密克制的"浅色工具"、B 温暖柔和的"文档板"、C 深色精密的"命令台"——三者在**明度基调 + 温度 + 密度**上完全区分，非雷同方案。

### ★ 首选推荐：方案 A · Linear

**明确理由：**

1. **强调色同源**：Linear 的 brand 强调色就是 indigo/violet 系，与 Excalidraw `--color-primary: #6965db` 落在同一色相带——"唯一强调色"策略零冲突。
2. **表面分层可直接镜像**：Linear 的 page-bg / surface / raised-surface 三层结构，恰好能 1:1 映射到 Excalidraw 的 `--color-surface-low / -lowest / --island-bg-color`，满足"不能另起体系"的硬要求。
3. **克制精度匹配受众**：低对比、细边框、无重阴影——正是"安静、利落、有品味"的具象化，避开企业蓝 + 重阴影的土味。
4. **桌面工具基因**：Linear 本身就是桌面优先的效率工具，与"≥1280px 桌面优先、单人自用"的规模完全吻合。

**融合策略**：以 Linear 为骨架，**吸收 Notion 的留白节奏**（更大的页面 padding、更松的卡片间距），色彩与圆角最终**服从 Excalidraw 引擎变量**。即：Linear 的结构 + Notion 的呼吸感 + Excalidraw 的血统。

---

## 3. Color Palette（调色板）

> **对齐原则**：下表 "Excalidraw 映射" 列标明每个外壳 token 对应的引擎变量。凡标注 `= Excalidraw` 者为**直接镜像**；标注 `扩展` 者为外壳新增（用于列表页管理型 UI 的层级）。

### 3.1 浅色主题（Light）

#### 背景层级

| 外壳 Token | HEX | Excalidraw 映射 | 用途 |
|-----------|-----|----------------|------|
| `--wb-bg` | `#f5f5f5` | `= --color-surface-low` | 列表页页面底色（画布页此值被 Excalidraw 覆盖） |
| `--wb-surface` | `#ffffff` | `= --color-surface-lowest` / `--default-bg-color` | 卡片、输入框等主表面 |
| `--wb-surface-raised` | `#ffffff` | `= --island-bg-color` | 浮层：顶栏、下拉菜单、右键菜单、模态 |
| `--wb-surface-sunken` | `#ececec` | `= --color-surface-mid` | 缩略图占位底、分隔区块底 |
| `--wb-surface-hover` | `#f5f5f5` | `= --color-gray-10` | 行/卡片 hover 底 |
| `--wb-surface-active` | `#ebebeb` | `= --color-gray-20` | 按下/选中底（非强调态） |

#### 文字层级

| 外壳 Token | HEX | Excalidraw 映射 | 用途 |
|-----------|-----|----------------|------|
| `--wb-text-primary` | `#1b1b1f` | `= --color-on-surface` | 标题、正文 |
| `--wb-text-secondary` | `#5c5c5c` | `= --color-gray-70` | 次要文字、元信息 |
| `--wb-text-tertiary` | `#7a7a7a` | `= --color-gray-60` | 弱化文字、placeholder、时间戳 |
| `--wb-text-disabled` | `#b8b8b8` | `= --color-gray-40` | 禁用态 |
| `--wb-text-on-accent` | `#ffffff` | `扩展` | 强调色按钮上的文字 |

#### 边框

| 外壳 Token | HEX | Excalidraw 映射 | 用途 |
|-----------|-----|----------------|------|
| `--wb-border` | `#e3e3e3` | `= --color-surface-high`（≈`--default-border-color`） | 默认 1px 边框（卡片/输入框/顶栏分隔） |
| `--wb-border-strong` | `#d6d6d6` | `= --color-gray-30` | 强调分隔、输入框 hover 边框 |
| `--wb-border-subtle` | `#ebebeb` | `= --color-gray-20` | 极弱分隔线 |

#### 强调色（唯一彩色 · indigo/violet）

| 外壳 Token | HEX | Excalidraw 映射 | 用途 |
|-----------|-----|----------------|------|
| `--wb-accent` | `#6965db` | `= --color-primary` | 主按钮、选中卡边框、焦点、活动指示 |
| `--wb-accent-hover` | `#5b57d1` | `= --color-primary-darker` | hover |
| `--wb-accent-active` | `#4a47b1` | `= --color-primary-darkest` | active/按下 |
| `--wb-accent-subtle` | `#e9e8fb` | `扩展`（≈`--color-primary-light` 淡化） | 选中卡背景 tint、focus 外环底 |
| `--wb-focus-ring` | `#6965db` | `= --focus-highlight-color`（`$color-blue-2`） | 键盘焦点环 |
| `--wb-link` | `#5b57d1` | `= --link-color`（`$color-blue-7`） | 文本链接 |

#### 语义色

| 外壳 Token | HEX | Excalidraw 映射 | 用途 |
|-----------|-----|----------------|------|
| `--wb-danger` | `#db6965` | `= --color-danger` | 删除、危险操作 |
| `--wb-danger-hover` | `#ce3c3c` | `= --color-danger-darker` | 危险 hover |
| `--wb-danger-subtle` | `#fbeceb` | `扩展` | 危险项 hover 底（菜单内） |
| `--wb-success` | `#5bb98c` | `= --color-success` | 保存成功指示、同步状态点 |
| `--wb-warning` | `#d6a24a` | `= --color-warning` | 只读保护提示等 |

### 3.2 深色主题（Dark）

> 对应 `.excalidraw.theme--dark`。深色下强调色**变亮**（`--color-primary` 在深色下为浅紫 `#a8a5ff`）。

#### 背景层级

| 外壳 Token | HEX | Excalidraw 映射（dark） |
|-----------|-----|------------------------|
| `--wb-bg` | `#121212` | `= --color-surface-lowest` |
| `--wb-surface` | `#1e1e1e` | `= --color-surface-low` |
| `--wb-surface-raised` | `#232329` | `= --island-bg-color` |
| `--wb-surface-sunken` | `#121212` | `= --color-surface-lowest` |
| `--wb-surface-hover` | `#2c2c2c` | `= --color-surface-mid` |
| `--wb-surface-active` | `#383838` | `= --color-surface-high` |

#### 文字层级

| 外壳 Token | HEX | Excalidraw 映射（dark） |
|-----------|-----|------------------------|
| `--wb-text-primary` | `#e3e3e8` | `= --color-on-surface` |
| `--wb-text-secondary` | `#a8a8a8` | `≈ --color-gray-40` |
| `--wb-text-tertiary` | `#7a7a7a` | `≈ --color-gray-60` |
| `--wb-text-disabled` | `#5c5c5c` | `≈ --color-gray-70` |
| `--wb-text-on-accent` | `#1b1b1f` | 深色强调底上的文字（浅紫底配深字） |

#### 边框

| 外壳 Token | HEX | Excalidraw 映射（dark） |
|-----------|-----|------------------------|
| `--wb-border` | `#2c2c2c` | `= --color-surface-mid` |
| `--wb-border-strong` | `#383838` | `= --color-surface-high` |
| `--wb-border-subtle` | `#232329` | `= --island-bg-color` |

#### 强调色（dark）

| 外壳 Token | HEX | Excalidraw 映射（dark） |
|-----------|-----|------------------------|
| `--wb-accent` | `#a8a5ff` | `= --color-primary` |
| `--wb-accent-hover` | `#b2b2f0` | `= --color-primary-darker` |
| `--wb-accent-active` | `#c0beff` | `= --color-primary-darkest` |
| `--wb-accent-subtle` | `#2b2a45` | `扩展`（深色下 tint 变深紫底） |
| `--wb-focus-ring` | `#a8a5ff` | `= --focus-highlight-color` |
| `--wb-link` | `#a8a5ff` | `= --link-color` |

#### 语义色（dark）

| 外壳 Token | HEX | Excalidraw 映射（dark） |
|-----------|-----|------------------------|
| `--wb-danger` | `#db6965` | `= --color-danger` |
| `--wb-danger-hover` | `#e0837f` | `扩展`（深色下提亮） |
| `--wb-danger-subtle` | `#3a2323` | `扩展` |
| `--wb-success` | `#5bb98c` | `= --color-success` |
| `--wb-warning` | `#d6a24a` | `= --color-warning` |

> **对比度检查（WCAG AA）**：
> - 浅色 `--wb-text-primary #1b1b1f` on `#ffffff` = 16.4:1 ✅ AAA
> - 浅色 `--wb-text-secondary #5c5c5c` on `#ffffff` = 7.0:1 ✅ AAA
> - 浅色 `--wb-text-tertiary #7a7a7a` on `#ffffff` = 4.6:1 ✅ AA（正文级）
> - 浅色 `--wb-text-on-accent #fff` on `--wb-accent #6965db` = 4.6:1 ✅ AA
> - 深色 `--wb-text-primary #e3e3e8` on `#1e1e1e` = 12.7:1 ✅ AAA
> - 深色 `--wb-text-on-accent #1b1b1f` on `#a8a5ff` = 8.9:1 ✅ AAA
> - `--wb-danger #db6965` on `#ffffff` = 3.6:1 ⚠️ 仅用于**图标/边框/大字号**，正文级危险文字改用 `--wb-danger-hover #ce3c3c`（4.9:1 ✅ AA）

---

## 4. Typography（排版）

### 字体栈（系统无衬线 + 中文回退 · 绝不用 Virgil）

```css
--wb-font-sans:
  system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
  "Helvetica Neue", Arial,
  /* 中文回退 */
  "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "微软雅黑",
  "Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Micro Hei",
  sans-serif;

--wb-font-mono:
  ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas,
  "Liberation Mono", monospace;
```

> **与 Excalidraw 的关系**：Excalidraw `--ui-font` 首位是 `Assistant`（拉丁无衬线），中文会自动回退到系统字体。外壳**主动显式**声明中文回退栈，保证中文观感统一——这是对引擎的**增强而非背离**。画布内文字（含 Virgil）完全交给 Excalidraw，外壳不干预。

### 字号阶梯

| 层级 | Token | Size | Weight | Line-height | 用途 |
|------|-------|------|--------|-------------|------|
| Page Title | `--wb-text-2xl` | 24px / 1.5rem | 600 | 1.3 | 列表页标题「我的白板」 |
| Section | `--wb-text-xl` | 18px / 1.125rem | 600 | 1.4 | 分组标题、模态标题 |
| Board Title | `--wb-text-lg` | 15px / 0.9375rem | 600 | 1.4 | 卡片板名、顶栏板名 |
| Body | `--wb-text-base` | 14px / 0.875rem | 400 | 1.5 | 正文、菜单项、按钮（≈Excalidraw UI 基准） |
| Small | `--wb-text-sm` | 13px / 0.8125rem | 400 | 1.45 | 次要说明、输入框 |
| Micro | `--wb-text-xs` | 12px / 0.75rem | 500 | 1.4 | 时间戳、徽标、元信息 |

**字重**：仅用 `400 / 500 / 600` 三档（`--wb-weight-regular/medium/semibold`）。**禁用 700+**（避免"后台模板"的厚重感）。

---

## 5. Spacing & Radius（间距与圆角）

### 间距刻度（4px 基准）

| Token | Value | 用途 |
|-------|-------|------|
| `--wb-space-1` | 4px | 图标与文字间隙、菜单内 padding |
| `--wb-space-2` | 8px | 紧凑间距、按钮内 gap |
| `--wb-space-3` | 12px | 卡片元信息 padding |
| `--wb-space-4` | 16px | 默认间距、网格 gap |
| `--wb-space-5` | 20px | 卡片间距（呼应 Notion 的松） |
| `--wb-space-6` | 24px | 区块 padding |
| `--wb-space-8` | 32px | 页面主 padding |
| `--wb-space-10` | 40px | 区块分隔 |
| `--wb-space-12` | 48px | 页面上下留白 |
| `--wb-space-16` | 64px | 空状态上下留白 |

### 圆角刻度（呼应 Excalidraw 的柔和圆角）

| Token | Value | Excalidraw 映射 | 用途 |
|-------|-------|----------------|------|
| `--wb-radius-sm` | 4px | ≈`--border-radius-md` | 菜单项、小标签 |
| `--wb-radius-md` | 6px | ≈`--border-radius-lg` | 按钮、输入框 |
| `--wb-radius-lg` | 8px | `--border-radius-lg` | 卡片、下拉菜单 |
| `--wb-radius-xl` | 12px | 扩展 | 缩略图容器、大浮层 |
| `--wb-radius-pill` | 999px | — | 徽标、胶囊按钮 |

---

## 6. Depth & Elevation（阴影与层级）

> **克制原则**：参考 Excalidraw `--shadow-island`（`0 0 1px rgba(0,0,0,.17), ...`）的**极浅程度**。阴影只用于"浮起来"的元素，页面静态表面**一律无阴影**，靠 1px 边框分层。

| Token | 浅色值 | 深色值 | 用途 |
|-------|--------|--------|------|
| `--wb-shadow-xs` | `0 1px 2px rgba(0,0,0,.04)` | `0 1px 2px rgba(0,0,0,.30)` | 卡片默认（几乎不可见） |
| `--wb-shadow-sm` | `0 0 1px rgba(0,0,0,.17), 0 1px 2px rgba(0,0,0,.06)` | `0 0 1px rgba(0,0,0,.5), 0 1px 2px rgba(0,0,0,.4)` | **镜像 `--shadow-island`**：顶栏、卡片 hover |
| `--wb-shadow-md` | `0 0 1px rgba(0,0,0,.12), 0 4px 12px -2px rgba(0,0,0,.10)` | `0 0 1px rgba(0,0,0,.5), 0 4px 12px -2px rgba(0,0,0,.45)` | 下拉菜单、右键菜单 |
| `--wb-shadow-lg` | `0 0 1px rgba(0,0,0,.12), 0 12px 28px -6px rgba(0,0,0,.14)` | `0 0 1px rgba(0,0,0,.5), 0 12px 28px -6px rgba(0,0,0,.5)` | 模态、重命名对话框 |

### Z-index 阶梯

| Token | Value | 用途 |
|-------|-------|------|
| `--wb-z-base` | 0 | 页面内容 |
| `--wb-z-sticky` | 100 | 编辑器顶栏 |
| `--wb-z-dropdown` | 200 | 下拉 / 右键菜单 |
| `--wb-z-modal` | 300 | 对话框 / 遮罩 |
| `--wb-z-toast` | 400 | Toast 提示 |

---

## 7. Component Styles（组件规范）

### 7.1 按钮

| 变体 | 背景 | 文字 | 边框 | 圆角 | 高度 | Padding | Hover | Active |
|------|------|------|------|------|------|---------|-------|--------|
| **Primary** | `--wb-accent` | `--wb-text-on-accent` | none | 6px | 32px | `0 12px` | `--wb-accent-hover` | `--wb-accent-active` |
| **Secondary** | `--wb-surface` | `--wb-text-primary` | `1px --wb-border` | 6px | 32px | `0 12px` | 底 `--wb-surface-hover`，边 `--wb-border-strong` | `--wb-surface-active` |
| **Ghost** | transparent | `--wb-text-secondary` | none | 6px | 32px | `0 10px` | 底 `--wb-surface-hover`，字 `--wb-text-primary` | `--wb-surface-active` |
| **Icon** | transparent | `--wb-text-secondary` | none | 6px | 32px | 0 | 底 `--wb-surface-hover` | `--wb-surface-active` |
| **Danger（确认态）** | `--wb-danger-hover` | `#fff` | none | 6px | 32px | `0 12px` | 加深 8% | — |

- 图标尺寸 `--wb-icon-size: 16px`（=`--default-icon-size`）。
- 焦点态：`box-shadow: 0 0 0 2px var(--wb-accent-subtle), 0 0 0 4px var(--wb-focus-ring)`（键盘可见，鼠标点击不显示）。
- 过渡：`background-color/color 120ms cubic-bezier(.2,0,0,1)`。

### 7.2 白板卡片（Board Card · 缩略图卡）

| 属性 | 值 |
|------|-----|
| 背景 | `--wb-surface` |
| 边框 | `1px solid --wb-border` |
| 圆角 | `--wb-radius-lg`（8px） |
| 阴影（静息） | `--wb-shadow-xs` |
| 阴影（hover） | `--wb-shadow-sm` + `translateY(-1px)` |
| hover 边框 | `--wb-border-strong` |
| **选中态** | 边框 `1.5px --wb-accent` + 外环 `0 0 0 3px --wb-accent-subtle` |
| 缩略图区 | 背景 `--wb-surface-sunken`，**4:3 宽高比**，顶部圆角 8px，底部 0 |
| 元信息区 | padding `12px`，板名 `--wb-text-lg`/600，时间戳 `--wb-text-xs`/`--wb-text-tertiary` |
| 网格 | `repeat(auto-fill, minmax(240px, 1fr))`，gap `--wb-space-5`（20px） |
| 悬停操作 | 卡片右上角浮出 `⋯` 图标按钮（Ghost），点击开右键菜单同款菜单 |

### 7.3 输入框 / 搜索框

| 属性 | 值 |
|------|-----|
| 高度 | 32px |
| 背景 | `--wb-surface` |
| 边框 | `1px solid --wb-border` |
| 圆角 | `--wb-radius-md`（6px） |
| Padding | `0 10px` |
| Placeholder | `--wb-text-tertiary` |
| Hover | 边框 `--wb-border-strong` |
| Focus | 边框 `--wb-accent` + 环 `0 0 0 3px --wb-accent-subtle` |
| 搜索框 | 左侧内嵌 `16px` 搜索图标，padding-left `32px` |

### 7.4 下拉菜单 / 右键菜单

| 属性 | 值 |
|------|-----|
| 背景 | `--wb-surface-raised` |
| 边框 | `1px solid --wb-border` |
| 圆角 | `--wb-radius-lg`（8px） |
| 阴影 | `--wb-shadow-md` |
| Padding | `4px` |
| 菜单项高度 | 30px，圆角 `--wb-radius-sm`（4px），padding `0 8px` |
| 菜单项 hover | 底 `--wb-surface-hover` |
| 危险项 | 文字 `--wb-danger-hover`，hover 底 `--wb-danger-subtle` |
| 图标 | 左侧 16px，与文字 gap `--wb-space-2` |
| 快捷键提示 | 右侧 `--wb-text-xs`/`--wb-text-tertiary` |

**右键菜单项（列表页卡片）**：打开 · 在新标签页打开 · 重命名 · 复制 · — 分隔线 — · 删除（危险）

### 7.5 编辑器顶栏（极薄）

| 属性 | 值 |
|------|-----|
| 高度 | **44px**（极薄，画布占满其余视口） |
| 背景 | `--wb-surface-raised` |
| 底部 | `1px solid --wb-border` |
| 布局 | 左：返回图标按钮 + 板名；右：导出（Secondary）+ `⋯` 菜单（Icon） |
| 板名 | `--wb-text-lg`/600，点击可就地重命名（inline edit） |
| 阴影 | `--wb-shadow-sm`（微弱，与画布浮岛呼应） |
| 注意 | 顶栏**不遮挡画布工具栏**——Excalidraw 工具栏默认在顶部，需给画布容器 `padding-top: 44px` 或让顶栏浮在画布上方留出安全区 |

### 7.6 空状态（列表页无白板时）

| 属性 | 值 |
|------|-----|
| 布局 | 垂直居中，`--wb-space-16` 上下留白 |
| 图形 | 中性线性图标（画布/铅笔意象，**非**彩色插画），尺寸 48px，色 `--wb-text-tertiary` |
| 标题 | `--wb-text-xl`/600/`--wb-text-primary`「还没有白板」 |
| 副文案 | `--wb-text-sm`/`--wb-text-secondary`「新建一块，开始你的第一张灵感板」 |
| 主操作 | Primary 按钮「新建白板」 |

### 7.7 Toast / 保存指示

| 属性 | 值 |
|------|-----|
| 位置 | 底部居中，距底 `--wb-space-6` |
| 背景 | `--wb-surface-raised` |
| 边框/圆角/阴影 | `--wb-border` / `--wb-radius-lg` / `--wb-shadow-md` |
| 文字 | `--wb-text-sm`/`--wb-text-primary` |
| 保存态 | 编辑器顶栏板名旁显示一个小圆点：保存中 `--wb-text-tertiary` → 已保存 `--wb-success`（**不弹模态、不打断**） |

---

## 8. Layout（布局）

### 列表页

- **容器**：`max-width: 1280px`，左右 padding `--wb-space-8`（32px），垂直 padding `--wb-space-12`（48px）。
- **页头**：高 56px。左 = 标题「我的白板」；右 = 搜索框（宽 240px）+ Primary「新建白板」。
- **网格**：`repeat(auto-fill, minmax(240px, 1fr))`，gap `20px`。≥1280px 约 4–5 列。

### 编辑器页

- 顶栏 44px 固定；`<Excalidraw/>` 容器 `height: calc(100vh - 44px)`。
- 外壳**不设左右边栏**（画布为主角），导出等操作收进顶栏与 `⋯` 菜单。

### 间距使用原则

- 页面级留白**宁大勿小**（Linear 的紧 + Notion 的松，取中间偏松）。
- 组件内部紧（4/8px），区块之间松（24/32px）。

---

## 9. Cautions（注意事项 · 反模式禁区）

### Never Do（绝对禁止）

- ❌ **绝不出现第二个彩色**（除 indigo 强调 + 危险/成功语义外）。任何蓝绿黄紫的装饰性使用都违规。
- ❌ **绝不用重阴影 / 卡片浮起效果堆叠**——阴影一律 ≤ `--wb-shadow-sm`，除非是真正的浮层。
- ❌ **绝不用企业蓝**（如 `#1890ff`、`#1677ff` 那类）——强调色只能是 Excalidraw 的 indigo/violet。
- ❌ **绝不把 Virgil 手写体带进外壳**（顶栏/按钮/菜单/标题一律系统无衬线）。
- ❌ **绝不说"已用满 / 已达上限 / 空间不足"**——本地无限量是本产品的核心承诺。数量类文案一律中性或正向（如「12 个白板」）。
- ❌ **绝不用整屏遮罩 + 确认弹窗打断编辑**——删除用**就地确认**（菜单项二次点击或行内确认），重命名用 inline edit。
- ❌ **绝不加 700+ 粗体**、绝不加渐变、绝不加彩色插画。

### Prefer（推荐替代）

- ✅ 分层靠 **1px 边框 + 极浅阴影**，不靠深色块。
- ✅ 强调只给**一处**：主按钮 / 选中卡 / 焦点环。
- ✅ 危险操作**降低视觉权重**（放在菜单底部、用语义色、需二次确认），而不是做成大红按钮。
- ✅ 交互反馈用**微动效**（120–180ms）而非弹窗；保存状态用**顶栏小圆点**而非 Toast 轰炸。
- ✅ 空状态**安静**（灰图标 + 一句人话），不喧哗。
- ✅ 深色模式**跟随系统**，一键切换，与 Excalidraw 的 `theme--dark` 同步。

### 针对受众情绪（怕等待 / 怕丢数据 / 烦"土味"）的专项约束

- **怕等待**：所有操作**乐观更新**（新建/重命名/删除立即反映），后台落盘；列表页骨架屏而非 spinner 转圈。
- **怕丢数据**：编辑自动保存 + 顶栏可见的保存状态点；**禁止**"未保存"焦虑式弹窗；删除需确认，但确认文案平实（「删除白板？此操作不可撤销」）。
- **烦"土味后台模板"**：见 Never Do 全部条目。

---

## 10. Responsive Behavior（响应式）

> 本项目**桌面优先**，响应式只保证 ≥1024px 不破版，不做移动端专门优化。

| Name | Width | 行为 |
|------|-------|------|
| Desktop | ≥1280px | 完整布局，网格 4–5 列 |
| Compact | 1024–1280px | 网格 3 列，容器 padding 收窄至 24px |
| Floor | < 1024px | 网格 2 列；顶栏按钮文案可折叠为纯图标；**保底不破版** |

**适配规则：**
- 断点：`1024px`（唯一硬断点）、`1280px`（网格列数优化点）。
- 不实现移动端触摸手势特化（与 Excalidraw 引擎策略一致）。
- 编辑器顶栏在窄屏下：板名截断（`text-overflow: ellipsis`），导出按钮保留图标。

---

## 11. 与 Excalidraw 变量的映射总表（速查）

| 外壳 Token | Excalidraw 变量 | 关系 |
|-----------|----------------|------|
| `--wb-bg` | `--color-surface-low`（浅）/ `--color-surface-lowest`（深） | 镜像 |
| `--wb-surface` | `--color-surface-lowest` / `--default-bg-color` | 镜像 |
| `--wb-surface-raised` | `--island-bg-color` | 镜像 |
| `--wb-surface-sunken` | `--color-surface-mid` | 镜像 |
| `--wb-surface-hover` | `--color-gray-10` | 镜像 |
| `--wb-surface-active` | `--color-gray-20` | 镜像 |
| `--wb-text-primary` | `--color-on-surface` | 镜像 |
| `--wb-text-secondary` | `--color-gray-70` | 镜像 |
| `--wb-text-tertiary` | `--color-gray-60` | 镜像 |
| `--wb-text-disabled` | `--color-gray-40` | 镜像 |
| `--wb-border` | `--color-surface-high`（`--default-border-color`） | 镜像 |
| `--wb-border-strong` | `--color-gray-30` | 镜像 |
| `--wb-border-subtle` | `--color-gray-20` | 镜像 |
| `--wb-accent` | `--color-primary` | 镜像 |
| `--wb-accent-hover` | `--color-primary-darker` | 镜像 |
| `--wb-accent-active` | `--color-primary-darkest` | 镜像 |
| `--wb-focus-ring` | `--focus-highlight-color`（`$color-blue-2`） | 镜像 |
| `--wb-link` | `--link-color`（`$color-blue-7`） | 镜像 |
| `--wb-danger` | `--color-danger` | 镜像 |
| `--wb-danger-hover` | `--color-danger-darker` | 镜像 |
| `--wb-success` | `--color-success` | 镜像 |
| `--wb-warning` | `--color-warning` | 镜像 |
| `--wb-shadow-sm` | `--shadow-island` | 镜像（同克制度） |
| `--wb-icon-size` | `--default-icon-size`（1rem） | 镜像 |
| `--wb-radius-md/lg` | `--border-radius-lg` | 近似 |
| `--wb-accent-subtle` / `--wb-danger-subtle` | — | **扩展**（外壳新增，列表页层级需要） |

> **实现建议（给原型构建师）**：外壳 CSS 变量建议**定义在 `:root`**，并通过 `body` 上的 `[data-theme="dark"]` 覆盖；同时把外壳的 `--wb-*` 与 Excalidraw 的 `.excalidraw` 容器变量**绑定**（例如让 `.excalidraw` 继承外壳的 `--color-primary` 语义），确保两页视觉零跳变。**切勿**给 `.excalidraw` 注入非 Excalidraw 的变量名。

---

## 12. Agent Prompt Guide（给下游生成指南）

### Key Instructions

- **只做两个界面**：列表页 + 编辑器页。不要发明第三个页面。
- 所有颜色/间距/圆角/阴影**只用本文档的 token**，不即兴造值。
- 强调色**只出现在一处**：主按钮或选中卡或焦点环。
- 阴影默认**几乎看不见**；浮层才允许 `--wb-shadow-md`。
- 中文文案走系统字体，**任何地方不出现手写体**。
- 数量文案**永不**出现"上限/已满"；删除需就地确认；保存状态用顶栏小圆点。
- 深色模式跟随系统，用 `[data-theme="dark"]` 切换 `--wb-*`。

### Quick CSS Snippet（可直接落地）

```css
:root {
  /* ---- 浅色主题 ---- */
  /* 背景层级 */
  --wb-bg: #f5f5f5;
  --wb-surface: #ffffff;
  --wb-surface-raised: #ffffff;
  --wb-surface-sunken: #ececec;
  --wb-surface-hover: #f5f5f5;
  --wb-surface-active: #ebebeb;

  /* 文字层级 */
  --wb-text-primary: #1b1b1f;
  --wb-text-secondary: #5c5c5c;
  --wb-text-tertiary: #7a7a7a;
  --wb-text-disabled: #b8b8b8;
  --wb-text-on-accent: #ffffff;

  /* 边框 */
  --wb-border: #e3e3e3;
  --wb-border-strong: #d6d6d6;
  --wb-border-subtle: #ebebeb;

  /* 强调色（唯一彩色 · indigo/violet） */
  --wb-accent: #6965db;
  --wb-accent-hover: #5b57d1;
  --wb-accent-active: #4a47b1;
  --wb-accent-subtle: #e9e8fb;
  --wb-focus-ring: #6965db;
  --wb-link: #5b57d1;

  /* 语义色 */
  --wb-danger: #db6965;
  --wb-danger-hover: #ce3c3c;
  --wb-danger-subtle: #fbeceb;
  --wb-success: #5bb98c;
  --wb-warning: #d6a24a;

  /* 字体 */
  --wb-font-sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB",
    "Microsoft YaHei", "微软雅黑", "Noto Sans CJK SC", "Source Han Sans SC",
    "WenQuanYi Micro Hei", sans-serif;
  --wb-font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas,
    "Liberation Mono", monospace;

  /* 字号 */
  --wb-text-2xl: 1.5rem;    /* 24px */
  --wb-text-xl: 1.125rem;   /* 18px */
  --wb-text-lg: 0.9375rem;  /* 15px */
  --wb-text-base: 0.875rem; /* 14px */
  --wb-text-sm: 0.8125rem;  /* 13px */
  --wb-text-xs: 0.75rem;    /* 12px */
  --wb-weight-regular: 400;
  --wb-weight-medium: 500;
  --wb-weight-semibold: 600;

  /* 间距 */
  --wb-space-1: 4px;
  --wb-space-2: 8px;
  --wb-space-3: 12px;
  --wb-space-4: 16px;
  --wb-space-5: 20px;
  --wb-space-6: 24px;
  --wb-space-8: 32px;
  --wb-space-10: 40px;
  --wb-space-12: 48px;
  --wb-space-16: 64px;

  /* 圆角 */
  --wb-radius-sm: 4px;
  --wb-radius-md: 6px;
  --wb-radius-lg: 8px;
  --wb-radius-xl: 12px;
  --wb-radius-pill: 999px;

  /* 阴影（克制） */
  --wb-shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.04);
  --wb-shadow-sm: 0 0 1px rgba(0, 0, 0, 0.17), 0 1px 2px rgba(0, 0, 0, 0.06);
  --wb-shadow-md: 0 0 1px rgba(0, 0, 0, 0.12), 0 4px 12px -2px rgba(0, 0, 0, 0.1);
  --wb-shadow-lg: 0 0 1px rgba(0, 0, 0, 0.12), 0 12px 28px -6px rgba(0, 0, 0, 0.14);

  /* 尺寸 */
  --wb-icon-size: 16px;
  --wb-control-height: 32px;
  --wb-topbar-height: 44px;

  /* Z-index */
  --wb-z-base: 0;
  --wb-z-sticky: 100;
  --wb-z-dropdown: 200;
  --wb-z-modal: 300;
  --wb-z-toast: 400;

  /* 动效 */
  --wb-dur-fast: 120ms;
  --wb-dur-base: 180ms;
  --wb-ease: cubic-bezier(0.2, 0, 0, 1);
}

[data-theme="dark"] {
  --wb-bg: #121212;
  --wb-surface: #1e1e1e;
  --wb-surface-raised: #232329;
  --wb-surface-sunken: #121212;
  --wb-surface-hover: #2c2c2c;
  --wb-surface-active: #383838;

  --wb-text-primary: #e3e3e8;
  --wb-text-secondary: #a8a8a8;
  --wb-text-tertiary: #7a7a7a;
  --wb-text-disabled: #5c5c5c;
  --wb-text-on-accent: #1b1b1f;

  --wb-border: #2c2c2c;
  --wb-border-strong: #383838;
  --wb-border-subtle: #232329;

  --wb-accent: #a8a5ff;
  --wb-accent-hover: #b2b2f0;
  --wb-accent-active: #c0beff;
  --wb-accent-subtle: #2b2a45;
  --wb-focus-ring: #a8a5ff;
  --wb-link: #a8a5ff;

  --wb-danger: #db6965;
  --wb-danger-hover: #e0837f;
  --wb-danger-subtle: #3a2323;
  --wb-success: #5bb98c;
  --wb-warning: #d6a24a;

  --wb-shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.3);
  --wb-shadow-sm: 0 0 1px rgba(0, 0, 0, 0.5), 0 1px 2px rgba(0, 0, 0, 0.4);
  --wb-shadow-md: 0 0 1px rgba(0, 0, 0, 0.5), 0 4px 12px -2px rgba(0, 0, 0, 0.45);
  --wb-shadow-lg: 0 0 1px rgba(0, 0, 0, 0.5), 0 12px 28px -6px rgba(0, 0, 0, 0.5);
}
```

---

*DESIGN.md v1.0 · 设计系统专家 彩格调 · 首选 Linear（融合 Notion 留白 + Excalidraw 血统）*
