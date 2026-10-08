@echo off
setlocal
cd /d "%~dp0"
title OpenLayers 10.10.0 Local GPU Benchmark
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-local-benchmark.ps1"
echo.
echo Press any key to close this window.
pause >nul
