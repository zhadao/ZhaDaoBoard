import { useMemo } from "react";
import { useHandleLibrary } from "@excalidraw/excalidraw";
import type { LibraryPersistenceAdapter } from "@excalidraw/excalidraw/data/library";
import type { LibraryItems } from "@excalidraw/excalidraw/types";
import type { ExcalidrawImperativeAPI } from "../types";

const ENDPOINT = "/api/library";

type StoredLibrary = { libraryItems?: LibraryItems };

/**
 * 把个人素材库落到本机 data/library.json（而不是浏览器内置存储）。
 *
 * 引擎公开导出了 `useHandleLibrary` + `LibraryPersistenceAdapter` 类型，
 * 这里只需实现 load/save；素材库的其余行为（拖拽、搜索、从画布添加、
 * 导入 .excalidrawlib）完全保持引擎原生实现。
 */
export function useLocalLibrary(excalidrawAPI: ExcalidrawImperativeAPI | null): void {
  const adapter = useMemo<LibraryPersistenceAdapter>(
    () => ({
      async load() {
        const response = await fetch(ENDPOINT, { headers: { accept: "application/json" } });
        if (!response.ok) throw new Error(`素材库读取失败（${response.status}）`);
        const data = (await response.json()) as StoredLibrary | null;
        return { libraryItems: Array.isArray(data?.libraryItems) ? data.libraryItems : [] };
      },
      async save({ libraryItems }) {
        const response = await fetch(ENDPOINT, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ libraryItems }),
        });
        if (!response.ok) throw new Error(`素材库保存失败（${response.status}）`);
      },
    }),
    []
  );

  // 引擎内部只依赖 excalidrawAPI 的引用，传入新对象是安全的（adapter 本身已 memo）。
  useHandleLibrary({ excalidrawAPI, adapter });
}
