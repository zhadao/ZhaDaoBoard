import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  IconBoard,
  IconCopy,
  IconExternal,
  IconMore,
  IconPencil,
  IconTrash,
} from "../icons";
import type { Board } from "../types";
import { boardUrl, formatTime } from "../utils";

type Props = {
  board: Board;
  active: boolean;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
};

const MENU_WIDTH = 180;

export function BoardRow({
  board,
  active,
  onOpen,
  onRename,
  onDelete,
  onDuplicate,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(board.name);

  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 菜单用 fixed 定位（侧边栏 overflow 会裁切 absolute 菜单）
  useLayoutEffect(() => {
    if (!menuOpen || !menuBtnRef.current) return;
    const rect = menuBtnRef.current.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8);
    setMenuPos({ top: rect.bottom + 4, left: Math.max(8, left) });
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !menuBtnRef.current?.contains(target) &&
        !(target as HTMLElement).closest?.(".wb-menu--floating")
      ) {
        setMenuOpen(false);
      }
    };
    const onScroll = () => setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  const commitRename = () => {
    const next = draft.trim();
    if (next && next !== board.name) onRename(board.id, next);
    setRenaming(false);
  };

  const startRename = () => {
    setDraft(board.name);
    setRenaming(true);
    setMenuOpen(false);
  };

  if (renaming) {
    return (
      <div className="wb-row wb-row--editing">
        <input
          ref={inputRef}
          className="wb-input wb-row-input"
          value={draft}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
        />
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="wb-row wb-row--confirming">
        <div className="wb-row-confirm">
          <span>删除「{board.name}」？此操作不可撤销</span>
          <div className="wb-row-confirm-actions">
            <button className="wb-btn wb-btn--ghost" onClick={() => setConfirming(false)}>
              取消
            </button>
            <button
              className="wb-btn wb-btn--danger"
              onClick={() => {
                onDelete(board.id);
                setConfirming(false);
              }}
            >
              删除
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`wb-row${active ? " wb-row--active" : ""}`}
      role="button"
      tabIndex={0}
      aria-current={active ? "page" : undefined}
      onClick={() => onOpen(board.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(board.id);
        }
      }}
    >
      <span className="wb-row-thumb">
        {board.thumbnail ? (
          <img src={board.thumbnail} alt="" />
        ) : (
          <IconBoard size={15} />
        )}
      </span>
      <span className="wb-row-text">
        <span className="wb-row-name" title={board.name}>
          {board.name}
        </span>
        <span className="wb-row-time">{formatTime(board.updatedAt)}</span>
      </span>

      <button
        ref={menuBtnRef}
        type="button"
        className="wb-row-menu-btn"
        data-open={menuOpen}
        aria-label="白板操作"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
      >
        <IconMore size={15} />
      </button>

      {menuOpen && (
        <div
          className="wb-menu wb-menu--floating"
          role="menu"
          style={{ top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="wb-menu-item" role="menuitem" onClick={() => onOpen(board.id)}>
            <IconBoard />
            打开
          </button>
          <button
            className="wb-menu-item"
            role="menuitem"
            onClick={() => {
              window.open(boardUrl(board.id), "_blank", "noopener");
              setMenuOpen(false);
            }}
          >
            <IconExternal />
            在新标签页打开
          </button>
          <button className="wb-menu-item" role="menuitem" onClick={startRename}>
            <IconPencil />
            重命名
          </button>
          <button
            className="wb-menu-item"
            role="menuitem"
            onClick={() => {
              onDuplicate(board.id);
              setMenuOpen(false);
            }}
          >
            <IconCopy />
            复制
          </button>
          <div className="wb-menu-sep" />
          <button
            className="wb-menu-item wb-menu-item--danger"
            role="menuitem"
            onClick={() => {
              setConfirming(true);
              setMenuOpen(false);
            }}
          >
            <IconTrash />
            删除
          </button>
        </div>
      )}
    </div>
  );
}
