@echo off
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator privileges...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

set "SCRIPT=%~dp0update-installed.ps1"

if not exist "%SCRIPT%" (
  echo.
  echo The updater script was not found in this folder.
  echo Please extract the updater bundle fully, then run this command again.
  pause
  exit /b 1
)

echo.
echo Starting BizTracker updater...
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -SourceDir "%CD%"
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" (
  echo Update failed with exit code %EXITCODE%.
  echo Review the message shown above, then press any key to close.
  pause >nul
  exit /b %EXITCODE%
)

echo Update completed successfully. Press any key to close.
pause >nul
exit /b 0
