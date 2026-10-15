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
  throw "Scratch Unity Assets already has CompanyWebView; refusing ambiguous second copy: $targetPackage"
}
$targetRuntime=Join-Path $targetPackage 'Runtime'
New-Item -ItemType Directory -Force -Path $targetRuntime | Out-Null

# Copy ONLY Unity-relevant assets; never walk/copy the giant Documentation~ tree.
# Runtime C# and shader/asmdef files retain their relative directories.
$allowed=@('.cs','.asmdef','.asmref','.shader','.compute','.hlsl','.cginc','.uxml','.uss','.png','.asset','.json')
$sourceRuntime=Join-Path $cef 'Runtime'
$managedFiles=@(Get-ChildItem -LiteralPath $sourceRuntime -File -Recurse -ErrorAction Stop |
  Where-Object{ $allowed -contains $_.Extension.ToLowerInvariant() })
if($managedFiles.Count -lt 1){throw 'CEF runtime has no Unity-managed source files.'}
foreach($file in $managedFiles){
  $relative=$file.FullName.Substring($sourceRuntime.Length).TrimStart([char[]]@('\','/'))
  $target=Join-Path $targetRuntime $relative
  $parent=Split-Path -Parent $target
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  Copy-Item -LiteralPath $file.FullName -Destination $target -Force -ErrorAction Stop
}
$copiedSource=Join-Path $targetRuntime 'WebView.cs'
if(-not (Test-Path -LiteralPath $copiedSource -PathType Leaf)){
  throw 'CEF Runtime WebView.cs missing after selective copy'
}
if((Get-FileHash -LiteralPath $copiedSource -Algorithm SHA256).Hash -ne $sourceFileHash){
  throw 'Copied CEF WebView.cs differs from validated source'
}
# Explicitly create the new integration folder before moving five facade files.
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
  Copy-Item -LiteralPath $original -Destination $destination -Force -ErrorAction Stop
  if(-not (Test-Path -LiteralPath $destination -PathType Leaf)){
    throw "Unified managed source not staged: $name"
  }
}
Write-Host "[DUAL] Selectively copied $($managedFiles.Count) CEF Unity runtime files; excluded Documentation~ and native source trees"
if((Get-FileHash -LiteralPath $sourceWebView -Algorithm SHA256).Hash -ne $sourceFileHash){
  throw 'Original validated CEF source unexpectedly changed'
}
Write-Host '[DUAL] Validated CEF managed package + 5 unified facade files installed in scratch Unity project'
