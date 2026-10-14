import { useCallback, useEffect, useState } from "react";

/**
 * 视图偏好（点阵 / 吸附 / 间距）。
 *
 * 为什么放在外壳而不是场景 appState：
 * 引擎的 `gridModeEnabled` 同时控制「画网格」和「对齐到网格」，两者被绑死。
 * 我们的点阵是外壳自绘的独立图层，必须能脱离吸附单独开关，
 * 所以这些偏好由外壳持有，再单向推导出引擎需要的 appState。
 * （引擎那侧的虚线网格已由构建期补丁关掉，只保留吸附。）
 */

export type SnapMode = "none" | "grid" | "objects";

export type ViewPrefs = {
  /** 视觉点阵层是否显示（与吸附解耦） */
  dots: boolean;
  /** 吸附方式：不吸附 / 对齐到点阵节点 / 对齐到其他对象的边缘 */
  snap: SnapMode;
  /** 点阵间距（场景单位，同时作为引擎的 gridSize） */
  size: number;
};

/** 可选间距档位 */
export const DOT_SIZES = [16, 20, 28] as const;

export const SNAP_LABEL: Record<SnapMode, string> = {
  none: "关闭",
  grid: "点阵节点",
  objects: "对象边缘",
};

/** 导出与缩略图用的真实底色见 theme.ts 的 CANVAS_BACKGROUND。 */

const STORAGE_KEY = "wb-view-prefs";

const DEFAULTS: ViewPrefs = { dots: false, snap: "none", size: 20 };

const listeners = new Set<(prefs: ViewPrefs) => void>();

function normalize(raw: unknown): ViewPrefs {
  if (raw === null || typeof raw !== "object") return DEFAULTS;
  const value = raw as Partial<ViewPrefs>;
  return {
    dots: value.dots === true,
    snap: value.snap === "grid" || value.snap === "objects" ? value.snap : "none",
    size: (DOT_SIZES as readonly number[]).includes(value.size as number)
      ? (value.size as number)
      : DEFAULTS.size,
  };
}

export function loadViewPrefs(): ViewPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function saveViewPrefs(prefs: ViewPrefs): void {
  const normalized = normalize(prefs);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    /* 隐私模式下写不进去时忽略：偏好丢失不影响数据正确性 */
  }
  listeners.forEach((fn) => fn(normalized));
}

export function useViewPrefs(): [ViewPrefs, (patch: Partial<ViewPrefs>) => void] {
  const [prefs, setPrefs] = useState<ViewPrefs>(() => loadViewPrefs());

  useEffect(() => {
    const listener = (next: ViewPrefs) => setPrefs(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const patch = useCallback((next: Partial<ViewPrefs>) => {
    saveViewPrefs({ ...loadViewPrefs(), ...next });
  }, []);

  return [prefs, patch];
}
