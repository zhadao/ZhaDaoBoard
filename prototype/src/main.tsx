import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installLocalFonts } from "./fonts";
import "./styles/tokens.css";
import "./styles/app.css";

declare global {
  interface Window {
    /** Excalidraw 读取的资源基址；指向本地服务，保持纯离线。 */
    EXCALIDRAW_ASSET_PATH?: string;
  }
}

// 让 Excalidraw 从本地加载字体，而不是回退到 CDN（保持纯离线）
// 见引擎 chunk 内 ASSETS_FALLBACK_URL 默认指向 esm.sh
window.EXCALIDRAW_ASSET_PATH = import.meta.env.BASE_URL;

// 普惠体三个字重的 @font-face（必须在 React 首次渲染前注入）
installLocalFonts();

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<App />);
}
