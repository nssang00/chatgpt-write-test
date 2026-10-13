@echo off
setlocal
cd /d "%~dp0"
echo ========================================================
echo  WebView2 v58.5.2 Windows OneClick validation
echo ========================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run-All.ps1" -BundleRoot "%~dp0." %*
set "RC=%ERRORLEVEL%"
if "%RC%"=="0" (echo [AUTO COMPLETE] Upload the results ZIP; manual checks remain.) else (echo [FAIL] Upload results ZIP for diagnosis.)
echo Exit code %RC%
pause
exit /b %RC%
