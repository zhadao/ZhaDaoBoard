/**
 * 本地字体（阿里巴巴普惠体）接入。
 *
 * 为什么在运行时注入 `@font-face` 而不是写进 CSS：
 * Vite 的 `base: "./"` 会改写 CSS 里以 `/` 开头的 URL，而 public/ 下的字体在
 * dev（`/fonts/...`）与 exe 打包后（`/fonts/...`）都是根路径。用 `document.baseURI`
 * 现场拼绝对地址，两边行为完全一致，也不受打包器影响。
 *
 * 另外引擎会按 `./fonts/<Family>/<hash>.woff2` 请求它自己的字体家族，
 * 本地服务把所有家族都别名到这三个文件（见 font-map.json），
 * 所以「普惠体·常规 / 中黑 / 加粗」三个选项实际就是这三个字重。
 */

/** 与 DESIGN.md 的中文优先字体栈保持一致；同时用于 tokens.css 的 --wb-font-sans。 */
export const UI_FONT_STACK =
  '"PuHuiTi", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "微软雅黑", sans-serif';

const FACES = [
  { file: "regular", weight: 400 },
  { file: "medium", weight: 500 },
  { file: "bold", weight: 700 },
] as const;

export function installLocalFonts(): void {
  if (document.querySelector("style[data-wb-fonts]")) return;

  const css = FACES.map(({ file, weight }) => {
    const href = new URL(`fonts/puhuiti/${file}.woff2`, document.baseURI).href;
    return (
      `@font-face{font-family:"PuHuiTi";src:url("${href}") format("woff2");` +
      `font-weight:${weight};font-style:normal;font-display:swap;}`
    );
  }).join("\n");

  const style = document.createElement("style");
  style.dataset.wbFonts = "puhuiti";
  style.textContent = css;
  document.head.appendChild(style);
}
