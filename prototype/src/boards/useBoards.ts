import { useCallback, useEffect, useRef, useState } from "react";
import { describeApiError } from "../api";
import {
  createBoard,
  deleteBoard,
  duplicateBoard,
  listBoards,
  onBoardsChanged,
  renameBoard,
} from "../storage/boardRepo";
import type { Board } from "../types";

export function useBoards() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 合并并发刷新：一次新建/重命名/删除会同时收到「调用方自己的 refresh」和
  // 「broadcastBoardsChanged 触发的 refresh」，不去重就要打两遍列表接口、
  // 顺带两次列表重渲染。飞行中再来请求就记一笔，落地后再补一次，保证不丢变更。
  const inFlight = useRef<Promise<void> | null>(null);
  const trailing = useRef(false);

  const fetchOnce = useCallback(async () => {
    try {
      const list = await listBoards();
      setBoards(list);
      setError(null);
    } catch (err) {
      console.error("读取白板列表失败", err);
      setError(describeApiError(err));
    } finally {
      // 关键：无论成功失败都必须结束载入态，
      // 否则后端不可用时侧边栏会永远停在「正在载入…」
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlight.current) {
      trailing.current = true;
      return inFlight.current;
    }
    let task = fetchOnce();
    inFlight.current = task;
    try {
      await task;
      while (trailing.current) {
        trailing.current = false;
        task = fetchOnce();
        inFlight.current = task;
        await task;
      }
    } finally {
      inFlight.current = null;
    }
  }, [fetchOnce]);

  useEffect(() => {
    void refresh();
    // 其他标签页 / 同标签内的变更都会触发刷新
    const off = onBoardsChanged(() => {
      void refresh();
    });
    return off;
  }, [refresh]);

  /** 新建；失败返回 null（原因写入 error），调用方据此决定是否跳转 */
  const create = useCallback(
    async (name?: string): Promise<Board | null> => {
      try {
        const board = await createBoard(name);
        await refresh();
        return board;
      } catch (err) {
        console.error("新建白板失败", err);
        setError(describeApiError(err));
        return null;
      }
    },
    [refresh]
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      // 乐观更新
      setBoards((prev) => prev.map((b) => (b.id === id ? { ...b, name } : b)));
      try {
        await renameBoard(id, name);
        await refresh();
      } catch (err) {
        console.error("重命名失败", err);
        setError(describeApiError(err));
        await refresh(); // 拉回服务器真实状态，撤销乐观更新
      }
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      setBoards((prev) => prev.filter((b) => b.id !== id));
      try {
        await deleteBoard(id);
        await refresh();
      } catch (err) {
        console.error("删除失败", err);
        setError(describeApiError(err));
        await refresh();
      }
    },
    [refresh]
  );

  const duplicate = useCallback(
    async (id: string): Promise<Board | null> => {
      try {
        const copy = await duplicateBoard(id);
        await refresh();
        return copy;
      } catch (err) {
        console.error("复制失败", err);
        setError(describeApiError(err));
        return null;
      }
    },
    [refresh]
  );

  return {
    boards,
    loading,
    error,
    refresh,
    create,
    rename,
    remove,
    duplicate,
  };
}
