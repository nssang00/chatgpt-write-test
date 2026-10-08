$ErrorActionPreference = "Stop"

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Here

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host " OpenLayers 10.10.0 Local GPU Benchmark" -ForegroundColor Cyan
Write-Host " 50 layers / 500,000 features" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js was not found." -ForegroundColor Red
  Write-Host "Install Node.js 22+ from https://nodejs.org/ and run this file again."
  exit 1
}

$NodeVersion = node --version
Write-Host "Node: $NodeVersion"

Write-Host ""
Write-Host "[1/5] Installing npm dependencies..."
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "[2/5] Ensuring Chromium is installed..."
npx playwright install chromium
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "[3/5] Collecting Windows GPU information..."
$GpuInfo = @()
try {
  $GpuInfo = Get-CimInstance Win32_VideoController |
    Select-Object Name, AdapterRAM, DriverVersion, VideoProcessor, Status
} catch {
  Write-Host "Could not query Win32_VideoController: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[4/5] Running Canvas and WebGL benchmark..."
Write-Host "A browser window will open. Do not close it until the test finishes." -ForegroundColor Yellow
node local-gpu-benchmark.mjs
$BenchExit = $LASTEXITCODE

$LatestFile = Join-Path $Here "local-results\LATEST.txt"
if (-not (Test-Path $LatestFile)) {
  Write-Host "Benchmark result directory was not created." -ForegroundColor Red
  exit 1
}

$ResultDir = (Get-Content $LatestFile -Raw).Trim()
if (-not (Test-Path $ResultDir)) {
  Write-Host "Result directory does not exist: $ResultDir" -ForegroundColor Red
  exit 1
}

$GpuText = $GpuInfo | Format-List | Out-String
$GpuText | Set-Content -Path (Join-Path $ResultDir "windows-gpu-info.txt") -Encoding UTF8

$ComputerInfo = @()
try {
  $ComputerInfo = Get-ComputerInfo |
    Select-Object WindowsProductName, WindowsVersion, OsBuildNumber, CsSystemType, CsProcessors, CsTotalPhysicalMemory
} catch {}
$ComputerInfo | Format-List | Out-String |
  Set-Content -Path (Join-Path $ResultDir "windows-system-info.txt") -Encoding UTF8

Write-Host ""
Write-Host "[5/5] Creating ZIP..."
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ZipPath = Join-Path $Here ("OpenLayers-GPU-Benchmark-" + $Timestamp + ".zip")
Compress-Archive -Path (Join-Path $ResultDir "*") -DestinationPath $ZipPath -Force

Write-Host ""
Write-Host "==============================================" -ForegroundColor Green
Write-Host " Finished" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green
Write-Host "Result folder: $ResultDir"
Write-Host "ZIP file:      $ZipPath"
Write-Host ""
Write-Host "Upload this ZIP to ChatGPT and I can analyze it." -ForegroundColor Cyan

Start-Process explorer.exe -ArgumentList "/select,`"$ZipPath`""

if ($BenchExit -ne 0) {
  Write-Host ""
  Write-Host "The benchmark returned a non-zero exit code, but available results were still zipped." -ForegroundColor Yellow
}

exit 0
