/**
 * 首屏主题初始化（在 React 之前同步执行，避免深色模式下闪白）。
 *
 * 单独成文件而不是内联在 index.html 里：本地服务器下发的 CSP 使用
 * `script-src 'self'`（不含 'unsafe-inline'），内联脚本会被浏览器拦掉。
 *
 * 优先级：`<html data-theme-pref>`（服务器按 data/prefs.json 注入）
 *        → localStorage（本地兜底）
 *        → 系统偏好（首次访问）
 *
 * 注意这里只负责「解析并落到 data-theme」；真正的偏好读写由 src/theme.ts 负责。
 */
(function () {
  var root = document.documentElement;

  var setting = root.getAttribute("data-theme-pref");
  if (setting !== "light" && setting !== "dark" && setting !== "system") {
    try {
      setting = localStorage.getItem("wb-theme");
    } catch (error) {
      setting = null;
    }
  }
  if (setting !== "light" && setting !== "dark" && setting !== "system") {
    setting = "system";
  }

  var resolved =
    setting === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : setting;

  root.setAttribute("data-theme-pref", setting);
  root.setAttribute("data-theme", resolved);
})();
