import type {
  BinaryFileData, BinaryFiles, Board, BoardDetail, BoardLease, DataURL,
  SceneSaveResult, SceneSnapshot,
} from "../types";
import { ApiError, apiRequest, apiUrl, requestJson } from "../api.ts";
import { fileSignature } from "../editor/saveQueue.ts";

export type { BoardDetail } from "../types";
const API = apiUrl("/api");
const boardUrl = (id: string) => `${API}/boards/${encodeURIComponent(id)}`;
const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function blobToDataURL(blob: Blob): Promise<DataURL> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as DataURL);
    reader.onerror = () => reject(new ApiError("图片读取失败，请重试；不会覆盖原场景"));
    reader.readAsDataURL(blob);
  });
}

const localBus = new EventTarget();
let channel: BroadcastChannel | null = null;
try {
  if (typeof BroadcastChannel !== "undefined") channel = new BroadcastChannel("whiteboard-sync");
} catch {
  channel = null;
}
export function broadcastBoardsChanged() {
  channel?.postMessage({ type: "boards-changed", at: Date.now() });
  localBus.dispatchEvent(new Event("boards-changed"));
}
export function onBoardsChanged(cb: () => void): () => void {
  const localHandler = () => cb();
  const channelHandler = (event: MessageEvent) => {
    if (event.data?.type === "boards-changed") cb();
  };
  localBus.addEventListener("boards-changed", localHandler);
  channel?.addEventListener("message", channelHandler);
  return () => {
    localBus.removeEventListener("boards-changed", localHandler);
    channel?.removeEventListener("message", channelHandler);
  };
}

