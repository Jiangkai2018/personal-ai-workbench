@echo off
REM 启动 dev server（server 5233 + web 5277），日志写到 logs\dev.log
REM 用 cmd start /B 分离，避免 Bash spawn 在 Windows 上被回收
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs
start /B "workbench-dev" cmd /C "npm run dev > logs\dev.log 2>&1"
echo 启动已提交，日志: %~dp0logs\dev.log
endlocal