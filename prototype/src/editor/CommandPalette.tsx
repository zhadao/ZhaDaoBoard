import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@excalidraw/excalidraw";
import { IconSearch } from "../icons";
import { useTheme } from "../theme";
import { SNAP_LABEL, useViewPrefs, type SnapMode } from "../viewPrefs";
import {
  acquireActionManager,
  getActionManager,
  getEngineApp,
  runEngineAction,
  toggleEngineToolLock,
  type EngineAction,
} from "./engineBridge";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  ENGINE_ACTION_GROUPS,
  ENGINE_SHORTCUTS,
  PALETTE_SHORTCUT,
  PALETTE_SHORTCUT_ALT,
  TOOL_SHORTCUTS,
  TOOL_TYPES,
  type CommandCategory,
} from "./engineCommands";
import type { ExcalidrawImperativeAPI } from "../types";

/**
 * 命令面板（外壳自建）。
 *
 * 引擎自带的那一个在本项目「当库用」的形态下是死的：`VK` 组件（注册 Ctrl+/ 监听、
 * 渲染 `.command-palette-dialog`）在产物里只出现一次——就是它自己的定义，从未被挂载，
 * 包的公开导出里也没有它。所以这里按引擎 `CommandPalette.tsx` 的行为逐条复刻：
 *
 *   - 同一个快捷键（Ctrl+/ 与 Ctrl+Shift+P）；
 *   - 同一批动作与分组顺序（App / Export / Editor / Tools / Elements）；
 *   - 同样的可用性判定（`predicate` + 视图模式过滤）；
 *   - 同样的键盘交互（↑↓ 选择、Enter 执行、Esc 关闭）。
 *
 * 动作执行走 `engineBridge` 取回的 ActionManager；取不到时自动降级为「只显示外壳命令」。
 */

// ---------------------------------------------------------------------------
// 打开 / 关闭的外部状态
//
// 刻意不放 React state：面板挂在 <Excalidraw> 的 children 里（为了拿到引擎的 i18n
// 上下文），如果用 props 传开关状态，每次开关都会让 <Excalidraw> 的 children 变成
// 新引用、进而整棵引擎树重渲染。用一个极小的外部 store 把两者解耦。
// ---------------------------------------------------------------------------

let paletteOpen = false;
const openListeners = new Set<() => void>();

function emitOpen() {
  openListeners.forEach((fn) => fn());
}

export function openCommandPalette() {
  if (paletteOpen) return;
  paletteOpen = true;
  emitOpen();
}

export function closeCommandPalette() {
  if (!paletteOpen) return;
  paletteOpen = false;
  emitOpen();
}

function subscribeOpen(fn: () => void) {
  openListeners.add(fn);
  return () => {
    openListeners.delete(fn);
  };
}

function getOpenSnapshot() {
  return paletteOpen;
}

// ---------------------------------------------------------------------------
// 命令模型
// ---------------------------------------------------------------------------

type Command = {
  id: string;
  label: string;
  category: CommandCategory;
  keywords: string[];
  shortcut?: string;
  enabled: boolean;
  run: () => void;
};

/** 模糊搜索：连续子串优先，其次按顺序的子序列匹配。中文走的是同一条路径。 */
function matchScore(query: string, haystack: string): number {
  const q = query.toLowerCase();
  const h = haystack.toLowerCase();
  if (!q) return 0;
  const at = h.indexOf(q);
  if (at >= 0) return 1000 - at;
  let i = 0;
  let score = 0;
  let last = -2;
  for (let j = 0; j < h.length && i < q.length; j++) {
    if (h[j] === q[i]) {
      score += j === last + 1 ? 4 : 1;
      last = j;
      i++;
    }
  }
  return i === q.length ? score : -1;
}

function shortcutParts(shortcut: string): string[] {
  // 与引擎的快捷键渲染组件一致：`++` 代表「加号键」本身，先占位再切分
  return shortcut.replace("++", "+$").split("+");
}

// ---------------------------------------------------------------------------
// 面板
// ---------------------------------------------------------------------------

type Props = {
  api: ExcalidrawImperativeAPI | null;
  onToggleSidebar: () => void;
  onExportPNG: () => void;
  onExportSVG: () => void;
  onExportExcalidraw: () => void;
};

