import { useCallback, useEffect, useState } from "react";
import { fetchPrefs, savePrefs } from "./api";

/** 用户选择：显式浅色 / 显式深色 / 跟随系统。 */
export type ThemeSetting = "light" | "dark" | "system";
/** 解析后的实际主题，直接驱动 CSS。 */
export type Theme = "light" | "dark";

/**
 * 画布真实底色。
 *
 * 引擎画布在常态下被强制设为 `transparent`（点阵层夹在容器底色与画布之间），
 * 所以任何「离开屏幕」的产物——导出 PNG/SVG、列表缩略图——都必须显式补上底色，
 * 否则用户拿到的是一张透明底的图。取值与 tokens.css 的 --wb-canvas-bg 保持一致。
 */
export const CANVAS_BACKGROUND: Record<Theme, string> = {
  light: "#ffffff",
  dark: "#121212",
};

/**
 * 主题偏好的存放位置（按优先级）：
 *
 *   1. `<html data-theme-pref>` —— 由服务器读取 `data/prefs.json` 后直接写进 HTML。
 *      这是权威来源：不依赖 localStorage，因此不受「端口漂移」与
 *      「localhost / 127.0.0.1 双入口」影响。
 *   2. localStorage —— 服务器不可用时的本地兜底，也让切换立刻生效。
 *   3. 系统偏好 —— 首次访问的默认值。
 */
const PREF_ATTR = "data-theme-pref";
const RESOLVED_ATTR = "data-theme";
const STORAGE_KEY = "wb-theme";

const listeners = new Set<() => void>();
let mediaQuery: MediaQueryList | null = null;

function isSetting(value: unknown): value is ThemeSetting {
  return value === "light" || value === "dark" || value === "system";
}

function systemTheme(): Theme {
  if (!mediaQuery) mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  return mediaQuery.matches ? "dark" : "light";
}

/** 用户当前的选择（不是解析后的主题）。 */
export function getSetting(): ThemeSetting {
  const attr = document.documentElement.getAttribute(PREF_ATTR);
  if (isSetting(attr)) return attr;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isSetting(saved)) return saved;
  } catch {
    /* 隐私模式下 localStorage 可能抛错，忽略 */
  }
  return "system";
}

/** 把选择解析成实际主题。 */
export function resolveTheme(setting: ThemeSetting = getSetting()): Theme {
  return setting === "system" ? systemTheme() : setting;
}

/** 当前实际生效的主题。 */
export function getTheme(): Theme {
  const attr = document.documentElement.getAttribute(RESOLVED_ATTR);
  if (attr === "light" || attr === "dark") return attr;
  return resolveTheme();
}

/**
 * 落盘 + 应用到 DOM + 通知订阅者。
 *
 * `persist` 为 false 时只改本地（用于「跟随系统」时系统主题变化，
 * 那不需要把新值写回偏好）。
 */
function commit(setting: ThemeSetting, options: { persist?: boolean } = {}) {
  const root = document.documentElement;
  const resolved = resolveTheme(setting);
  root.setAttribute(PREF_ATTR, setting);
  root.setAttribute(RESOLVED_ATTR, resolved);
  if (options.persist !== false) {
    try {
      localStorage.setItem(STORAGE_KEY, setting);
    } catch {
      /* ignore */
    }
    // 写服务端失败不影响本次切换的观感，下次打开会退回系统主题。
    void savePrefs({ theme: setting }).catch(() => {});
  }
  listeners.forEach((fn) => fn());
}

/** 兼容旧调用点：等价于「切到指定主题」。 */
export function applyTheme(theme: Theme) {
  commit(theme);
}

/** 在「跟随系统」时，系统主题一变就跟着走。 */
function ensureSystemListener() {
  if (mediaQuery || typeof window.matchMedia !== "function") return;
  mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (getSetting() !== "system") return;
    const root = document.documentElement;
    root.setAttribute(RESOLVED_ATTR, resolveTheme("system"));
    listeners.forEach((fn) => fn());
  };
  if (typeof mediaQuery.addEventListener === "function") mediaQuery.addEventListener("change", onChange);
  else mediaQuery.addListener(onChange);
}

/**
 * 启动时把服务端的偏好拉回来覆盖本地。
 *
 * 只在「服务器给出了明确的非 system 值」时才覆盖：
 * 否则会与用户刚刚的本地选择打架（服务器还是旧值）。
 */
export async function hydrateThemeFromServer() {
  try {
    const prefs = await fetchPrefs();
    if (!isSetting(prefs?.theme)) return;
    const root = document.documentElement;
    // 服务器已经通过 HTML 注入同步过，值一致时不必再动 DOM。
    if (root.getAttribute(PREF_ATTR) === prefs.theme) return;
    commit(prefs.theme, { persist: false });
  } catch {
    /* 服务端不可用时保持本地值 */
  }
}

/** 全应用共享的主题状态（列表页 / 编辑器页同步）。 */
export function useTheme() {
  const [setting, setSetting] = useState<ThemeSetting>(() => getSetting());
  const [theme, setTheme] = useState<Theme>(() => getTheme());

  useEffect(() => {
    ensureSystemListener();
    const listener = () => {
      setSetting(getSetting());
      setTheme(getTheme());
    };
    listeners.add(listener);
    // 挂载后再对一次：首屏 HTML 注入可能还没被 React 读到
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const setThemeSetting = useCallback((next: ThemeSetting) => commit(next), []);
  /** 浅色 ↔ 深色：在「跟随系统」下会切到当前系统主题的反面。 */
  const toggle = useCallback(() => {
    commit(getTheme() === "dark" ? "light" : "dark");
  }, []);

  return { setting, theme, setSetting: setThemeSetting, toggle };
}
