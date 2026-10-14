import { useMemo, useState } from "react";
import { BoardRow } from "./BoardRow";
import { IconSearch } from "../icons";
import { ThemeMenu } from "../ThemeMenu";
import type { Theme, ThemeSetting } from "../theme";
import type { Board } from "../types";

type Props = {
  boards: Board[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  collapsed: boolean;
  themeSetting: ThemeSetting;
  theme: Theme;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onSelectTheme: (next: ThemeSetting) => void;
  onRetry: () => void;
};

export function Sidebar({
  boards,
  loading,
  error,
  activeId,
  collapsed,
  themeSetting,
  theme,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  onDuplicate,
  onSelectTheme,
  onRetry,
}: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return boards;
    return boards.filter((b) => b.name.toLowerCase().includes(q));
  }, [boards, query]);

  return (
    <aside
      className={`wb-sidebar${collapsed ? " wb-sidebar--collapsed" : ""}`}
      aria-hidden={collapsed}
    >
      <div className="wb-sidebar-inner">
        <header className="wb-sidebar-head">
          {/* 品牌标记：与 exe 图标、浏览器标签页图标同源（public/logo.svg） */}
          <img className="wb-brand-mark" src="/logo.svg" alt="" aria-hidden="true" />
          <span className="wb-sidebar-title">
            白板
            {!loading && boards.length > 0 && (
              <span className="wb-sidebar-count">{boards.length}</span>
            )}
          </span>
          <button
            className="wb-btn wb-btn--ghost wb-sidebar-new"
            onClick={onCreate}
            title="新建白板"
          >
            新建
          </button>
        </header>

        {error && (
          <div className="wb-sidebar-error" role="alert">
            <div className="wb-sidebar-error-text">{error}</div>
            <button
              className="wb-btn wb-btn--secondary wb-sidebar-error-retry"
              onClick={onRetry}
            >
              重试连接
            </button>
          </div>
        )}

        <div className="wb-sidebar-search">
          <IconSearch />
          <input
            className="wb-input"
            type="search"
            placeholder="搜索白板"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="wb-sidebar-list">
          {loading ? (
            <div className="wb-sidebar-hint">正在载入…</div>
          ) : boards.length === 0 ? (
            <div className="wb-sidebar-hint">
              {error ? "未连接到本地服务" : "还没有白板"}
            </div>
          ) : filtered.length === 0 ? (
            <div className="wb-sidebar-hint">没有匹配的白板</div>
          ) : (
            filtered.map((board) => (
              <BoardRow
                key={board.id}
                board={board}
                active={board.id === activeId}
                onOpen={onOpen}
                onRename={onRename}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
              />
            ))
          )}
        </div>

        <footer className="wb-sidebar-foot">
          <ThemeMenu
            setting={themeSetting}
            theme={theme}
            onSelect={onSelectTheme}
            triggerClassName="wb-sidebar-theme"
            showLabel
            menuClassName="wb-menu--up"
          />
        </footer>
      </div>
    </aside>
  );
}
