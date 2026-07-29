@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\diagnose.ps1" %*
set "AI_SOLO_STATUS=%ERRORLEVEL%"
if /I not "%AI_SOLO_NO_PAUSE%"=="1" (
  echo.
  echo You can close this window.
  pause
)
exit /b %AI_SOLO_STATUS%
