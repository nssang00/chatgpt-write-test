@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run-Auto.ps1" %*
if errorlevel 1 (
  echo.
  echo UPM AUTOMATION FAILED. Read the message above and AutoResults logs.
  pause
  exit /b 1
)
echo.
echo Product UPM package, prefabs, sample scene and Windows Player are ready.
pause
exit /b 0
