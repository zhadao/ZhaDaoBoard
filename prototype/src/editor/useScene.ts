import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, describeApiError } from "../api";
import {
  acquireBoardLease, loadSceneSnapshot, registerActiveOwner, releaseBoardLease,
  saveSceneSnapshot, uid, unregisterActiveOwner,
} from "../storage/boardRepo";
import type {
  AppState, BinaryFiles, ExcalidrawElement, ExcalidrawInitialDataState,
  SaveStatus, SceneSnapshot,
} from "../types";
import { createSaveQueue, pickAppState, sceneSignature } from "./saveQueue";

export type { SaveStatus } from "../types";
type Queue = ReturnType<typeof createSaveQueue<SceneSnapshot>>;
type Session = {
  boardId: string;
  owner: string;
  revision: number;
  expiresAt: number;
  hasLease: boolean;
  disposed: boolean;
  ready: boolean;
  queue: Queue;
  renewTimer: ReturnType<typeof setInterval> | null;
  expiryTimer: ReturnType<typeof setTimeout> | null;
};
type ViewState = {
  boardId: string;
  initialData: ExcalidrawInitialDataState | null;
  boardName: string;
  loading: boolean;
  error: string | null;
  saveStatus: SaveStatus;
  saveError: string | null;
  readOnly: boolean;
};
const emptyView = (boardId: string): ViewState => ({
  boardId, initialData: null, boardName: "", loading: true, error: null,
  saveStatus: "saved", saveError: null, readOnly: false,
});

// 同板重新挂载（包括 StrictMode）等待前一个会话 flush/release，避免自己抢自己的 lease。
const closing = new Map<string, Promise<void>>();
// 仅内存恢复，不把画板写入浏览器存储；切换后的失败快照也不会被下一次加载覆盖。
const unsaved = new Map<string, { snapshot: SceneSnapshot; revision: number }>();

