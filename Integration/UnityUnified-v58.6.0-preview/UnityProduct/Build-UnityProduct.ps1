#requires -Version 5.1
<# Build a single local UPM package. NEVER downloads, modifies or rebuilds
   the validated CEF stage and its C# sources. #>
[CmdletBinding()]
param(
 [string]$CefArchive,
 [string]$CefStage,
 [string]$WebView2Dll,
 [string]$OutputRoot
)
# Resolve defaults only after PowerShell initializes this script's execution context.
# $PSScriptRoot can be empty while parameter default expressions are evaluated.
$kitDir=$PSScriptRoot
if([string]::IsNullOrWhiteSpace($kitDir)) {
 $kitDir=Split-Path -Path $MyInvocation.MyCommand.Path -Parent
}
if([string]::IsNullOrWhiteSpace($kitDir)) {
 throw 'Cannot locate Build-UnityProduct.ps1 directory'
}
if([string]::IsNullOrWhiteSpace($CefArchive)) {
 $CefArchive=Join-Path $kitDir 'CefOneClick-v58.4.4-source.zip'
}
if([string]::IsNullOrWhiteSpace($WebView2Dll)) {
 $WebView2Dll=Join-Path $kitDir 'CompanyWebView2UnifiedPreview.dll'
}
if([string]::IsNullOrWhiteSpace($OutputRoot)) {
 $OutputRoot=Join-Path $kitDir 'Dist'
}
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
function RequireFile([string]$file){if(-not (Test-Path -LiteralPath $file -PathType Leaf)){throw "Required validated file missing: $file"}}
function CopySource([string]$source,[string]$destination){RequireFile $source;New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent)|Out-Null;Copy-Item -LiteralPath $source -Destination $destination -Force}
$CefArchive=[IO.Path]::GetFullPath($CefArchive)
$WebView2Dll=[IO.Path]::GetFullPath($WebView2Dll)
$OutputRoot=[IO.Path]::GetFullPath($OutputRoot)
RequireFile $CefArchive;RequireFile $WebView2Dll
$wv2Expected='d5fdceca1991d4797148b0d20e4169d4b8e7f318d378da07ad23ac526efba644'
if((Get-FileHash -LiteralPath $WebView2Dll -Algorithm SHA256).Hash.ToLowerInvariant() -cne $wv2Expected){
 throw 'WebView2 Unified Preview DLL does not match validated v58.6.0 asset; refusing unreviewed binary'
}
# SHA-256 of validated 58.4.4 source snapshot. Do not substitute an unverified archive.
$actual=(Get-FileHash -LiteralPath $CefArchive -Algorithm SHA256).Hash.ToLowerInvariant()
$expected='07e06a42f38cab584ce4e35091d47710539cbaee21883e033ecb97565ec24eb8'
if($actual -cne $expected){throw "CEF source archive identity mismatch: expected $expected; found $actual"}
# Reuse the same offline split-stage OR flat Player plugin layout as the validated OneClick.
$finder=Join-Path $kitDir 'Find-CefRuntime.ps1'
RequireFile $finder
. $finder
$cefLayout=Find-ValidatedCefLayout -RequestedPath $CefStage -KitDir $kitDir
$CefStage=$cefLayout.Root
$plugin=Join-Path $cefLayout.Native 'CompanyWebViewCefTextureProbe.dll'
$runtime=$cefLayout.Runtime
Write-Host ('[UPM CEF] Reusing existing compiled CEF from: '+$CefStage)
RequireFile $plugin
foreach($name in @('libcef.dll','CompanyWebViewCefSubprocess.exe','icudtl.dat','resources.pak','chrome_100_percent.pak','locales\en-US.pak')){RequireFile (Join-Path $runtime $name)}
$package=Join-Path $OutputRoot 'com.company.webview'
if(Test-Path -LiteralPath $package){throw "Destination already exists; remove the previous preview package explicitly: $package"}
New-Item -ItemType Directory -Force -Path $package|Out-Null
$zip=[IO.Compression.ZipFile]::OpenRead($CefArchive)
$prefix='oneclick_bundle/Package/com.company.webview/'
try{
 foreach($entry in $zip.Entries){
  if(-not $entry.FullName.StartsWith($prefix,[StringComparison]::Ordinal)) {continue}
  $relative=$entry.FullName.Substring($prefix.Length)
  if([string]::IsNullOrWhiteSpace($relative) -or $relative.EndsWith('/')){continue}
  if($relative -match '(^|/)\.\.(/|$)'){throw 'Invalid archive entry: traversal'}
  $isRuntime=$relative.StartsWith('Runtime/',[StringComparison]::Ordinal)
  if(-not ($relative -eq 'LICENSE' -or $relative -eq 'NOTICE' -or $relative -eq 'README.md' -or
    $relative -eq 'package.json' -or $isRuntime)){continue}
  if($relative -match '^Runtime/Backends/CEF/Native/'){continue} # C++ source is not needed in Unity Assets
  $target=Join-Path $package ($relative.Replace('/','\'))
  New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent)|Out-Null
  [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$true)
 }
}finally{$zip.Dispose()}
$expectedManaged=Join-Path $package 'Runtime\WebView.cs'
RequireFile $expectedManaged
$managedBefore=(Get-FileHash -LiteralPath $expectedManaged -Algorithm SHA256).Hash
$unified=Join-Path $package 'Runtime\UnifiedExperimental'
foreach($name in @('UnifiedWebView.cs','CefTextureBackendBridge.cs','WebView2OverlayBackendBridge.cs')){
  CopySource (Join-Path $kitDir ('ExistingRuntime\'+$name)) (Join-Path $unified $name)
}
CopySource (Join-Path $kitDir 'Runtime\UnifiedWebViewPanel.cs') (Join-Path $unified 'UnifiedWebViewPanel.cs')
foreach($name in @('UnifiedWebViewSetupMenu.cs','UnifiedWebViewBuildCopy.cs','UnifiedWebViewAutoBuild.cs','Company.WebView.Editor.asmdef')){
  CopySource (Join-Path $kitDir ('Editor\'+$name)) (Join-Path $package ('Editor\'+$name))
}
CopySource $WebView2Dll (Join-Path $package 'Runtime\Plugins\x86_64\CompanyWebView2UnifiedPreview.dll')
CopySource $plugin (Join-Path $package 'Runtime\Plugins\x86_64\CompanyWebViewCefTextureProbe.dll')
# Native support resources must not be interpreted as DLLs in Editor.
$nativeOut=Join-Path $package 'NativePayload~\x86_64'
Get-ChildItem -LiteralPath $runtime -File -Recurse|ForEach-Object {
 # A flat Player Plugins directory may also contain Unity/WebView2 DLLs and logs.
 # Package only CEF runtime resources; CEF probe & WebView2 DLL were copied above.
 if($_.Name -notin @('CompanyWebViewCefTextureProbe.dll','CompanyWebView2UnifiedPreview.dll') -and
    $_.Extension -notin @('.log','.json','.pdb','.meta')) {
  $rel=$_.FullName.Substring($runtime.Length).TrimStart('\','/')
  CopySource $_.FullName (Join-Path $nativeOut $rel)
 }
}
$meta=[ordered]@{
 name='com.company.webview';version='1.1.0-preview.1';displayName='Company WebView (Windows Dual Preview)';
 unity='2022.3';description='Windows x64: validated CEF D3D11 Texture and WebView2 HWND Overlay behind experimental unified Unity API. Single instance per mode.';
 dependencies=@{'com.unity.ugui'='1.0.0'}
}
$meta | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $package 'package.json') -Encoding UTF8
CopySource (Join-Path $kitDir 'README_KO.md') (Join-Path $package 'README_KO.md')
if((Get-FileHash -LiteralPath $expectedManaged -Algorithm SHA256).Hash -ne $managedBefore){throw 'Validated CEF C# WebView changed unexpectedly'}
Write-Host ('UPM PRODUCT PREVIEW READY: '+$package)
Write-Host 'Windows x64 Standalone only. Verify prefab from Tools > Company WebView > Create Texture + Overlay Prefabs.'
