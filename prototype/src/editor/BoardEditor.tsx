import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Excalidraw, FONT_FAMILY, exportToBlob, loadFromBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { TopBar } from "./TopBar";
import { BoardMainMenu } from "./BoardMainMenu";
import { BoardCommandPalette, openCommandPalette } from "./CommandPalette";
import { DotGrid } from "./DotGrid";
import { useDotGrid } from "./useDotGrid";
import { useLocalLibrary } from "./useLibrary";
import { useScene } from "./useScene";
import { exportExcalidraw, exportPNG, exportSVG, pickFile } from "./exporter";
import { renameBoard, updateBoardThumbnail } from "../storage/boardRepo";
import { IconPanelLeft } from "../icons";
import { CANVAS_BACKGROUND, useTheme, type Theme } from "../theme";
import { useViewPrefs, type ViewPrefs } from "../viewPrefs";
import { boardUrl } from "../utils";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawElement,
  ExcalidrawImperativeAPI,
} from "../types";

/** 画布底色固定透明：点阵层夹在容器底色与引擎画布之间。 */
const TRANSPARENT_CANVAS = "transparent";

/**
 * 嵌入网页占位。
 *
 * 引擎用的是 `??` 回退，返回 null 仍会渲染 iframe，所以必须返回真实元素。
 * 定义在模块作用域而不是内联箭头函数：内联写法每次渲染都是新引用，
 * 会让引擎那一层跟着重渲染。
 */
const renderEmbeddable = () => (
  <span className="wb-embed-blocked">嵌入网页已在本工具中禁用</span>
);

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * 包住 <Excalidraw/> 的编辑器。
 *
 * 用 `memo` 包起来是必需的：侧边栏的白板列表状态挂在 AppShell 上，
 * 新建 / 重命名 / 删除都会让它重渲染；如果不挡住，整个 <Excalidraw/> 会跟着
 * 重渲染两三次，表现就是「点删除要等一下」。props 里只有 onToggleSidebar，
 * 在 AppShell 侧已用 useCallback 固定引用。
 */