export async function listBoards(): Promise<Board[]> {
  const list = await requestJson<Board[]>(`${API}/boards`);
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function getBoard(id: string): Promise<BoardDetail | undefined> {
  try {
    const board = await requestJson<BoardDetail>(boardUrl(id));
    return { ...board, revision: board.revision ?? 0 };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return undefined;
    throw error;
  }
}
// 服务器只接受 name/thumbnail/elementCount，updatedAt 由服务器自己维护。
export async function saveBoard(board: Board): Promise<void> {
  const { name, thumbnail, elementCount } = board;
  await requestJson(boardUrl(board.id), jsonInit("PUT", { name, thumbnail, elementCount }));
}
export async function createBoard(name?: string): Promise<Board> {
  const board = await requestJson<Board>(`${API}/boards`, jsonInit("POST", { name }));
  broadcastBoardsChanged();
  return board;
}
export async function renameBoard(id: string, name: string): Promise<void> {
  await requestJson(boardUrl(id), jsonInit("PUT", { name }));
  broadcastBoardsChanged();
}

/**
 * 正在本应用内打开的编辑会话 owner。
 * 删除当前打开的白板时复用它，服务器才允许通过租约校验；
 * 白板正被「另一个标签页」编辑时 owner 不同，删除会被服务器拒绝（409/423）。
 *
 * 注：以前这里还服务于「恢复上一版本」，该入口已按需求撤掉（见 README「数据目录」）。
 * 服务器的 `POST /api/boards/:id/restore` 仍然在，`data/backups/` 也照旧每次保存前留快照，
 * 只是改由人工从 `data/backups/<id>.json` 取回，客户端不再有调用点。
 */
const activeOwners = new Map<string, string>();
export function registerActiveOwner(id: string, owner: string): void {
  activeOwners.set(id, owner);
}
export function unregisterActiveOwner(id: string, owner: string): void {
  if (activeOwners.get(id) === owner) activeOwners.delete(id);
}
const ownerFor = (id: string) => activeOwners.get(id) ?? uid();

export async function deleteBoard(id: string): Promise<void> {
  await requestJson(boardUrl(id), { ...jsonInit("DELETE", { owner: ownerFor(id) }), keepalive: true });
  uploaded.delete(id);
  broadcastBoardsChanged();
}
export async function duplicateBoard(id: string): Promise<Board | null> {
  try {
    const board = await requestJson<Board>(`${boardUrl(id)}/duplicate`, jsonInit("POST", {}));
    broadcastBoardsChanged();
    return board;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
export async function updateBoardMeta(
  id: string,
  patch: Partial<Pick<Board, "elementCount" | "thumbnail">>,
): Promise<void> {
  const { elementCount, thumbnail } = patch;
  await requestJson(boardUrl(id), jsonInit("PUT", { elementCount, thumbnail }));
}
export async function updateBoardThumbnail(id: string, thumbnail: string | null, elementCount: number): Promise<void> {
  await updateBoardMeta(id, { thumbnail, elementCount });
  broadcastBoardsChanged();
}

export async function acquireBoardLease(id: string, owner: string): Promise<BoardLease> {
  return requestJson(`${boardUrl(id)}/lease`, jsonInit("POST", { owner }));
}
export async function releaseBoardLease(id: string, owner: string, keepalive = false): Promise<void> {
  await requestJson(`${boardUrl(id)}/lease`, { ...jsonInit("DELETE", { owner }), keepalive });
}

// 缓存必须按画板隔离，且只记录已成功提交的图片内容，失败不能跳过后续重传。
const uploaded = new Map<string, Map<string, string>>();

/** 只读取一次 BoardDetail，再加载该快照列出的全部图片；任何缺图都使加载失败。 */
export async function loadSceneSnapshot(id: string): Promise<{ board: BoardDetail; snapshot: SceneSnapshot }> {
  const board = await getBoard(id);
  if (!board) throw new ApiError("画板不存在，可能已被删除", 404);
  if (!board.scene || !Array.isArray(board.scene.elements) || !board.scene.appState || !Array.isArray(board.assets)) {
    throw new ApiError("画板快照不完整，不会用空白场景覆盖，请重试");
  }
  const entries = await Promise.all(board.assets.map(async (asset): Promise<[string, BinaryFileData]> => {
    try {
      const blob = await apiRequest(apiUrl(`/assets/${encodeURIComponent(asset.id)}`), undefined, (response) => response.blob());
      if (!blob.size) throw new ApiError("图片为空");
      return [asset.id, {
        id: asset.id as BinaryFileData["id"],
        mimeType: asset.mimeType as BinaryFileData["mimeType"],
        dataURL: await blobToDataURL(blob),
        created: board.createdAt,
      }];
    } catch (error) {
      throw new ApiError(`图片 ${asset.id} 加载失败，不会覆盖原场景，请重试`, error instanceof ApiError ? error.status : 0);
    }
  }));
  const files: BinaryFiles = Object.fromEntries(entries);
  for (const element of board.scene.elements) {
    if (element.type === "image" && element.fileId && !Object.prototype.hasOwnProperty.call(files, element.fileId)) {
      throw new ApiError(`画板缺少图片 ${element.fileId}，不会覆盖原场景，请重试`, 404);
    }
  }
  uploaded.delete(id);
  return { board, snapshot: { ...board.scene, files } };
}

/** 场景和引用文件同一个 JSON 事务提交；已确认且内容未变的文件可省略。 */
export async function saveSceneSnapshot(
  id: string,
  owner: string,
  revision: number,
  snapshot: SceneSnapshot,
  options: { keepalive?: boolean } = {},
): Promise<SceneSaveResult> {
  const confirmed = uploaded.get(id) ?? new Map<string, string>();
  const references = new Set<string>();
  for (const element of snapshot.elements) {
    if (element.type === "image" && element.fileId) references.add(element.fileId);
  }
  const entries: [string, BinaryFileData][] = [];
  const signatures = new Map<string, string>();
  for (const fileId of references) {
    const file = Object.prototype.hasOwnProperty.call(snapshot.files, fileId) ? snapshot.files[fileId] : undefined;
    if (!file?.dataURL || file.id !== fileId || !file.dataURL.startsWith("data:")) {
      throw new ApiError(`图片 ${fileId} 数据缺失，未保存；请重试或导出当前内容`, 400);
    }
    const signature = fileSignature(file);
    signatures.set(fileId, signature);
    if (confirmed.get(fileId) !== signature) entries.push([fileId, file]);
  }
  const init = jsonInit("PUT", {
    owner, revision,
    scene: { elements: snapshot.elements, appState: snapshot.appState },
    files: Object.fromEntries(entries),
  });
  // 浏览器 keepalive 总配额约 64KiB，留出请求头及同时在途请求空间。
  init.keepalive = Boolean(options.keepalive && new TextEncoder().encode(String(init.body)).byteLength <= 48 * 1024);
  const result = await requestJson<SceneSaveResult>(`${boardUrl(id)}/scene`, init);
  if (!result || !Number.isInteger(result.revision) || result.revision <= revision ||
      !Number.isFinite(result.updatedAt) || !Number.isFinite(result.elementCount)) {
    throw new ApiError("保存响应不完整，未确认成功；请重试或导出当前内容");
  }
  for (const [fileId, signature] of signatures) confirmed.set(fileId, signature);
  uploaded.set(id, confirmed);
  broadcastBoardsChanged();
  return result;
}
