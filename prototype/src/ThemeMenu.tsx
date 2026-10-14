import { useEffect, useRef, useState } from "react";
import { IconCheck, IconMonitor, IconMoon, IconSun } from "./icons";
import type { Theme, ThemeSetting } from "./theme";

/**
 * 主题三态菜单（浅色 / 深色 / 跟随系统）。
 *
 * 顶栏与侧边栏共用同一份实现，保证「三个入口切的是同一个偏好」。
 * 触发器上显示的是**当前生效**的选择，而不是「点了会变成什么」——
 * 因为这里已经是显式选择（原来那个二态按钮才需要靠文案暗示目标态）。
 */

const OPTIONS: { value: ThemeSetting; label: string; hint: string }[] = [
  { value: "light", label: "浅色", hint: "画布与界面始终使用浅色" },
  { value: "dark", label: "深色", hint: "画布与界面始终使用深色" },
  { value: "system", label: "跟随系统", hint: "随操作系统外观自动切换" },
];

const LABEL: Record<ThemeSetting, string> = {
  light: "浅色主题",
  dark: "深色主题",
  system: "跟随系统",
};

function TriggerIcon({ setting, theme }: { setting: ThemeSetting; theme: Theme }) {
  if (setting === "system") return <IconMonitor />;
  return theme === "dark" ? <IconMoon /> : <IconSun />;
}

function useClickOutside<T extends HTMLElement>(active: boolean, onOutside: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOutside();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOutside();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [active, onOutside]);
  return ref;
}

export function ThemeMenu({
  setting,
  theme,
  onSelect,
  triggerClassName,
  showLabel = false,
  menuClassName = "",
}: {
  setting: ThemeSetting;
  theme: Theme;
  onSelect: (next: ThemeSetting) => void;
  /** 触发器按钮的 class（顶栏用 wb-btn wb-btn--icon，侧边栏用 wb-sidebar-theme） */
  triggerClassName: string;
  /** 触发器上是否附带文字（侧边栏需要，顶栏只要图标） */
  showLabel?: boolean;
  /** 额外菜单 class，例如 wb-menu--up */
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  const label = LABEL[setting];

  return (
    <div ref={ref} className="wb-theme-anchor">
      <button
        type="button"
        className={triggerClassName}
        onClick={() => setOpen((v) => !v)}
        aria-label={showLabel ? undefined : `主题：${label}`}
        title={showLabel ? `主题：${label}` : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <TriggerIcon setting={setting} theme={theme} />
        {showLabel && <span className="wb-theme-trigger-label">{label}</span>}
      </button>

      {open && (
        <div
          className={`wb-menu wb-theme-menu ${menuClassName}`.trim()}
          role="menu"
          aria-label="主题"
        >
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={setting === option.value}
              className="wb-menu-item wb-theme-menu-item"
              title={option.hint}
              onClick={() => {
                onSelect(option.value);
                setOpen(false);
              }}
            >
              {option.value === "light" ? (
                <IconSun />
              ) : option.value === "dark" ? (
                <IconMoon />
              ) : (
                <IconMonitor />
              )}
              {option.label}
              <IconCheck className="wb-menu-check" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