export const BoardEditor = memo(function BoardEditor({
  onToggleSidebar,
}: {
  onToggleSidebar: () => void;
}) {
  const { id = "" } = useParams();
  const { setting: themeSetting, theme, setSetting: setThemeSetting } = useTheme();
  const [view, patchView] = useViewPrefs();
  const {
    initialData,
    boardName,
    loading,
    error,
    saveStatus,
    saveError,
    readOnly,
    scheduleSave,
    latest,
    flush,
  } = useScene(id);

  const [name, setName] = useState("");
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const thumbTimer = useRef<number | null>(null);

  const { layerRef, update: updateDotGrid } = useDotGrid();
  useLocalLibrary(api);

  // 主题用 ref 读：这样 handleChange 不必依赖 theme，引用保持稳定，
  // 避免主题一变就让 <Excalidraw/> 收到新的 onChange。
  const themeRef = useRef<Theme>(theme);
  themeRef.current = theme;
  /**
   * 引擎最后一次回报的主题。
   *
   * 引擎的 `onChange` 里 `appState.theme` 可能比我们刚 `updateScene` 推过去的值晚一拍，
   * 所以不能简单地「只要和外壳不一致就回写」——那会把外壳刚切过去的主题又顶回来
   * （表现就是「点外壳的主题按钮没反应」）。
   * 只认「引擎主题发生了跳变，且跳变目标与外壳当前值不同」这一种情况。
   */
  const lastEngineTheme = useRef<Theme | null>(null);

  // 白板名来自 useScene（已随快照一起载入），重命名后就地覆盖
  useEffect(() => {
    setName(boardName || "白板");
  }, [boardName, id]);

  // 外壳主题 → 引擎主题（外壳是唯一事实来源）
  useEffect(() => {
    api?.updateScene({ appState: { theme, viewModeEnabled: readOnly } });
  }, [api, theme, readOnly]);

  // 视图偏好 → 引擎 appState（外壳是唯一事实来源，单向推导）
  useEffect(() => {
    if (!api) return;
    api.updateScene({
      appState: {
        gridModeEnabled: view.snap === "grid",
        objectsSnapModeEnabled: view.snap === "objects",
        gridSize: view.size,
      },
    });
    updateDotGrid(api.getAppState());
  }, [api, view.snap, view.size, updateDotGrid]);

  // 选「点阵节点」时自动点亮点阵，避免出现看不见的对齐
  const handleChangeView = useCallback(
    (patch: Partial<ViewPrefs>) => {
      patchView(patch.snap === "grid" ? { ...patch, dots: true } : patch);
    },
    [patchView]
  );

  // 缩略图生成（2s 防抖，独立于落盘）
  const generateThumbnail = useCallback(() => {
    const snap = latest.current;
    if (!snap) return;
    const visible = snap.elements.filter((element) => !element.isDeleted);
    if (visible.length === 0) {
      void updateBoardThumbnail(id, null, 0);
      return;
    }
    exportToBlob({
      elements: visible,
      appState: {
        ...snap.appState,
        viewBackgroundColor: CANVAS_BACKGROUND[themeRef.current],
        exportBackground: true,
        exportWithDarkMode: themeRef.current === "dark",
      },
      files: { ...snap.files },
      mimeType: "image/png",
      maxWidthOrHeight: 480,
    })
      .then(blobToDataURL)
      .then((dataUrl: string) => updateBoardThumbnail(id, dataUrl, visible.length))
      .catch(() => {
        /* 场景为空或导出失败时静默跳过：缩略图不参与数据正确性 */
      });
  }, [id, latest]);

  const handleChange = useCallback(
    (
      elements: readonly ExcalidrawElement[],
      appState: Readonly<Partial<AppState>>,
      files: Readonly<BinaryFiles>
    ) => {
      // 引擎自带的主题开关（主菜单项 / Shift+Alt+D）也要回写外壳，
      // 否则它只切引擎 UI、不切画布底色，看起来就是「点了没反应」。
      const reported = appState.theme;
      if (reported === "light" || reported === "dark") {
        const previous = lastEngineTheme.current;
        lastEngineTheme.current = reported;
        if (previous !== null && previous !== reported && reported !== themeRef.current) {
          setThemeSetting(reported);
        }
      }
      scheduleSave(elements, appState, files);
      updateDotGrid(appState);
      // 画布底色必须保持透明（点阵层依赖它）；被其它入口改掉时立刻纠正。
      if (appState.viewBackgroundColor && appState.viewBackgroundColor !== TRANSPARENT_CANVAS) {
        api?.updateScene({ appState: { viewBackgroundColor: TRANSPARENT_CANVAS } });
      }
      if (thumbTimer.current) window.clearTimeout(thumbTimer.current);
      thumbTimer.current = window.setTimeout(generateThumbnail, 2000);
    },
    [scheduleSave, generateThumbnail, updateDotGrid, api, setThemeSetting]
  );

  const handleApiReady = useCallback((instance: ExcalidrawImperativeAPI) => {
    setApi(instance);
  }, []);

  const handleRename = useCallback(
    (next: string) => {
      setName(next);
      void renameBoard(id, next);
    },
    [id]
  );

  const handleImport = useCallback(async () => {
    if (!api) return;
    const file = await pickFile(".excalidraw,application/json");
    if (!file) return;
    try {
      const data = await loadFromBlob(file, api.getAppState(), api.getSceneElements());
      api.updateScene({ elements: data.elements, appState: data.appState });
      // 0.18 起 addFiles 接收 BinaryFileData[]，无需再转成 File。
      const imported = Object.values(data.files ?? {});
      if (imported.length) api.addFiles(imported);
    } catch (err) {
      console.error("导入失败", err);
      window.alert("导入失败：文件格式无法识别");
    }
  }, [api]);

  // 在新标签页打开前先把当前内容落盘，避免新标签读到旧场景
  const openInNewTab = useCallback(() => {
    void flush().finally(() => {
      window.open(boardUrl(id), "_blank", "noopener");
    });
  }, [flush, id]);

  const handleExportPNG = useCallback(() => {
    if (api) exportPNG(api, name, themeRef.current);
  }, [api, name]);
  const handleExportSVG = useCallback(() => {
    if (api) exportSVG(api, name, themeRef.current);
  }, [api, name]);
  const handleExportExcalidraw = useCallback(() => {
    if (api) exportExcalidraw(api, name, themeRef.current);
  }, [api, name]);
  const handleRetrySave = useCallback(() => void flush(), [flush]);

  const uiOptions = useMemo(
    () => ({
      canvasActions: {
        changeViewBackgroundColor: false,
        clearCanvas: true,
        loadScene: true,
        saveToActiveFile: false,
        // 必须为 true：`actionToggleTheme` 的 predicate 就是 `!!canvasActions.toggleTheme`，
        // 置 false 会连带禁掉主菜单里的主题项与 Shift+Alt+D。我们在这里打开它，
        // 但用 <ToggleTheme allowSystemTheme> 让引擎渲染官方三态选择器，
        // 选中结果回写外壳（见 BoardMainMenu）。
        toggleTheme: true,
        saveAsImage: true,
        export: { saveFileToDisk: true },
      },
    }),
    []
  );

  // initialData 只在挂载时被引擎读取一次；固定引用可避免每次渲染都传新对象。
  const engineInitialData = useMemo(
    () =>
      initialData
        ? {
            elements: initialData.elements,
            appState: {
              ...initialData.appState,
              theme,
              viewModeEnabled: readOnly,
              // 点阵层需要透明画布；底色由外壳的 .wb-canvas 提供
              viewBackgroundColor: TRANSPARENT_CANVAS,
              // 三个字体槽位已被构建期补丁改绑到普惠体，默认用「常规」
              currentItemFontFamily: FONT_FAMILY.Virgil,
              showWelcomeScreen: false,
            },
            files: initialData.files,
          }
        : null,
    [initialData, theme, readOnly]
  );

  if (loading || error || !engineInitialData) {
    return (
      <div className="wb-editor">
        {/* 载入 / 失败态也要保留侧边栏折叠按钮，避免侧边栏收起后无路可走 */}
        <header className="wb-topbar">
          <div className="wb-topbar-left">
            <button
              className="wb-btn wb-btn--icon"
              onClick={onToggleSidebar}
              aria-label="显示 / 隐藏侧边栏"
              title="显示 / 隐藏侧边栏"
            >
              <IconPanelLeft />
            </button>
          </div>
        </header>
        <div className="wb-canvas">
          <div className="wb-loading wb-loading--block">
            <span>{error ?? "正在载入白板…"}</span>
            {error && (
              <button
                className="wb-btn wb-btn--secondary"
                onClick={() => window.location.reload()}
              >
                重试
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wb-editor">
      <TopBar
        name={name}
        saveStatus={saveStatus}
        saveError={saveError}
        readOnly={readOnly}
        themeSetting={themeSetting}
        theme={theme}
        view={view}
        onToggleSidebar={onToggleSidebar}
        onRename={handleRename}
        onSelectTheme={setThemeSetting}
        onRetrySave={handleRetrySave}
        onExportPNG={handleExportPNG}
        onExportSVG={handleExportSVG}
        onExportExcalidraw={handleExportExcalidraw}
        onImport={handleImport}
        onOpenNewTab={openInNewTab}
        onChangeView={handleChangeView}
      />

      <div className="wb-canvas">
        <DotGrid layerRef={layerRef} enabled={view.dots} />
        <Excalidraw
          initialData={engineInitialData}
          // 默认全中文
          langCode="zh-CN"
          // 关闭 AI / 文本转图表（需要联网）
          aiEnabled={false}
          // 嵌入网页元素会渲染 <iframe> 向第三方取内容；纯本地模式下换成占位块。
          renderEmbeddable={renderEmbeddable}
          UIOptions={uiOptions}
          onChange={handleChange}
          excalidrawAPI={handleApiReady}
        >
          <BoardMainMenu
            themeSetting={themeSetting}
            onSelectTheme={setThemeSetting}
            onOpenCommandPalette={openCommandPalette}
          />
          {/*
            命令面板挂在 <Excalidraw> 的 children 里：这样它能拿到引擎的 i18n 上下文
            （动作标签要经过引擎的翻译表），再用 portal 把 DOM 渲染到 document.body，
            从而覆盖整个应用而不是只覆盖画布。
          */}
          <BoardCommandPalette
            api={api}
            onToggleSidebar={onToggleSidebar}
            onExportPNG={handleExportPNG}
            onExportSVG={handleExportSVG}
            onExportExcalidraw={handleExportExcalidraw}
          />
        </Excalidraw>
      </div>
    </div>
  );
});
