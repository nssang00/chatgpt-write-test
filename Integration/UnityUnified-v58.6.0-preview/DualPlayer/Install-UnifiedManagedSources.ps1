#requires -Version 5.1
# Install validated CEF package + additive unified C# facade into a NEW scratch Unity project only.
# Keeps old oneclick_bundle untouched. This is also exercised with a realistic Windows fixture in CI.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$CefPackagePath,
  [Parameter(Mandatory=$true)][string]$UnityAssetsDir,
  [Parameter(Mandatory=$true)][string]$KitRoot
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$cef=[IO.Path]::GetFullPath($CefPackagePath)
$assets=[IO.Path]::GetFullPath($UnityAssetsDir)
$kit=[IO.Path]::GetFullPath($KitRoot)
$sourceWebView=Join-Path $cef 'Runtime\WebView.cs'
if(-not (Test-Path -LiteralPath $sourceWebView -PathType Leaf)){
  throw 'CEF Unity source Runtime\WebView.cs is missing from existing oneclick_bundle.'
}
$sourceFileHash=(Get-FileHash -LiteralPath $sourceWebView -Algorithm SHA256).Hash
$targetPackage=Join-Path $assets 'CompanyWebView'
if(Test-Path -LiteralPath $targetPackage) {
  throw "Scratch Unity project already has CompanyWebView; refusing ambiguous second copy: $targetPackage"
}
New-Item -ItemType Directory -Force -Path $assets | Out-Null
Copy-Item -LiteralPath $cef -Destination $targetPackage -Recurse -Force
$targetRuntime=Join-Path $targetPackage 'Runtime'
if(-not (Test-Path -LiteralPath (Join-Path $targetRuntime 'WebView.cs') -PathType Leaf)){
  throw 'CEF Package copy did not preserve Runtime\WebView.cs'
}
# This directory does NOT exist in the frozen CEF baseline: always make it before copying.
$unified=Join-Path $targetRuntime 'UnifiedExperimental'
New-Item -ItemType Directory -Force -Path $unified | Out-Null
$files=@('UnifiedWebView.cs','CefTextureBackendBridge.cs','WebView2OverlayBackendBridge.cs',
  'UnifiedTextureSceneHost.cs','UnifiedOverlaySceneHost.cs')
foreach($name in $files){
  $original=Join-Path (Join-Path $kit 'Runtime') $name
  if(-not (Test-Path -LiteralPath $original -PathType Leaf)){
    throw "Unified kit source not found: $name"
  }
  $destination=Join-Path $unified $name
  Copy-Item -LiteralPath $original -Destination $destination -Force
  if(-not (Test-Path -LiteralPath $destination -PathType Leaf)){
    throw "Unified managed source not staged: $name"
  }
}
if((Get-FileHash -LiteralPath $sourceWebView -Algorithm SHA256).Hash -ne $sourceFileHash){
  throw 'Original validated CEF source unexpectedly changed'
}
Write-Host '[DUAL] Validated CEF managed package + 5 unified facade files installed in scratch Unity project'
