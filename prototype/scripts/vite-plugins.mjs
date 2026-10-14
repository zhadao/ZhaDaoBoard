/**
 * 本项目自用的 Vite 插件（构建期 / 开发期）。
 *
 * 为什么放在 .mjs 而不是直接写进 vite.config.ts：
 * 这些插件需要 node:fs / node:path，而本项目没有（也不打算引入）@types/node。
 * 放在 .mjs 里由 tsconfig 的 allowJs 引入，既保住 vite.config.ts 的类型检查，
 * 又不必为了几个内置模块多装一份类型包。
 *
 * 字体别名的作用：引擎会按 `./fonts/<Family>/<hash>.woff2` 请求它自带的字体家族，
 * 本地路径失败后会无条件回退到 esm.sh（外网）。这里把所有家族都别名到本地普惠体，
 * 保证纯离线且中文渲染统一。映射表与 server.cjs 共用根目录的 font-map.json。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let cached = null;
function fontMap() {
  cached ??= JSON.parse(fs.readFileSync(path.join(ROOT, "font-map.json"), "utf8"));
  return cached;
}

/** `/fonts/<家族>/<文件>` → `fonts/puhuiti/<字重>.woff2`；真实文件（puhuiti）返回 null。 */
export function resolveMappedFont(pathname) {
  const map = fontMap();
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "fonts" || parts[1] === "puhuiti") return null;
  const weight = Object.hasOwn(map.families, parts[1]) ? map.families[parts[1]] : map.fallback;
  return Object.hasOwn(map.weights, weight) ? map.weights[weight] : null;
}

/**
 * 开发服务器：把家族字体请求直接改写成 public/ 下的普惠体文件。
 * @returns {import("vite").Plugin}
 */
export function wbFontAlias() {
  return {
    name: "wb-font-alias",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const target = resolveMappedFont((req.url ?? "/").split("?")[0]);
        if (!target) return next();
        fs.readFile(path.join(ROOT, "public", target), (err, data) => {
          if (err) return next();
          res.setHeader("content-type", "font/woff2");
          res.setHeader("cache-control", "public, max-age=3600");
          res.end(data);
        });
      });
    },
  };
}

/**
 * 构建：把 font-map.json 复制进 dist。
 * server.cjs 在 exe（SEA）里读不到项目根目录，只能从 dist 资源里取，
 * 这样字体别名在 dev / npm run serve / exe 三种形态下行为完全一致。
 * @returns {import("vite").Plugin}
 */
export function wbFontMap() {
  let outDir = "dist";
  return {
    name: "wb-font-map",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const target = path.resolve(ROOT, outDir, "font-map.json");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `${JSON.stringify(fontMap(), null, 2)}\n`);
    },
  };
}
