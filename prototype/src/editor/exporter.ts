import { exportToBlob, exportToSvg, serializeAsJSON } from "@excalidraw/excalidraw";
import { CANVAS_BACKGROUND, type Theme } from "../theme";
import type { AppState, ExcalidrawImperativeAPI, ExcalidrawElement, NonDeleted } from "../types";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeName(name: string): string {
  return (name.trim() || "白板").replace(/[\\/:*?"<>|]/g, "_");
}

/**
 * 引擎的导出接口要求 `NonDeleted<ExcalidrawElement>` 品牌类型；
 * 这里过滤掉软删除元素后收窄（与官方 excalidraw-app 的做法一致）。
 */
function exportable(elements: readonly ExcalidrawElement[]): readonly NonDeleted<ExcalidrawElement>[] {
  return elements.filter((element) => !element.isDeleted) as readonly NonDeleted<ExcalidrawElement>[];
}

/**
 * 导出时把「屏幕上的样子」补齐成「一张完整的图」。
 *
 * 引擎画布在界面上被强制设为 `transparent`（点阵层需要它透出容器底色），
 * 所以导出前必须换回真实底色，否则 PNG/SVG 会是一张透明底的图。
 */
function exportAppState(api: ExcalidrawImperativeAPI, theme: Theme): AppState {
  return {
    ...api.getAppState(),
    viewBackgroundColor: CANVAS_BACKGROUND[theme],
    exportBackground: true,
    exportWithDarkMode: theme === "dark",
  };
}

function getScene(api: ExcalidrawImperativeAPI, theme: Theme) {
  return {
    elements: exportable(api.getSceneElements()),
    appState: exportAppState(api, theme),
    files: api.getFiles(),
  };
}

/** 导出 PNG */
export async function exportPNG(api: ExcalidrawImperativeAPI, boardName: string, theme: Theme) {
  const { elements, appState, files } = getScene(api, theme);
  const blob = await exportToBlob({
    elements,
    appState,
    files,
    mimeType: "image/png",
    exportPadding: 16,
  });
  downloadBlob(blob, `${safeName(boardName)}.png`);
}

/** 导出 SVG */
export async function exportSVG(api: ExcalidrawImperativeAPI, boardName: string, theme: Theme) {
  const { elements, appState, files } = getScene(api, theme);
  const svg = await exportToSvg({ elements, appState, files, exportPadding: 16 });
  const svgString = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  downloadBlob(blob, `${safeName(boardName)}.svg`);
}

/** 导出 .excalidraw 文件（可再导入的"打包带走"格式） */
export function exportExcalidraw(api: ExcalidrawImperativeAPI, boardName: string, theme: Theme) {
  const { elements, appState, files } = getScene(api, theme);
  const json = serializeAsJSON(elements, appState, files, "local");
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  downloadBlob(blob, `${safeName(boardName)}.excalidraw`);
}

/** 触发文件选择，导入 .excalidraw / 图片，返回 Blob 供调用方处理 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
