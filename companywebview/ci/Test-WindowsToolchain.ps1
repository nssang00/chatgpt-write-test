#requires -Version 5.1
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Join-Path $env:RUNNER_TEMP 'cwv-hosted-toolchain'
New-Item -ItemType Directory -Force -Path $root | Out-Null
@'
cmake_minimum_required(VERSION 3.20)
project(CwvRunnerSmoke LANGUAGES CXX)
add_executable(cwv_runner_smoke main.cpp)
set_property(TARGET cwv_runner_smoke PROPERTY CXX_STANDARD 17)
'@ | Set-Content -LiteralPath (Join-Path $root 'CMakeLists.txt') -Encoding utf8
'int main() { return 0; }' | Set-Content -LiteralPath (Join-Path $root 'main.cpp') -Encoding ascii
cmake -S $root -B (Join-Path $root 'build') -G 'Visual Studio 17 2022' -A x64
if ($LASTEXITCODE -ne 0) { throw 'Windows runner MSVC CMake configure failed' }
cmake --build (Join-Path $root 'build') --config Release
if ($LASTEXITCODE -ne 0) { throw 'Windows runner C++17 compilation failed' }
& (Join-Path $root 'build/Release/cwv_runner_smoke.exe')
if ($LASTEXITCODE -ne 0) { throw 'Windows runner C++17 binary execution failed' }
$dotnetVersion = (& dotnet --version | Select-Object -First 1)
if ($LASTEXITCODE -ne 0) { throw '.NET SDK unavailable' }
$report = [ordered]@{
  status='RUNNER_TOOLCHAIN_PASS'
  os='windows-2022'
  cxx='MSVC C++17 CMake build and execution'
  dotnetSdk="$dotnetVersion"
  actualCompanyWebViewSourceCompiled=$false
  gpuEvidence=$false
}
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $root 'toolchain.json') -Encoding utf8
Write-Host 'CWV_WINDOWS_HOSTED_TOOLCHAIN_PASS (not a product compile)'
