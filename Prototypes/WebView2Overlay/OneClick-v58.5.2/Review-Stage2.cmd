@echo off
setlocal
cd /d "%~dp0"
echo ================================================
echo  WebView2 r5 Stage2 Guided Manual Review
echo ================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Review-Stage2.ps1" -BundleRoot "%~dp0." %*
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (echo [REVIEW RECORDED] Formal Stage2 approval is still pending.) else (echo [REVIEW INCOMPLETE] Check the logs.)
pause
exit /b %RC%
