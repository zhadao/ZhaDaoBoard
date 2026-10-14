import type { AppState, BinaryFileData, SceneSnapshot } from "../types.ts";

export const APP_STATE_KEYS = [
  "viewBackgroundColor", "currentItemStrokeColor", "currentItemBackgroundColor",
  "currentItemFillStyle", "currentItemStrokeWidth", "currentItemStrokeStyle",
  "currentItemRoughness", "currentItemOpacity", "currentItemFontFamily",
  "currentItemFontSize", "currentItemTextAlign", "currentItemArrowType",
  "currentItemRoundness", "currentItemStartArrowhead", "currentItemEndArrowhead",
  "gridSize", "gridStep", "gridModeEnabled", "objectsSnapModeEnabled", "zenModeEnabled",
  "scrollX", "scrollY", "zoom",
] as const satisfies readonly (keyof AppState)[];

export function pickAppState(appState: Readonly<Partial<AppState>>): Partial<AppState> {
  return Object.fromEntries(APP_STATE_KEYS
    .filter((key) => appState[key] !== undefined)
    .map((key) => [key, key === "zoom" && appState.zoom ? { ...appState.zoom } : appState[key]]));
}

/** 忽略 lastRetrieved 等运行时字段，内容变化即使长度相同也必须重传。 */
export function fileSignature(file: BinaryFileData): string {
  return JSON.stringify([file.id, file.mimeType, file.version ?? 0, file.dataURL]);
}

/** 元素由 Excalidraw 保证不可变且变更递增 version；选择及悬停不计入签名。 */
export function sceneSignature(snapshot: SceneSnapshot): string {
  return JSON.stringify([
    snapshot.elements.map((element) => [
      element.id, element.version, element.versionNonce, element.isDeleted, element.index,
      element.type === "image" ? element.fileId : null,
    ]),
    pickAppState(snapshot.appState),
    Object.keys(snapshot.files).sort().map((id) => [id, fileSignature(snapshot.files[id])]),
  ]);
}

export type QueueState<T> = {
  status: "saved" | "saving" | "error" | "readonly";
  error: unknown | null;
  dirty: boolean;
  snapshot: T | null;
};
export type FlushOptions = { keepalive?: boolean };

/** 单写入者队列：保存期间合并为最新快照，失败保留 dirty，仅显式 flush 重试。 */
export function createSaveQueue<T>(options: {
  save: (snapshot: T, options: FlushOptions) => Promise<void>;
  signature: (snapshot: T) => string;
  onState?: (state: QueueState<T>) => void;
  debounceMs?: number;
}) {
  let current: { snapshot: T; signature: string } | null = null;
  let savedSignature: string | null = null;
  let readOnly = false;
  let error: unknown | null = null;
  let running: Promise<boolean> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushOptions: FlushOptions = {};
  const dirty = () => current !== null && current.signature !== savedSignature;
  const state = (): QueueState<T> => ({
    status: readOnly ? "readonly" : error ? "error" : dirty() || running ? "saving" : "saved",
    error, dirty: dirty(), snapshot: current?.snapshot ?? null,
  });
  const emit = () => options.onState?.(state());
  const cancelTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const flush = (nextOptions: FlushOptions = {}): Promise<boolean> => {
    cancelTimer();
    flushOptions = { keepalive: flushOptions.keepalive || nextOptions.keepalive };
    if (running) return running;
    if (readOnly) return Promise.resolve(!dirty());
    if (!dirty()) {
      error = null;
      emit();
      return Promise.resolve(true);
    }
    error = null;
    running = Promise.resolve().then(async () => {
      while (current && dirty() && !readOnly) {
        const next = current;
        try {
          await options.save(next.snapshot, flushOptions);
          savedSignature = next.signature;
        } catch (cause) {
          error = cause;
          cancelTimer();
          return false;
        }
      }
      return !dirty();
    }).finally(() => {
      running = null;
      flushOptions = {};
      emit();
    });
    emit();
    return running;
  };
  return {
    state,
    flush,
    cancelTimer,
    initialize(snapshot: T) {
      if (running) throw new Error("保存期间不能替换场景基线");
      cancelTimer();
      current = { snapshot, signature: options.signature(snapshot) };
      savedSignature = current.signature;
      if (!readOnly) error = null;
      emit();
    },
    restore(snapshot: T, cause?: unknown) {
      cancelTimer();
      current = { snapshot, signature: options.signature(snapshot) };
      if (!readOnly && cause) error = cause;
      emit();
    },
    schedule(snapshot: T): boolean {
      if (readOnly) return false;
      const signature = options.signature(snapshot);
      if (signature === current?.signature) return false;
      current = { snapshot, signature };
      cancelTimer();
      // 失败后即使继续编辑也不悄悄自动重试，用户可显式 flush 最新内容。
      if (!running && dirty() && !error) {
        timer = setTimeout(() => { void flush(); }, options.debounceMs ?? 500);
      }
      emit();
      return true;
    },
    setReadOnly(cause: unknown) {
      readOnly = true;
      error = cause;
      cancelTimer();
      emit();
    },
  };
}
