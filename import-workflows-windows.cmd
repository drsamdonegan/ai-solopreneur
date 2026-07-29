@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\import-workflows.ps1" %*
set "AI_SOLO_STATUS=%ERRORLEVEL%"
if not "%AI_SOLO_STATUS%"=="0" (
  echo.
  echo Workflow import failed. Read the message above, then try again.
)
if /I not "%AI_SOLO_NO_PAUSE%"=="1" (
  echo.
  echo You can close this window.
  pause
)
exit /b %AI_SOLO_STATUS%
