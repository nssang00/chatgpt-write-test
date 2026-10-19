@echo off
setlocal EnableExtensions
cd /d "%~dp0"
REM v58.8 feature builds must not automatically reuse an older broken project.
REM Legacy failed-build repair is available separately; not part of the feature entrypoint.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run-Auto.ps1" %*
if errorlevel 1 goto failed
echo.
echo Company WebView v58.8 feature preview ready. Check AutoResults\product-auto-summary.json.
pause
exit /b 0
:failed
echo.
echo UPM FEATURE PREVIEW BUILD FAILED. Check AutoResults and UnityEditorAutoBuild.log.
pause
exit /b 1
