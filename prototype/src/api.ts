/** 开发由 Vite 代理 /api 与 /assets，EXE 由本地服务托管，始终同源。 */
export const API_BASE = "";
export const apiUrl = (path: string): string => `${API_BASE}${path}`;

export const CONNECTION_HINT =
  "本地服务未连接 · 请双击 WhiteBoard.exe，或运行 npm run dev";

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const STATUS_MESSAGES: Record<number, string> = {
  400: "请求数据无效，请检查画板及图片数据",
  404: "画板或图片不存在，可能已被删除",
  409: "画板正被其他标签编辑，或保存版本已发生冲突",
  413: "画板或图片过大，无法保存",
  423: "编辑租约已失效，已转为只读；未保存内容仍可导出",
  500: "本地服务保存失败，请重试；未保存内容仍保留",
  502: CONNECTION_HINT,
  503: CONNECTION_HINT,
  504: "本地服务响应超时，请重试",
};

/** 超时覆盖 fetch 和响应体读取，保留 HTTP status，不向用户暴露英文服务器堆栈。 */
export async function apiRequest<T>(
  input: string,
  init: RequestInit | undefined,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (init?.signal?.aborted) abort();
  init?.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 30_000);
  let status = 0;
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    status = response.status;
    if (!response.ok) {
      let detail = "";
      try {
        const body: unknown = await response.json();
        if (body && typeof body === "object") {
          const payload = body as { error?: unknown; message?: unknown };
          const value = payload.message ?? payload.error;
          if (typeof value === "string" && /[\u3400-\u9fff]/.test(value)) detail = value;
        }
      } catch {
        // 非 JSON 错误页使用状态码对应的中文提示。
      }
      throw new ApiError(detail || STATUS_MESSAGES[status] || `本地服务请求失败（${status}），请重试`, status);
    }
    return await read(response);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) throw new ApiError("请求超过 30 秒，请重试；未保存内容仍保留", status);
    if (controller.signal.aborted) throw new ApiError("请求已取消，未保存内容仍保留", status);
    if (error instanceof TypeError) throw new ApiError(CONNECTION_HINT, status);
    throw new ApiError("本地服务返回的数据无法读取，请重试", status);
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", abort);
  }
}

export function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  return apiRequest(input, init, async (response) => {
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  });
}

export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  const detail = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|networkerror|load failed|fetch failed|econnrefused/i.test(detail)) {
    return CONNECTION_HINT;
  }
  return /[\u3400-\u9fff]/.test(detail) ? detail : "操作失败，请重试；未保存内容仍保留";
}

/* ---------------- 界面偏好（服务端 data/prefs.json） ----------------
   主题偏好放服务端而不是只放浏览器本地存储：本地存储按「协议 + 主机 + 端口」
   隔离，端口漂移或换用 localhost 都会让偏好静默丢失。 */

export type ThemeSetting = "light" | "dark" | "system";

export function fetchPrefs(): Promise<{ theme?: ThemeSetting }> {
  return requestJson<{ theme?: ThemeSetting }>(apiUrl("/api/prefs"), { cache: "no-store" });
}

export function savePrefs(prefs: { theme: ThemeSetting }): Promise<unknown> {
  return requestJson(apiUrl("/api/prefs"), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(prefs),
  });
}
