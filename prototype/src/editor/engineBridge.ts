import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "../types";

/**
 * 引擎动作桥（ActionManager bridge）。
 *
 * ## 为什么需要它
 *
 * `@excalidraw/excalidraw@0.18.1` 在「当库用」的形态下没有提供任何执行内置动作的入口：
 *
 *   - 命令面板组件（产物里的 `VK`）定义了 `Ctrl+/` 监听与 `.command-palette-dialog`，
 *     但它**从未被挂载**——整个产物里只出现一次，就是它自己的定义；
 *   - 该组件与 `ActionManager` 都没有出现在包的公开导出里
 *     （`dist/types/excalidraw/index.d.ts` 里 `CommandPalette` / `useActionManager` 均不存在）；
 *   - `ExcalidrawImperativeAPI` 只有 `registerAction`，没有 `executeAction`。
 *
 * 唯一能拿到 `ActionManager` 的地方是 `ActionManager.handleKeyDown`：
 *
 *   handleKeyDown(event) → 命中**唯一**一个 keyTest → action.perform(elements, appState, event, app)
 *                                                                                          ↑ 第四个参数就是 App 实例
 *
 * 而 `App` 构造函数里有 `this.actionManager = new ActionManager(...)`，
 * 于是「注册一个哨兵动作 → 合成一次键盘事件把它触发 → 在 perform 里收下 app.actionManager」
 * 就成了一条确定性的通路。
 *
 * ## 代价与兜底
 *
 * 这是**对内部实现的结构性依赖**，所以：
 *   - 哨兵动作的 keyTest 用 `Ctrl+Alt+Shift+F12`（引擎内置动作全部是字母/数字，不会撞车）；
 *   - 引擎升级导致通路失效时 `getActionManager()` 返回 `null`，
 *     命令面板自动降级为「只显示外壳命令」，不报错、不影响任何已有功能；
 *   - `scripts/verify-browser.mjs` 有一条断言专门盯住这条通路。
 */

export type EngineAction = {
  name: string;
  label?:
    | string
    | ((elements: readonly unknown[], appState: unknown, app: unknown) => string);
  keywords?: readonly string[];
  predicate?: (...args: unknown[]) => boolean;
  viewMode?: boolean;
  icon?: unknown;
  perform?: (...args: unknown[]) => unknown;
};

export type EngineActionManager = {
  actions: Record<string, EngineAction>;
  executeAction: (action: EngineAction, source?: string) => void;
  isActionEnabled: (action: EngineAction) => boolean;
};

/** 哨兵动作名。刻意用 `wb-` 前缀，确保不会命中 `UIOptions.canvasActions` 里的同名开关。 */
const BRIDGE_ACTION_NAME = "wb-acquire-action-manager";

let manager: EngineActionManager | null = null;
let appInstance: unknown = null;
let registered = false;

/** 引擎的 App 实例（`action.label` 的函数形态会用到它作为第三个参数）。 */
export function getEngineApp(): unknown {
  return appInstance;
}

export function getActionManager(): EngineActionManager | null {
  return manager;
}

/**
 * 取回引擎的 ActionManager。失败返回 false（调用方可据此降级）。
 *
 * @param api  `excalidrawAPI` 回调给出来的命令式接口
 */
export function acquireActionManager(api: ExcalidrawImperativeAPI): boolean {
  if (manager) return true;

  if (!registered) {
    const bridge = {
      name: BRIDGE_ACTION_NAME,
      // label 只是占位：哨兵动作永远不会出现在任何 UI 里
      label: BRIDGE_ACTION_NAME,
      trackEvent: false,
      // 引擎内置动作的 keyTest 全是字母/数字，这个组合不可能撞车
      keyTest: (event: KeyboardEvent) =>
        event.key === "F12" && event.ctrlKey && event.altKey && event.shiftKey,
      perform: (
        _elements: unknown,
        _appState: unknown,
        _event: unknown,
        app: unknown
      ) => {
        const candidate = (app as { actionManager?: EngineActionManager } | null)
          ?.actionManager;
        if (candidate?.actions) {
          manager = candidate;
          appInstance = app;
        }
        // 必须回一个合法的 ActionResult：引擎的 syncActionResult 会直接读
        // `result.captureUpdate`，返回 null 会抛 TypeError（实测确认）。
        // NEVER = 不进撤销栈，且不携带 elements/appState，因此不产生任何状态变更。
        return { captureUpdate: CaptureUpdateAction.NEVER };
      },
    };
    try {
      api.registerAction(
        bridge as unknown as Parameters<ExcalidrawImperativeAPI["registerAction"]>[0]
      );
      registered = true;
    } catch {
      return false;
    }
  }

  // 引擎把 onKeyDown 绑在 `.excalidraw` 容器上（React 18 的委托监听挂在根容器），
  // 所以要在容器**内部**派发一个冒泡事件，而不是派发到 document。
  const target =
    document.querySelector<HTMLElement>(".excalidraw") ??
    document.querySelector<HTMLElement>(".wb-canvas");
  if (!target) return false;

  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "F12",
      code: "F12",
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
  );

  return manager !== null;
}

/** 执行一个引擎内置动作。管理器不可用时返回 false。 */
export function runEngineAction(name: string): boolean {
  if (!manager) return false;
  const action = manager.actions[name];
  if (!action) return false;
  try {
    // "commandPalette" 是引擎自己的来源标记，语义一致（命令面板触发）
    manager.executeAction(action, "commandPalette");
    return true;
  } catch {
    return false;
  }
}

/**
 * 切换「工具锁定」（引擎工具栏最右侧那个锁）。
 *
 * 为什么不用动作：引擎里没有 `toggleLock` 这个 Action，工具栏按钮直接调
 * `app.toggleLock()`。好消息是 `AppClassProperties.toggleLock` 是**公开类型成员**
 * （见 dist/types/excalidraw/types.d.ts），不像 `setState` / `openSidebar` 那样属于内部状态，
 * 所以这里可以直接调用，不需要再走哨兵动作那套。
 */
export function toggleEngineToolLock(): boolean {
  const app = appInstance as { toggleLock?: () => void } | null;
  if (typeof app?.toggleLock !== "function") return false;
  try {
    app.toggleLock();
    return true;
  } catch {
    return false;
  }
}
