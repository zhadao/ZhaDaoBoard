@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 白板 · 本地无限画布

echo.
echo   正在启动白板...
echo.

rem 优先用打包好的单文件启动器（已内嵌前端，无需安装 Node）
if exist "WhiteBoard.exe" (
  "WhiteBoard.exe"
) else (
  echo   未找到 WhiteBoard.exe，改用 Node 启动（需要已安装 Node）。
  echo   若尚未构建，请先执行： npm run build
  echo.
  node "server\server.cjs"
)

echo.
echo   服务已停止。数据保存在 data\ 文件夹里，不会丢失。
pause
