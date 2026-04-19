@echo off
setlocal

set "APP_ROOT=%~dp0"
if "%APP_ROOT:~-1%"=="\" set "APP_ROOT=%APP_ROOT:~0,-1%"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_ROOT%\launch-app.ps1" -AppRoot "%APP_ROOT%"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  start "BizTracker API" /min cmd.exe /c ""%APP_ROOT%\run-api.cmd""
  timeout /t 4 /nobreak >nul
  start "BizTracker" "http://127.0.0.1:4010"
)

exit /b %EXIT_CODE%
