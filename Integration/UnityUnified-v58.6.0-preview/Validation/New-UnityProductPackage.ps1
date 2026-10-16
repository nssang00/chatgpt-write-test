#requires -Version 5.1
<#
.SYNOPSIS
 Builds an additive PREVIEW Unity UPM package from verified local inputs.
 No network calls, no Unity Editor invocation, no changes to the source kits.
#>
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$CefRuntimeDir,
 [Parameter(Mandatory=$true)][string]$CefStageDir,
 [Parameter(Mandatory=$true)][string]$WebView2Dll,
 [Parameter(Mandatory=$true)][string]$OutputDir,
 [string]$IntegrationRoot=(Split-Path $PSScriptRoot -Parent)
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
function RequireFile([string]$path){
 if(-not (Test-Path -LiteralPath $path -PathType Leaf)){throw "Required input missing: $path"}
 if((Get-Item -LiteralPath $path).Length -eq 0){throw "Required input is empty: $path"}
}
function CopyFile([string]$from,[string]$to){
 RequireFile $from
 $folder=Split-Path $to -Parent
 if(-not (Test-Path -LiteralPath $folder)){New-Item -ItemType Directory -Force -Path $folder | Out-Null}
 Copy-Item -LiteralPath $from -Destination $to -Force
 $a=(Get-FileHash -LiteralPath $from -Algorithm SHA256).Hash
 $b=(Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash
 if($a -cne $b){throw "Copied file hash mismatch: $from"}
}
$integration=[IO.Path]::GetFullPath($IntegrationRoot)
$template=Join-Path $integration 'ProductPackageTemplate'
$legacy=[IO.Path]::GetFullPath($CefRuntimeDir)
$stage=[IO.Path]::GetFullPath($CefStageDir)
$webview2=[IO.Path]::GetFullPath($WebView2Dll)
$output=[IO.Path]::GetFullPath($OutputDir)
$native=Join-Path $stage 'native\Release\CompanyWebViewCefTextureProbe.dll'
$runtime=Join-Path $stage 'runtime\Release'
$requiredCef=@('CompanyWebViewCefSubprocess.exe','libcef.dll','icudtl.dat','resources.pak',
 'chrome_100_percent.pak','locales\en-US.pak')
RequireFile (Join-Path $legacy 'WebView.cs')
RequireFile $native
RequireFile $webview2
if((Split-Path $webview2 -Leaf) -cne 'CompanyWebView2UnifiedPreview.dll'){
 throw 'Must supply the validated CompanyWebView2UnifiedPreview.dll (not a different pilot DLL)'
}
foreach($name in $requiredCef){RequireFile (Join-Path $runtime $name)}
$unifiedNames=@('UnifiedWebView.cs','CefTextureBackendBridge.cs',
 'WebView2OverlayBackendBridge.cs','UnifiedTextureSceneHost.cs','UnifiedOverlaySceneHost.cs')
foreach($name in $unifiedNames){RequireFile (Join-Path $integration ('Runtime\'+$name))}
foreach($rel in @('package.json','Runtime\Company.WebView.Runtime.asmdef',
 'Editor\Company.WebView.Editor.asmdef','Editor\CompanyWebViewPrefabWizard.cs','Editor\CompanyWebViewBuildStage.cs','README.md')){
 RequireFile (Join-Path $template $rel)
}
if(Test-Path -LiteralPath $output){throw "Output exists; refusing to overwrite: $output"}
# Preflight everything before creating output; no half-installed package on known misses.
$parent=Split-Path $output -Parent
New-Item -ItemType Directory -Force -Path $parent | Out-Null
$tmp=$output+'.assembling-'+[guid]::NewGuid().ToString('N')
try{
 New-Item -ItemType Directory -Force -Path $tmp | Out-Null
 foreach($rel in @('package.json','Runtime\Company.WebView.Runtime.asmdef',
  'Editor\Company.WebView.Editor.asmdef','Editor\CompanyWebViewPrefabWizard.cs','Editor\CompanyWebViewBuildStage.cs','README.md')){
  CopyFile (Join-Path $template $rel) (Join-Path $tmp $rel)
 }
 $outCef=Join-Path $tmp 'Runtime\CefValidated'
 $cefFiles=@(Get-ChildItem -LiteralPath $legacy -File -Filter '*.cs' -Recurse | Sort-Object FullName)
 if($cefFiles.Count -eq 0){throw 'Validated CEF has no runtime .cs files'}
 foreach($item in $cefFiles){
  $rel=$item.FullName.Substring($legacy.Length).TrimStart('\','/')
  CopyFile $item.FullName (Join-Path $outCef $rel)
 }
 $outUnified=Join-Path $tmp 'Runtime\Unified'
 foreach($name in $unifiedNames){
  CopyFile (Join-Path $integration ('Runtime\'+$name)) (Join-Path $outUnified $name)
 }
 $plugins=Join-Path $tmp 'Runtime\Plugins\x86_64'
 CopyFile $native (Join-Path $plugins 'CompanyWebViewCefTextureProbe.dll')
 CopyFile $webview2 (Join-Path $plugins 'CompanyWebView2UnifiedPreview.dll')
 # Preserve the production CEF runtime layout, including locales, SwiftShader and any
 # pinned resource .pak/.dat/.bin/.dll/.exe. Never import browser profiles, logs or tests.
 $extensions=@('.dll','.exe','.pak','.dat','.bin')
 $runtimeFiles=@(Get-ChildItem -LiteralPath $runtime -Recurse -File | Sort-Object FullName)
 foreach($item in $runtimeFiles){
  if($extensions -notcontains $item.Extension.ToLowerInvariant()){continue}
  $rel=$item.FullName.Substring($runtime.Length).TrimStart('\','/')
  if($rel -match '(^|[\\/])(smoke-cache|cef-cache|profiles|logs|Results)([\\/]|$)'){continue}
  CopyFile $item.FullName (Join-Path $plugins $rel)
 }
 $mustExist=@('Runtime\CefValidated\WebView.cs','Runtime\Unified\UnifiedWebView.cs',
  'Runtime\Plugins\x86_64\CompanyWebViewCefTextureProbe.dll',
  'Runtime\Plugins\x86_64\CompanyWebView2UnifiedPreview.dll',
  'Runtime\Plugins\x86_64\libcef.dll','Runtime\Plugins\x86_64\locales\en-US.pak')
 foreach($rel in $mustExist){RequireFile (Join-Path $tmp $rel)}
 # No OneClick manual test or dual-player experimental evidence classes in user UPM.
 foreach($unsafe in @('UnifiedDualPlayerEvidence.cs','CefCubeTextureProof.cs','Run-Dual.ps1')){
  if(Get-ChildItem -LiteralPath $tmp -File -Recurse | Where-Object {$_.Name -eq $unsafe}){
   throw "Product package includes experimental fixture: $unsafe"
  }
 }
 [IO.Directory]::Move($tmp,$output)
 Write-Host ("[UPM PREVIEW] Output: "+$output)
 Write-Host ("[UPM PREVIEW] CEF managed="+$cefFiles.Count+"; native runtime="+$runtimeFiles.Count+
   "; package is NOT a Windows Player validation")
}catch{
 if(Test-Path -LiteralPath $tmp){Remove-Item -LiteralPath $tmp -Recurse -Force}
 throw
}
