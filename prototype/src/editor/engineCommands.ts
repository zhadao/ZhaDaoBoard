/**
 * 命令面板的「动作目录」。
 *
 * 这份表逐条对齐 `@excalidraw/excalidraw@0.18.1` 内部 `CommandPalette.tsx` 的分组与顺序
 * （见 docs/EXCALIDRAW-PARITY.md 的对照记录），差异只有两处，都是为了本项目定位：
 *
 *   - 分类名翻成中文。引擎里 `{app:"App", export:"Export", tools:"Tools",
 *     editor:"Editor", elements:"Elements", links:"Links"}` 是硬编码英文，没走语言包。
 *   - 去掉 `saveToActiveFile`（浏览器文件句柄保存，与本地服务落盘语义冲突，
 *     该动作在本项目里本来就被 `UIOptions.canvasActions.saveToActiveFile = false` 关掉）。
 */

export type CommandCategory =
  | "app"
  | "export"
  | "editor"
  | "tools"
  | "elements"
  | "links";

export const CATEGORY_LABEL: Record<CommandCategory, string> = {
  app: "应用",
  export: "导出",
  editor: "编辑器",
  tools: "工具",
  elements: "元素",
  links: "链接",
};

/** 与引擎 `Dk()` 的排序完全一致（App → Export → Editor → Tools → Elements → Links）。 */
export const CATEGORY_ORDER: Record<CommandCategory, number> = {
  app: 1,
  export: 2,
  editor: 3,
  tools: 4,
  elements: 5,
  links: 6,
};

const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const CMD = IS_MAC ? "⌘" : "Ctrl";

const sc = (raw: string) => raw.replace(/CtrlOrCmd/g, CMD);

/**
 * 动作 → 快捷键文案。
 *
 * 引擎把这张表放在 `shortcuts.ts` 的私有对象里（产物中的 `uk`），没有导出，
 * 所以这里按同样的内容重建一份，仅用于**显示**；实际执行走 ActionManager，
 * 快捷键是否生效始终由引擎自己的 keyTest 决定。
 */
export const ENGINE_SHORTCUTS: Record<string, string> = {
  toggleTheme: "Shift+Alt+D",
  loadScene: sc("CtrlOrCmd+O"),
  clearCanvas: sc("CtrlOrCmd+Delete"),
  imageExport: sc("CtrlOrCmd+Shift+E"),
  commandPalette: IS_MAC ? "⌘/" : "Ctrl+/",
  cut: sc("CtrlOrCmd+X"),
  copy: sc("CtrlOrCmd+C"),
  copyStyles: sc("CtrlOrCmd+Alt+C"),
  pasteStyles: sc("CtrlOrCmd+Alt+V"),
  selectAll: sc("CtrlOrCmd+A"),
  deleteSelectedElements: "Delete",
  duplicateSelection: sc("CtrlOrCmd+D"),
  sendBackward: sc("CtrlOrCmd+["),
  bringForward: sc("CtrlOrCmd+]"),
  sendToBack: IS_MAC ? sc("CtrlOrCmd+Alt+[") : sc("CtrlOrCmd+Shift+["),
  bringToFront: IS_MAC ? sc("CtrlOrCmd+Alt+]") : sc("CtrlOrCmd+Shift+]"),
  copyAsPng: "Shift+Alt+C",
  group: sc("CtrlOrCmd+G"),
  ungroup: sc("CtrlOrCmd+Shift+G"),
  gridMode: sc("CtrlOrCmd+'"),
  zenMode: "Alt+Z",
  objectsSnapMode: "Alt+S",
  stats: "Alt+/",
  flipHorizontal: "Shift+H",
  flipVertical: "Shift+V",
  viewMode: "Alt+R",
  hyperlink: sc("CtrlOrCmd+K"),
  toggleElementLock: sc("CtrlOrCmd+Shift+L"),
  resetZoom: sc("CtrlOrCmd+0"),
  zoomOut: sc("CtrlOrCmd+-"),
  zoomIn: sc("CtrlOrCmd++"),
  zoomToFitSelection: "Shift+3",
  zoomToFit: "Shift+1",
  zoomToFitSelectionInViewport: "Shift+2",
  toggleHandTool: "H",
  setFrameAsActiveTool: "F",
  saveFileToDisk: sc("CtrlOrCmd+S"),
  toggleShortcuts: "?",
};

/** 分组：与引擎 `Pk()` 里的 `H / V / F / O` 四个数组一一对应。 */
export const ENGINE_ACTION_GROUPS: {
  category: CommandCategory;
  /** 该组内的动作是否默认要求「有选中元素」才可用（引擎对无 predicate 的动作如此兜底）。 */
  requireSelection?: boolean;
  names: readonly string[];
}[] = [
  {
    category: "elements",
    requireSelection: true,
    names: [
      "group",
      "ungroup",
      "cut",
      "copy",
      "deleteSelectedElements",
      "wrapSelectionInFrame",
      "copyStyles",
      "pasteStyles",
      "bringToFront",
      "bringForward",
      "sendBackward",
      "sendToBack",
      "alignTop",
      "alignBottom",
      "alignLeft",
      "alignRight",
      "alignVerticallyCentered",
      "alignHorizontallyCentered",
      "duplicateSelection",
      "flipHorizontal",
      "flipVertical",
      "zoomToFitSelection",
      "zoomToFitSelectionInViewport",
      "increaseFontSize",
      "decreaseFontSize",
      "toggleLinearEditor",
      "cropEditor",
      "hyperlink",
      "copyElementLink",
      "linkToElement",
    ],
  },
  {
    category: "tools",
    names: ["toggleHandTool", "setFrameAsActiveTool"],
  },
  {
    category: "editor",
    names: [
      "undo",
      "redo",
      "zoomIn",
      "zoomOut",
      "resetZoom",
      "zoomToFit",
      "zenMode",
      "viewMode",
      "gridMode",
      "objectsSnapMode",
      "toggleShortcuts",
      "selectAll",
      "toggleElementLock",
      "unlockAllElements",
      "stats",
    ],
  },
  {
    category: "export",
    names: ["saveFileToDisk", "copyAsPng", "copyAsSvg"],
  },
];

/** 主工具栏的 10 个绘图工具（引擎产物里的 `Mm` 数组）。 */
export const TOOL_TYPES = [
  "selection",
  "rectangle",
  "diamond",
  "ellipse",
  "arrow",
  "line",
  "freedraw",
  "text",
  "image",
  "eraser",
] as const;

export type ToolType = (typeof TOOL_TYPES)[number];

/** 工具 → 数字/字母快捷键（引擎工具栏 `numericKey` / `key`）。 */
export const TOOL_SHORTCUTS: Record<ToolType, string> = {
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

/** 命令面板自身的快捷键文案（引擎 `uk.commandPalette` 有两个组合）。 */
export const PALETTE_SHORTCUT = IS_MAC ? "⌘/" : "Ctrl+/";
export const PALETTE_SHORTCUT_ALT = IS_MAC ? "⌘⇧P" : "Ctrl+Shift+P";
