import { useEffect, useRef, useState } from "react";
import {
  IconCode,
  IconDots,
  IconDownload,
  IconExternal,
  IconFileJson,
  IconImage,
  IconMore,
  IconPanelLeft,
  IconSnap,
  IconUpload,
} from "../icons";
import { ThemeMenu } from "../ThemeMenu";
import type { Theme, ThemeSetting } from "../theme";
import { DOT_SIZES, SNAP_LABEL, type SnapMode, type ViewPrefs } from "../viewPrefs";
import type { SaveStatus } from "./useScene";

type Props = {
  name: string;
  saveStatus: SaveStatus;
  saveError: string | null;
  readOnly: boolean;
  themeSetting: ThemeSetting;
  theme: Theme;
  view: ViewPrefs;
  onToggleSidebar: () => void;
  onRename: (name: string) => void;
  onSelectTheme: (next: ThemeSetting) => void;
  onRetrySave: () => void;
  onExportPNG: () => void;
  onExportSVG: () => void;
  onExportExcalidraw: () => void;
  onImport: () => void;
  onOpenNewTab: () => void;
  onChangeView: (patch: Partial<ViewPrefs>) => void;
};

const SIZE_LABEL: Record<number, string> = { 16: "小", 20: "中", 28: "大" };

const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: "已保存",
  saving: "保存中",
  error: "保存失败",
  readonly: "只读",
};

function useClickOutside<T extends HTMLElement>(
  active: boolean,
  onOutside: () => void
) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [active, onOutside]);
  return ref;
}

