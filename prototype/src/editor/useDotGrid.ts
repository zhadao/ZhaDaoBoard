import { useCallback, useEffect, useRef } from "react";
import type { AppState } from "../types";

/** 屏幕像素点距小于该值时不画点，避免缩得很小时糊成一片灰 */
const MIN_SCREEN_STEP = 6;

const FALLBACK_SIZE = 20;

type Pending = {
  scrollX: number;
  scrollY: number;
  zoom: number;
  size: number;
};

/**
 * 点阵图层的位置同步。
 *
 * 引擎的视口映射是 `screen = (scene + scroll) * zoom`，所以点距与偏移都能
 * 直接用 CSS 变量表达；这里用 rAF 节流把 `onChange` 的高频回调压成每帧一次，
 * 并且只改 DOM 样式，不触发 React 重渲染。
 */
export function useDotGrid() {
  const layerRef = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const pending = useRef<Pending | null>(null);

  const paint = useCallback(() => {
    frame.current = null;
    const element = layerRef.current;
    const next = pending.current;
    if (!element || !next) return;

    const step = next.size * next.zoom;
    if (!Number.isFinite(step) || step < MIN_SCREEN_STEP) {
      element.dataset.dense = "true";
      return;
    }
    element.dataset.dense = "false";
    element.style.setProperty("--wb-dot-step", `${step}px`);
    element.style.setProperty("--wb-dot-x", `${next.scrollX * next.zoom}px`);
    element.style.setProperty("--wb-dot-y", `${next.scrollY * next.zoom}px`);
  }, []);

  const update = useCallback(
    (appState: Readonly<Partial<AppState>>) => {
      const zoom = appState.zoom?.value;
      if (
        typeof appState.scrollX !== "number" ||
        typeof appState.scrollY !== "number" ||
        typeof zoom !== "number" ||
        !Number.isFinite(zoom) ||
        zoom <= 0
      ) {
        return;
      }
      pending.current = {
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        zoom,
        size: typeof appState.gridSize === "number" ? appState.gridSize : FALLBACK_SIZE,
      };
      if (frame.current === null) frame.current = requestAnimationFrame(paint);
    },
    [paint]
  );

  useEffect(() => {
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  return { layerRef, update };
}
