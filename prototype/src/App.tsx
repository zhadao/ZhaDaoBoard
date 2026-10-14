import { useCallback, useEffect, useState } from "react";
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Sidebar } from "./boards/Sidebar";
import { useBoards } from "./boards/useBoards";
import { BoardEditor } from "./editor/BoardEditor";
import { IconBoard } from "./icons";
import { hydrateThemeFromServer, useTheme } from "./theme";
import type { Board } from "./types";

const COLLAPSE_KEY = "wb-sidebar-collapsed";

/**
 * 单页外壳：小侧边栏（资源管理）常驻 + 主区大画布。
 * 仍保留 HashRouter 与 `/board/:id`，以便「在新标签页打开」直接进入某块白板。
 */
export function App() {
  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { boards, loading, error, refresh, create, rename, remove, duplicate } =
    useBoards();
  const { setting: themeSetting, theme, setSetting: setThemeSetting } = useTheme();

  // 首屏主题由服务器注入 HTML（data-theme-pref），这里只是「对账」：
  // 万一服务器值与本地的不同（例如换了端口 / 换了入口域名），以服务器为准。
  useEffect(() => {
    void hydrateThemeFromServer();
  }, []);

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggleSidebar = useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const activeId = location.pathname.startsWith("/board/")
    ? decodeURIComponent(location.pathname.slice("/board/".length))
    : null;

  const handleCreate = useCallback(async () => {
    try {
      const board = await create();
      // create 失败时返回 null，原因已写入 useBoards 的 error → 侧边栏横幅可见
      if (board) navigate(`/board/${board.id}`);
    } catch (err) {
      // 兜底：避免任何意外 reject 变成未捕获的 promise rejection
      console.error("新建白板失败", err);
    }
  }, [create, navigate]);

  const handleOpen = useCallback((id: string) => navigate(`/board/${id}`), [navigate]);
  const handleRetry = useCallback(() => void refresh(), [refresh]);

  // 这些回调都会透传到 <BoardEditor/>（memo）或侧边栏，必须是稳定引用，
  // 否则白板列表一变就会把整个 <Excalidraw/> 一起重渲染。
  const onToggleSidebar = toggleSidebar;
  const onSelectTheme = setThemeSetting;

  return (
    <div className="wb-shell">
      <Sidebar
        boards={boards}
        loading={loading}
        error={error}
        activeId={activeId}
        collapsed={collapsed}
        themeSetting={themeSetting}
        theme={theme}
        onOpen={handleOpen}
        onCreate={handleCreate}
        onRename={rename}
        onDelete={remove}
        onDuplicate={duplicate}
        onSelectTheme={onSelectTheme}
        onRetry={handleRetry}
      />

      <main className="wb-main">
        <Routes>
          <Route
            path="/"
            element={
              <HomeView
                boards={boards}
                loading={loading}
                error={error}
                onCreate={handleCreate}
                onRetry={handleRetry}
              />
            }
          />
          <Route
            path="/board/:id"
            element={<BoardEditor onToggleSidebar={onToggleSidebar} />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

/** 根路由：有白板则跳到最近更新的一块；没有则显示空状态 / 未连接状态 */
function HomeView({
  boards,
  loading,
  error,
  onCreate,
  onRetry,
}: {
  boards: Board[];
  loading: boolean;
  error: string | null;
  onCreate: () => void;
  onRetry: () => void;
}) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && boards.length > 0) {
      navigate(`/board/${boards[0].id}`, { replace: true });
    }
  }, [loading, boards, navigate]);

  if (loading) {
    return <div className="wb-loading">正在载入…</div>;
  }

  // 后端不可用且没有任何白板 → 明确告知，而不是显示「还没有白板」
  if (boards.length === 0 && error) {
    return (
      <div className="wb-empty">
        <IconBoard size={48} />
        <h2>未连接到本地服务</h2>
        <p>{error}</p>
        <button className="wb-btn wb-btn--secondary" onClick={onRetry}>
          重试连接
        </button>
      </div>
    );
  }

  if (boards.length > 0) {
    return <div className="wb-loading">正在载入…</div>;
  }

  return (
    <div className="wb-empty">
      <IconBoard size={48} />
      <h2>还没有白板</h2>
      <p>新建一块，开始你的第一张灵感板</p>
      <button className="wb-btn wb-btn--primary" onClick={onCreate}>
        新建白板
      </button>
    </div>
  );
}
