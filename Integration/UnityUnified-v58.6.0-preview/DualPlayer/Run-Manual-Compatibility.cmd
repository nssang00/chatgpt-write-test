@echo off
setlocal
cd /d "%~dp0"
echo CompanyWebView Windows compatibility manual check - 5 minute session
echo Use actual Korean IME and Windows display scale. Do not enter private text.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run-Dual.ps1" -BundleRoot "%~dp0." -ManualCompatibility -NoScreenshots -AutoSeconds 300 %*
set "RC=%ERRORLEVEL%"
echo Exit code: %RC%
pause
exit /b %RC%