export function TopBar({
  name,
  saveStatus,
  saveError,
  readOnly,
  themeSetting,
  theme,
  view,
  onToggleSidebar,
  onRename,
  onSelectTheme,
  onRetrySave,
  onExportPNG,
  onExportSVG,
  onExportExcalidraw,
  onImport,
  onOpenNewTab,
  onChangeView,
}: Props) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [exportOpen, setExportOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);

  const exportRef = useClickOutside<HTMLDivElement>(exportOpen, () =>
    setExportOpen(false)
  );
  const moreRef = useClickOutside<HTMLDivElement>(moreOpen, () =>
    setMoreOpen(false)
  );
  const viewRef = useClickOutside<HTMLDivElement>(viewOpen, () =>
    setViewOpen(false)
  );
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(name);
  }, [name]);

  useEffect(() => {
    if (renaming) nameInputRef.current?.select();
  }, [renaming]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== name) onRename(next);
    else setDraft(name);
    setRenaming(false);
  };

  return (
    <header className="wb-topbar">
      <div className="wb-topbar-left">
        <button
          className="wb-btn wb-btn--icon"
          onClick={onToggleSidebar}
          aria-label="显示 / 隐藏侧边栏"
          title="显示 / 隐藏侧边栏"
        >
          <IconPanelLeft />
        </button>

        {renaming ? (
          <input
            ref={nameInputRef}
            className="wb-input wb-board-name-input"
            value={draft}
            maxLength={80}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <button
            className="wb-board-name"
            onClick={() => setRenaming(true)}
            title="点击重命名"
          >
            {name}
          </button>
        )}

        {saveStatus === "error" ? (
          <button
            type="button"
            className="wb-save-dot wb-save-dot--action"
            data-state={saveStatus}
            title={saveError ?? "保存失败，点击重试"}
            onClick={onRetrySave}
          >
            <span className="dot" />
            {SAVE_LABEL[saveStatus]}
            <span className="wb-save-dot-retry">重试</span>
          </button>
        ) : (
          <span
            className="wb-save-dot"
            data-state={saveStatus}
            title={
              saveError ??
              (readOnly
                ? "该白板已在其他标签页打开，当前为只读"
                : SAVE_LABEL[saveStatus])
            }
          >
            <span className="dot" />
            {SAVE_LABEL[saveStatus]}
          </span>
        )}
      </div>

      <div className="wb-topbar-right">
        <div ref={viewRef} style={{ position: "relative" }}>
          <button
            className="wb-btn wb-btn--icon"
            aria-label="视图设置"
            title="视图设置：点阵 / 吸附"
            aria-haspopup="dialog"
            aria-expanded={viewOpen}
            onClick={() => {
              setViewOpen((v) => !v);
              setExportOpen(false);
              setMoreOpen(false);
            }}
          >
            <IconDots />
          </button>
          {viewOpen && (
            <div className="wb-menu wb-view-menu" role="dialog" aria-label="视图设置">
              <label className="wb-view-row">
                <span className="wb-view-label">
                  <IconDots />
                  点阵背景
                </span>
                <input
                  type="checkbox"
                  className="wb-switch"
                  checked={view.dots}
                  onChange={(e) => onChangeView({ dots: e.target.checked })}
                />
              </label>

              <label className="wb-view-row">
                <span className="wb-view-label">
                  <IconSnap />
                  吸附
                </span>
                <select
                  className="wb-select"
                  value={view.snap}
                  onChange={(e) => onChangeView({ snap: e.target.value as SnapMode })}
                >
                  {(Object.keys(SNAP_LABEL) as SnapMode[]).map((mode) => (
                    <option key={mode} value={mode}>
                      {SNAP_LABEL[mode]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="wb-view-row">
                <span className="wb-view-label">点阵间距</span>
                <select
                  className="wb-select"
                  value={view.size}
                  onChange={(e) => onChangeView({ size: Number(e.target.value) })}
                >
                  {DOT_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {SIZE_LABEL[size]}（{size}）
                    </option>
                  ))}
                </select>
              </label>

              <p className="wb-view-hint">
                点阵显示与吸附相互独立。「点阵节点」对齐到点阵交点，「对象边缘」对齐到其他图形的边。
              </p>
            </div>
          )}
        </div>

        <ThemeMenu
          setting={themeSetting}
          theme={theme}
          onSelect={onSelectTheme}
          triggerClassName="wb-btn wb-btn--icon"
        />

        <div ref={exportRef} style={{ position: "relative" }}>
          <button
            className="wb-btn wb-btn--secondary"
            aria-haspopup="menu"
            aria-expanded={exportOpen}
            onClick={() => {
              setExportOpen((v) => !v);
              setMoreOpen(false);
            }}
          >
            <IconDownload />
            导出
          </button>
          {exportOpen && (
            <div className="wb-menu" role="menu">
              <button
                className="wb-menu-item"
                role="menuitem"
                onClick={() => {
                  onExportPNG();
                  setExportOpen(false);
                }}
              >
                <IconImage />
                导出 PNG
              </button>
              <button
                className="wb-menu-item"
                role="menuitem"
                onClick={() => {
                  onExportSVG();
                  setExportOpen(false);
                }}
              >
                <IconCode />
                导出 SVG
              </button>
              <button
                className="wb-menu-item"
                role="menuitem"
                onClick={() => {
                  onExportExcalidraw();
                  setExportOpen(false);
                }}
              >
                <IconFileJson />
                导出 .excalidraw
              </button>
            </div>
          )}
        </div>

        <div ref={moreRef} style={{ position: "relative" }}>
          <button
            className="wb-btn wb-btn--icon"
            aria-label="更多"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => {
              setMoreOpen((v) => !v);
              setExportOpen(false);
            }}
          >
            <IconMore />
          </button>
          {moreOpen && (
            <div className="wb-menu" role="menu">
              <button
                className="wb-menu-item"
                role="menuitem"
                onClick={() => {
                  onImport();
                  setMoreOpen(false);
                }}
              >
                <IconUpload />
                导入 .excalidraw
              </button>
              <button
                className="wb-menu-item"
                role="menuitem"
                onClick={() => {
                  onOpenNewTab();
                  setMoreOpen(false);
                }}
              >
                <IconExternal />
                在新标签页打开
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