export function BoardCommandPalette({
  api,
  onToggleSidebar,
  onExportPNG,
  onExportSVG,
  onExportExcalidraw,
}: Props) {
  const { t } = useI18n();
  const open = useSyncExternalStore(subscribeOpen, getOpenSnapshot);
  const { setting, setSetting } = useTheme();
  const [view, patchView] = useViewPrefs();

  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [bridgeReady, setBridgeReady] = useState(() => getActionManager() !== null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 取回引擎的 ActionManager（拿不到就降级，只显示外壳命令）
  useEffect(() => {
    if (!api || bridgeReady) return;
    let raf = 0;
    let tries = 0;
    const attempt = () => {
      if (acquireActionManager(api)) {
        setBridgeReady(true);
        return;
      }
      if (tries++ < 30) raf = requestAnimationFrame(attempt);
    };
    attempt();
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [api, bridgeReady]);

  // 全局快捷键：Ctrl+/ 与 Ctrl+Shift+P（与引擎 shortcuts 表一致）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const isSlash = event.key === "/" && !event.shiftKey;
      const isShiftP = event.shiftKey && event.key.toLowerCase() === "p";
      if (!isSlash && !isShiftP) return;
      event.preventDefault();
      event.stopPropagation();
      if (paletteOpen) closeCommandPalette();
      else openCommandPalette();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    const manager = getActionManager();
    const app = getEngineApp();
    const appProps = (app as { props?: unknown } | null)?.props;
    const appState = api?.getAppState() ?? null;
    const elements = api?.getSceneElements() ?? [];

    const selectedCount = appState
      ? Object.values(appState.selectedElementIds ?? {}).filter(Boolean).length
      : 0;

    const translate = (action: EngineAction): string => {
      const raw = action.label;
      if (!raw) return action.name;
      try {
        const key = typeof raw === "function" ? raw(elements, appState, app) : raw;
        const text = t(key);
        return text === key ? action.name : text;
      } catch {
        return action.name;
      }
    };

    // 1) 引擎内置动作（分组与顺序对齐官方 CommandPalette）
    if (manager && appState) {
      for (const group of ENGINE_ACTION_GROUPS) {
        for (const name of group.names) {
          const action = manager.actions[name];
          if (!action) continue;
          if (action.viewMode === false && appState.viewModeEnabled) continue;

          let enabled = true;
          try {
            if (typeof action.predicate === "function") {
              enabled = !!action.predicate(elements, appState, appProps, app);
            } else if (group.requireSelection) {
              // 引擎对没有 predicate 的元素类动作的兜底：必须有选中元素
              enabled = selectedCount > 0;
            }
          } catch {
            enabled = false;
          }

          list.push({
            id: `engine:${name}`,
            label: translate(action),
            category: group.category,
            // 额外把动作的英文名塞进检索串：界面全中文，但用户很可能按
            // `alignTop` / `zoomToFit` 这类英文名来搜（比引擎原生面板更好搜）。
            keywords: [...(action.keywords ?? []), name],
            shortcut: ENGINE_SHORTCUTS[name],
            enabled,
            run: () => runEngineAction(name),
          });
        }
      }
    }

    // 2) 绘图工具（引擎 CommandPalette 里的工具数组）
    for (const type of TOOL_TYPES) {
      list.push({
        id: `tool:${type}`,
        label: t(`toolBar.${type}`),
        category: "tools",
        keywords: ["toolbar", "工具", type],
        shortcut: TOOL_SHORTCUTS[type],
        enabled: !!api,
        run: () => api?.setActiveTool({ type }),
      });
    }

    // 3) 外壳补充命令（引擎没有对应动作的那些）
    list.push(
      {
        id: "shell:tool-lock",
        label: appState?.activeTool?.locked ? "解锁工具" : "锁定工具",
        category: "tools",
        keywords: ["lock", "锁定", "工具锁", "保持所选工具", "toolbar"],
        shortcut: "Q",
        enabled: bridgeReady,
        run: () => {
          toggleEngineToolLock();
        },
      },
      {
        id: "shell:theme-light",
        label: "浅色主题",
        category: "app",
        keywords: ["theme", "light", "主题", "浅色", "亮色"],
        enabled: setting !== "light",
        run: () => setSetting("light"),
      },
      {
        id: "shell:theme-dark",
        label: "深色主题",
        category: "app",
        keywords: ["theme", "dark", "主题", "深色", "暗色"],
        enabled: setting !== "dark",
        run: () => setSetting("dark"),
      },
      {
        id: "shell:theme-system",
        label: "跟随系统主题",
        category: "app",
        keywords: ["theme", "system", "主题", "跟随系统", "自动"],
        enabled: setting !== "system",
        run: () => setSetting("system"),
      },
      {
        id: "shell:sidebar",
        label: "显示 / 隐藏侧边栏",
        category: "app",
        keywords: ["sidebar", "侧边栏", "白板列表", "面板"],
        enabled: true,
        run: onToggleSidebar,
      },
      {
        id: "shell:dots",
        label: view.dots ? "关闭点阵背景" : "开启点阵背景",
        category: "editor",
        keywords: ["dot", "grid", "点阵", "网格", "背景"],
        enabled: true,
        run: () => patchView({ dots: !view.dots }),
      },
      ...(["none", "grid", "objects"] as SnapMode[]).map<Command>((mode) => ({
        id: `shell:snap-${mode}`,
        label: `吸附：${SNAP_LABEL[mode]}`,
        category: "editor",
        keywords: ["snap", "吸附", "对齐", SNAP_LABEL[mode]],
        enabled: view.snap !== mode,
        run: () =>
          patchView(mode === "grid" ? { snap: mode, dots: true } : { snap: mode }),
      })),
      {
        id: "shell:export-png",
        label: "导出 PNG 图片",
        category: "export",
        keywords: ["export", "png", "导出", "图片"],
        enabled: !!api,
        run: onExportPNG,
      },
      {
        id: "shell:export-svg",
        label: "导出 SVG 矢量图",
        category: "export",
        keywords: ["export", "svg", "导出", "矢量"],
        enabled: !!api,
        run: onExportSVG,
      },
      {
        id: "shell:export-excalidraw",
        label: "导出 .excalidraw 源文件",
        category: "export",
        keywords: ["export", "excalidraw", "json", "导出", "源文件"],
        enabled: !!api,
        run: onExportExcalidraw,
      }
    );

    return list;
  }, [
    api,
    bridgeReady,
    setting,
    setSetting,
    view.dots,
    view.snap,
    t,
    onToggleSidebar,
    onExportPNG,
    onExportSVG,
    onExportExcalidraw,
    patchView,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return commands;
    return commands
      .map((command) => ({
        command,
        score: matchScore(
          q,
          `${command.label} ${command.keywords.join(" ")} ${CATEGORY_LABEL[command.category]}`
        ),
      }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.command);
  }, [commands, query]);

  const grouped = useMemo(() => {
    const buckets = new Map<CommandCategory, Command[]>();
    for (const command of filtered) {
      const bucket = buckets.get(command.category);
      if (bucket) bucket.push(command);
      else buckets.set(command.category, [command]);
    }
    return [...buckets.entries()].sort(
      ([a], [b]) => CATEGORY_ORDER[a] - CATEGORY_ORDER[b]
    );
  }, [filtered]);

  const flat = useMemo(() => grouped.flatMap(([, items]) => items), [grouped]);

  // 打开时重置查询与高亮，并把焦点交给搜索框
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveId(null);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // 高亮项跟随过滤结果
  useEffect(() => {
    if (!open) return;
    if (activeId && flat.some((command) => command.id === activeId)) return;
    setActiveId(flat.find((command) => command.enabled)?.id ?? flat[0]?.id ?? null);
  }, [open, flat, activeId]);

  // 高亮项滚动进视野
  useEffect(() => {
    if (!open || !activeId) return;
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-command-id="${CSS.escape(activeId)}"]`
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [open, activeId]);

  const run = useCallback((command: Command | undefined) => {
    if (!command || !command.enabled) return;
    // 先关面板再执行：部分动作会自己弹窗（导出 / 统计），不能被面板压住
    closeCommandPalette();
    requestAnimationFrame(() => {
      command.run();
      document.querySelector<HTMLElement>(".excalidraw")?.focus();
    });
  }, []);

  // 键盘交互：与引擎一致，用捕获阶段拦截方向键 / 回车 / Esc
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const { key } = event;
      if (key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeCommandPalette();
        document.querySelector<HTMLElement>(".excalidraw")?.focus();
        return;
      }
      if (key === "ArrowDown" || key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        if (flat.length === 0) return;
        const current = flat.findIndex((command) => command.id === activeId);
        const delta = key === "ArrowDown" ? 1 : -1;
        const next = (current + delta + flat.length) % flat.length;
        setActiveId(flat[next].id);
        return;
      }
      if (key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        run(flat.find((command) => command.id === activeId));
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [open, flat, activeId, run]);

  if (!open) return null;

  return createPortal(
    <div
      className="wb-palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeCommandPalette();
      }}
    >
      <div className="wb-palette" role="dialog" aria-modal="true" aria-label="命令面板">
        <div className="wb-palette-search">
          <IconSearch />
          <input
            ref={inputRef}
            className="wb-palette-input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="搜索菜单与命令，发现隐藏功能"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="wb-palette-list" ref={listRef}>
          {flat.length === 0 ? (
            <div className="wb-palette-empty">没有匹配的命令…</div>
          ) : (
            grouped.map(([category, items]) => (
              <div className="wb-palette-group" key={category}>
                <div className="wb-palette-group-title">{CATEGORY_LABEL[category]}</div>
                {items.map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    data-command-id={command.id}
                    className="wb-palette-item"
                    aria-selected={command.id === activeId}
                    data-disabled={command.enabled ? undefined : "true"}
                    title={command.enabled ? undefined : "该命令当前不可用"}
                    onMouseMove={() => {
                      if (command.id !== activeId) setActiveId(command.id);
                    }}
                    onClick={() => run(command)}
                  >
                    <span className="wb-palette-item-label">{command.label}</span>
                    {command.shortcut && (
                      <span className="wb-palette-shortcut">
                        {shortcutParts(command.shortcut).map((part, index) => (
                          <kbd key={`${part}-${index}`}>{part === "+$" ? "+" : part}</kbd>
                        ))}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="wb-palette-foot">
          <span className="wb-palette-hint">
            <kbd>↑</kbd>
            <kbd>↓</kbd> 选择
          </span>
          <span className="wb-palette-hint">
            <kbd>Enter</kbd> 执行
          </span>
          <span className="wb-palette-hint">
            <kbd>Esc</kbd> 关闭
          </span>
          <span className="wb-palette-hint wb-palette-hint--muted">
            {bridgeReady
              ? `${PALETTE_SHORTCUT} / ${PALETTE_SHORTCUT_ALT}`
              : "引擎指令暂不可用，仅显示外壳命令"}
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
