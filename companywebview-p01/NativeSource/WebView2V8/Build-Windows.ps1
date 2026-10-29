#requires -Version 7
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$WebView2SdkRoot,
      [string]$BuildDirectory = "$PSScriptRoot/build")
$ErrorActionPreference='Stop'
if(-not (Test-Path "$WebView2SdkRoot/build/native/include/WebView2.h")) { throw 'WebView2.h missing' }
if(-not (Test-Path "$WebView2SdkRoot/build/native/x64/WebView2LoaderStatic.lib")) { throw 'WebView2LoaderStatic.lib missing' }
& cmake -S $PSScriptRoot -B $BuildDirectory -G 'Visual Studio 17 2022' -A x64 "-DWEBVIEW2_SDK_ROOT=$WebView2SdkRoot"
if($LASTEXITCODE -ne 0){throw 'WebView2 v8 configure failed'}
& cmake --build $BuildDirectory --config Release
if($LASTEXITCODE -ne 0){throw 'WebView2 v8 build failed'}
$binary=Join-Path $BuildDirectory 'Release/CompanyWebView2SecureV8.dll'
if(-not (Test-Path $binary)){throw 'WebView2 v8 DLL missing'}
Copy-Item -LiteralPath $binary -Destination (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'CompanyWebView2SecureV8.dll') -Force
Write-Host "CWV_WV2V8_NATIVE_MSVC_BUILD_PASS $binary"
