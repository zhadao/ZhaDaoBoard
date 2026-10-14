import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { wbExcalidrawPatch } from "./scripts/excalidraw-patch.mjs";
import { wbFontAlias, wbFontMap } from "./scripts/vite-plugins.mjs";

// 与 src/api.ts 的 CONNECTION_HINT 保持一致（此处无法直接 import TS 源码）
const CONNECTION_HINT =
  "本地服务未连接 · 请双击 WhiteBoard.exe，或运行 npm run dev";

/**
 * 后端没起来时，Vite 代理默认回 500 纯文本，前端只能给出泛化的「保存失败」文案。
 * 这里改写成 503 + 中文提示，前端据此显示「本地服务未连接」的指导文案。
 * 仅影响开发服务器，不进入构建产物。
 */
const failFast = (proxy: any) => {
  proxy.on("error", (_err: unknown, _req: unknown, res: any) => {
    if (res && !res.headersSent && typeof res.writeHead === "function") {
      res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: CONNECTION_HINT }));
    }
  });
};

// 个人本地白板工具 · 原型
// 设计系统：DESIGN.md v1.0（方案 A · Linear + Notion 留白 + Excalidraw 血统）
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    // 构建期补丁：zh-CN 补译 + 三个字体槽位改绑单分片家族 + 关掉引擎虚线网格。
    // 锚点失配会直接抛错（构建失败），不会静默产出错误结果。
    wbExcalidrawPatch(),
    // 字体别名：构建期把映射表放进 dist，开发期把家族请求改写到普惠体。
    wbFontMap(),
    wbFontAlias(),
  ],
  // Excalidraw 0.18 内部会读取 process.env.IS_PREACT，浏览器环境需显式注入
  define: {
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  // 必须排除预打包：构建期补丁走 Vite 的 transform 钩子，
  // 被 esbuild 预打包后补丁就看不到了（dev 与 prod 行为会不一致）。
  optimizeDeps: {
    exclude: ["@excalidraw/excalidraw"],
  },
  build: {
    // 构建产物放在 dist/static/，把根级 /assets/ 让给本地服务器的用户资源接口
    assetsDir: "static",
  },
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
    // 与 exe 一致的同源请求：/api 与 /assets 都代理到本地 Node 服务（:4173）。
    // changeOrigin 必须为 true：服务器会校验 Host 必须是 127.0.0.1:4173，
    // 保留原 Host（localhost:5173）会被 403 拒绝。
    proxy: {
      "/api": { target: "http://127.0.0.1:4173", changeOrigin: true, configure: failFast },
      "/assets": { target: "http://127.0.0.1:4173", changeOrigin: true, configure: failFast },
    },
  },
});
