@echo off
chcp 65001 >nul
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" %*
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo  Deploy failed, exit code: %RC%
) else (
  echo  Deploy OK. If the browser still shows old content, press Ctrl+F5.
)
echo.
pause
exit /b %RC%
