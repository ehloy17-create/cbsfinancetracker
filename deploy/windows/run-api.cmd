@echo off
setlocal

set "APP_ROOT=%~dp0"
if "%APP_ROOT:~-1%"=="\" set "APP_ROOT=%APP_ROOT:~0,-1%"

if not defined APP_DATA_DIR set "APP_DATA_DIR=%ProgramData%\BizTracker"
if not exist "%APP_DATA_DIR%\config\app.env" if exist "%ProgramData%\GCashPOSLocal\config\app.env" set "APP_DATA_DIR=%ProgramData%\GCashPOSLocal"
if not exist "%APP_DATA_DIR%\config\app.env" if exist "%LOCALAPPDATA%\GCashPOSLocal\config\app.env" set "APP_DATA_DIR=%LOCALAPPDATA%\GCashPOSLocal"
if not defined APP_ENV_FILE set "APP_ENV_FILE=%APP_DATA_DIR%\config\app.env"
if not defined APP_LOGS_DIR set "APP_LOGS_DIR=%APP_DATA_DIR%\logs"
if not defined NODE_ENV set "NODE_ENV=production"

if not exist "%APP_LOGS_DIR%" mkdir "%APP_LOGS_DIR%"

"%APP_ROOT%\vendor\node\node.exe" "%APP_ROOT%\server\index.js" 1>>"%APP_LOGS_DIR%\api.stdout.log" 2>>"%APP_LOGS_DIR%\api.stderr.log"
