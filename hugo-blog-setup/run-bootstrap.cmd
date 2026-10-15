@echo off
chcp 65001 >nul
setlocal
echo.
echo  ============================================================
echo   Blog bootstrap: Hugo + PaperMod + Wrangler (Cloudflare Pages)
echo  ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap.ps1" %*
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo  Script exit code: %RC%  ^(non-zero means it stopped early, see red lines above^)
) else (
  echo  Bootstrap finished. Next step: run "wrangler login" once in PowerShell.
)
echo.
pause
exit /b %RC%
