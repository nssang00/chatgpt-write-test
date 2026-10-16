@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Build-UnityProduct.ps1" %*
if errorlevel 1 ( echo UPM assembly FAILED. Check local validated CEF stage; no download was attempted. & pause & exit /b 1 )
echo Open generated Dist\com.company.webview\package.json in Unity Package Manager Add from disk.
pause

