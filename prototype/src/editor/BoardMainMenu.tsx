import { MainMenu } from "@excalidraw/excalidraw";
import { IconSearch } from "../icons";
import { PALETTE_SHORTCUT } from "./engineCommands";
import type { ThemeSetting } from "../theme";

/**
 * 自建主菜单：只保留纯本地能力。
 *
 * 相比引擎默认菜单，剔除了所有联网/无关入口：
 *   - Socials            → GitHub / X / Discord 外链
 *   - LiveCollaboration  → 实时协作（需要远端 WebSocket）
 *   - SaveToActiveFile   → 浏览器文件句柄保存，与本地服务落盘语义冲突
 *   - ChangeCanvasBackground → 画布底色固定透明（点阵层需要），故移除
 *
 * 另外两处替换（都是「当库用」形态下的死项，详见 docs/EXCALIDRAW-PARITY.md）：
 *   - `DefaultItems.CommandPalette`：它只是把 `openDialog` 置成 `commandPalette`，
 *     而真正渲染对话框的组件从未被挂载 → 换成外壳自建的命令面板；
 *   - `DefaultItems.SearchMenu`：同样只有动作、没有渲染方 → 一并去掉，
 *     搜索能力由外壳命令面板承担。
 *
 * 主题项用的是引擎官方的三态 API：`<ToggleTheme allowSystemTheme>` 会渲染
 * 「浅色 / 深色 / 跟随系统」三段选择，选中结果只回调 `onSelect`，
 * 不碰引擎 appState —— 外壳是主题的唯一事实来源。
 */
export function BoardMainMenu({
  themeSetting,
  onSelectTheme,
  onOpenCommandPalette,
}: {
  themeSetting: ThemeSetting;
  onSelectTheme: (next: ThemeSetting) => void;
  onOpenCommandPalette: () => void;
}) {
  return (
    <MainMenu>
      <MainMenu.DefaultItems.LoadScene />
      <MainMenu.DefaultItems.Export />
      <MainMenu.DefaultItems.SaveAsImage />
      <MainMenu.DefaultItems.ToggleTheme
        allowSystemTheme
        theme={themeSetting}
        onSelect={onSelectTheme}
      />
      <MainMenu.DefaultItems.ClearCanvas />
      <MainMenu.Item
        icon={<IconSearch />}
        shortcut={PALETTE_SHORTCUT}
        onSelect={() => onOpenCommandPalette()}
      >
        命令面板
      </MainMenu.Item>
      <MainMenu.DefaultItems.Help />
    </MainMenu>
  );
}
