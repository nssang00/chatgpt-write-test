@echo off
setlocal EnableExtensions
cd /d "%~dp0"
REM If an older v58.7.1 one-click build failed with Unity CS0104, reuse its Library cache.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Recover-CS0104.ps1" %*
set "RECOVER_RC=%ERRORLEVEL%"
if "%RECOVER_RC%"=="0" goto success
if not "%RECOVER_RC%"=="20" goto failed
REM No matching failure: normal offline UPM assembly and batch build.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run-Auto.ps1" %*
if errorlevel 1 goto failed
:success
echo.
echo Company WebView UPM product build passed. Check AutoResults\product-auto-summary.json.
pause
exit /b 0
:failed
echo.
echo UPM PRODUCT BUILD FAILED. Check AutoResults and UnityEditorAutoBuild.log.
pause
exit /b 1