export function useScene(boardId: string) {
  const [view, setView] = useState<ViewState>(() => emptyView(boardId));
  const sessionRef = useRef<Session | null>(null);
  const latest = useRef<SceneSnapshot | null>(null);

  useEffect(() => {
    const previousClose = closing.get(boardId);
    const session: Session = {
      boardId, owner: uid(), revision: 0, expiresAt: 0, hasLease: false,
      disposed: false, ready: false, queue: null as unknown as Queue,
      renewTimer: null, expiryTimer: null,
    };
    const isCurrent = () => !session.disposed && sessionRef.current === session;
    /**
     * 只在字段真的变了才换 state 对象。
     *
     * `onChange` 在拖拽期间每帧都会触发，而保存队列每次都会 emit 一次状态；
     * 如果这里无条件 `{...current, ...patch}`，就会让整个编辑器（含 <Excalidraw/>）
     * 每帧重渲染一次——这正是「拖起来发涩、点什么都要等一下」的来源。
     */
    const publish = (patch: Partial<ViewState>) => {
      if (!isCurrent()) return;
      setView((current) => {
        if (!isCurrent() || current.boardId !== boardId) return current;
        let changed = false;
        for (const key of Object.keys(patch) as (keyof ViewState)[]) {
          if (current[key] !== patch[key]) {
            changed = true;
            break;
          }
        }
        return changed ? { ...current, ...patch, boardId } : current;
      });
    };
    const stopRenewing = () => {
      if (session.renewTimer !== null) clearInterval(session.renewTimer);
      if (session.expiryTimer !== null) clearTimeout(session.expiryTimer);
      session.renewTimer = null;
      session.expiryTimer = null;
    };
    const loseLease = (cause: unknown) => {
      session.hasLease = false;
      stopRenewing();
      session.queue.setReadOnly(cause);
    };
    session.queue = createSaveQueue<SceneSnapshot>({
      signature: sceneSignature,
      save: async (snapshot, options) => {
        if (!session.hasLease || Date.now() >= session.expiresAt) {
          const cause = new ApiError("编辑租约已失效，已转为只读；未保存内容仍可导出", 423);
          loseLease(cause);
          throw cause;
        }
        try {
          const result = await saveSceneSnapshot(boardId, session.owner, session.revision, snapshot, options);
          session.revision = result.revision;
        } catch (cause) {
          // 409 不自动拉新 revision 重写服务器，必须恢复/重载；保留本地内容供导出。
          if (cause instanceof ApiError && (cause.status === 409 || cause.status === 423)) loseLease(cause);
          throw cause;
        }
      },
      onState: (state) => {
        if (state.dirty && state.snapshot) {
          unsaved.set(boardId, { snapshot: state.snapshot, revision: session.revision });
        } else if (!state.dirty) {
          unsaved.delete(boardId);
        }
        if (isCurrent()) latest.current = state.snapshot;
        publish({
          saveStatus: state.status,
          saveError: state.error ? describeApiError(state.error) : null,
          readOnly: state.status === "readonly",
        });
      },
    });
    sessionRef.current = session;
    latest.current = null;
    setView(emptyView(boardId));

    const setExpiry = (expiresAt: number) => {
      session.expiresAt = expiresAt;
      if (session.expiryTimer !== null) clearTimeout(session.expiryTimer);
      session.expiryTimer = setTimeout(() => {
        loseLease(new ApiError("编辑租约已到期，已转为只读；未保存内容仍可导出", 423));
      }, Math.max(0, expiresAt - Date.now()));
    };
    const acceptLease = (lease: { owner: string; expiresAt: number }) => {
      if (lease.owner !== session.owner || !Number.isFinite(lease.expiresAt) || lease.expiresAt <= Date.now()) {
        throw new ApiError("未取得有效编辑租约，请点击恢复重试", 423);
      }
      session.hasLease = true;
      // 让侧边栏的删除/恢复能复用本标签的 owner，同时阻止跨标签误删正在编辑的白板。
      registerActiveOwner(boardId, session.owner);
      setExpiry(lease.expiresAt);
    };
    const startRenewing = () => {
      let renewing = false;
      session.renewTimer = setInterval(() => {
        if (renewing || !session.hasLease) return;
        if (Date.now() >= session.expiresAt) {
          loseLease(new ApiError("编辑租约已到期，已转为只读；未保存内容仍可导出", 423));
          return;
        }
        renewing = true;
        void acquireBoardLease(boardId, session.owner)
          .then((lease) => {
            // 续约失败/本地到期以后不悄悄恢复可编辑状态。
            if (session.hasLease) acceptLease(lease);
          })
          .catch((cause: unknown) => {
            loseLease(new ApiError(`${describeApiError(cause)}；续约失败，已转为只读，未保存内容仍可导出`, cause instanceof ApiError ? cause.status : 0));
          })
          .finally(() => { renewing = false; });
      }, 10_000);
    };

    const initialize = (async () => {
      await previousClose;
      if (session.disposed) return;
      try {
        acceptLease(await acquireBoardLease(boardId, session.owner));
        startRenewing();
      } catch (cause) {
        if (cause instanceof ApiError && (cause.status === 409 || cause.status === 423)) {
          loseLease(cause);
        } else {
          throw cause;
        }
      }
      if (session.disposed) return;
      const { board, snapshot } = await loadSceneSnapshot(boardId);
      if (session.disposed) return;
      const recovered = unsaved.get(boardId);
      session.revision = recovered?.revision ?? board.revision;
      session.queue.initialize(snapshot);
      if (recovered) {
        session.queue.restore(recovered.snapshot, new ApiError("已恢复未保存内容，请点击重试保存；也可导出当前内容"));
        if (recovered.revision !== board.revision) {
          loseLease(new ApiError("服务器版本已变化，未保存快照已保留供导出；不会覆盖服务器内容", 409));
        }
      }
      session.ready = true;
      const visibleSnapshot = recovered?.snapshot ?? snapshot;
      latest.current = visibleSnapshot;
      const state = session.queue.state();
      publish({
        initialData: {
          elements: visibleSnapshot.elements,
          appState: visibleSnapshot.appState,
          files: { ...visibleSnapshot.files },
        },
        boardName: board.name, loading: false, error: null,
        saveStatus: state.status, saveError: state.error ? describeApiError(state.error) : null,
        readOnly: !session.hasLease,
      });
    })().catch((cause: unknown) => {
      stopRenewing();
      if (isCurrent()) {
        latest.current = unsaved.get(boardId)?.snapshot ?? null;
        publish({ loading: false, error: describeApiError(cause), initialData: null });
      }
      if (session.hasLease) {
        session.hasLease = false;
        return releaseBoardLease(boardId, session.owner).catch(() => {});
      }
    });

    const backgroundFlush = () => {
      if (session.ready && session.queue.state().status !== "error") void session.queue.flush({ keepalive: true });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") backgroundFlush();
      else if (session.hasLease && Date.now() >= session.expiresAt) {
        loseLease(new ApiError("编辑租约已到期，已转为只读；未保存内容仍可导出", 423));
      }
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      backgroundFlush();
      // 普通关闭不能保证异步请求完成，大图片不会强行使用 keepalive；dirty 时请求浏览器确认。
      if (session.queue.state().dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", backgroundFlush);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      session.disposed = true;
      session.queue.cancelTimer();
      unregisterActiveOwner(boardId, session.owner);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", backgroundFlush);
      window.removeEventListener("beforeunload", onBeforeUnload);
      // 清理时仍保持续约，等待全部 dirty 保存完成才释放 lease；回调不更新新画板的 state。
      const finish = (async () => {
        await initialize;
        await session.queue.flush();
        stopRenewing();
        try {
          // 即使本地曾标记续约失败，也尝试释放自己的 owner；服务器不允许释放别人的 lease。
          await releaseBoardLease(boardId, session.owner);
        } catch {
          // 释放失败由服务器 45 秒到期回收，不产生未处理 rejection。
        }
      })().catch(() => { stopRenewing(); });
      closing.set(boardId, finish);
      void finish.then(() => {
        if (closing.get(boardId) === finish) closing.delete(boardId);
      });
    };
  }, [boardId]);

  const flush = useCallback((): Promise<boolean> => {
    const session = sessionRef.current;
    if (!session || session.boardId !== boardId || session.disposed || !session.ready) return Promise.resolve(false);
    return session.queue.flush();
  }, [boardId]);
  const scheduleSave = useCallback((
    elements: readonly ExcalidrawElement[],
    appState: Readonly<Partial<AppState>>,
    files: Readonly<BinaryFiles>,
  ) => {
    const session = sessionRef.current;
    if (!session || session.boardId !== boardId || session.disposed || !session.ready || !session.hasLease) return;
    if (Date.now() >= session.expiresAt) {
      session.hasLease = false;
      session.queue.setReadOnly(new ApiError("编辑租约已到期，已转为只读；未保存内容仍可导出", 423));
      return;
    }
    session.queue.schedule({ elements: [...elements], appState: pickAppState(appState), files: { ...files } });
  }, [boardId]);

  const currentView = view.boardId === boardId ? view : emptyView(boardId);
  const { initialData, boardName, loading, error, saveStatus, saveError, readOnly } = currentView;
  return { initialData, boardName, loading, error, saveStatus, saveError, readOnly, scheduleSave, latest, flush };
}
