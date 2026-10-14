// 包的 exports 将 /types 和 /element/types 映射到 dist/types/excalidraw 下的真实声明。
import type {
  AppState,
  BinaryFiles as ExcalidrawBinaryFiles,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export type {
  AppState,
  BinaryFileData,
  DataURL,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
export type { ExcalidrawElement, NonDeleted } from "@excalidraw/excalidraw/element/types";

export type Board = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string | null;
  elementCount: number;
};

/** 场景写入本机 data/boards/<id>.json，不包含选择、悬停等运行时状态。 */
export type StoredScene = Readonly<{
  elements: readonly ExcalidrawElement[];
  appState: Readonly<Partial<AppState>>;
}>;

export type BinaryFiles = ExcalidrawBinaryFiles;

/** latest 保留图片本体，保存失败或失去 lease 后仍可导出。 */
export type SceneSnapshot = StoredScene & Readonly<{
  files: Readonly<BinaryFiles>;
}>;

export type BoardDetail = Board & {
  scene: StoredScene;
  assets: { id: string; mimeType: string; ext: string }[];
  revision: number;
};

export type BoardLease = { owner: string; expiresAt: number };
export type SceneSaveResult = { revision: number; updatedAt: number; elementCount: number };
export type SaveStatus = "saved" | "saving" | "error" | "readonly";
