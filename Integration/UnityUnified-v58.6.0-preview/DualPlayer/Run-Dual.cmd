@echo off
setlocal
cd /d "%~dp0"
echo ====================================================
echo Unity WebView dual mode 58.6.0 EXPERIMENTAL
echo This kit needs your previously compiled CEF 58.4.4 runtime.
echo ====================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run-Dual.ps1" -BundleRoot "%~dp0." %*
set "RC=%ERRORLEVEL%"
echo Exit code: %RC%
pause
exit /b %RC%
