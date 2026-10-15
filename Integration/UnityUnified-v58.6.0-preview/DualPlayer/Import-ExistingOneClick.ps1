#requires -Version 5.1
# Import into the NEW bundle only. Never write back to validated old oneclick_bundle.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$LegacyPackagePath,
 [Parameter(Mandatory=$true)][string]$LegacyStagePath,
 [Parameter(Mandatory=$true)][string]$TargetBundleRoot
)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$oldPackage=[IO.Path]::GetFullPath($LegacyPackagePath)
$oldStage=[IO.Path]::GetFullPath($LegacyStagePath)
$root=[IO.Path]::GetFullPath($TargetBundleRoot)
$sourceRuntime=Join-Path $oldPackage 'Runtime'
$targetPackage=Join-Path $root 'Package\com.company.webview'
$targetRuntime=Join-Path $targetPackage 'Runtime'
$oldNative=Join-Path $oldStage 'native\Release'
$oldRuntime=Join-Path $oldStage 'runtime\Release'
if(-not (Test-Path -LiteralPath (Join-Path $oldNative 'CompanyWebViewCefTextureProbe.dll') -PathType Leaf)){
 $oldNative=$oldStage;$oldRuntime=$oldStage
}
if(-not (Test-Path -LiteralPath (Join-Path $sourceRuntime 'WebView.cs') -PathType Leaf)){
 throw 'Original CEF package Runtime\WebView.cs missing'
}
foreach($f in @((Join-Path $oldNative 'CompanyWebViewCefTextureProbe.dll'),
              (Join-Path $oldRuntime 'libcef.dll'))){
 if(-not (Test-Path -LiteralPath $f -PathType Leaf)){throw "Incomplete legacy CEF stage: $f"}
}
# Avoid recursive self-copy and importing into the frozen source directory.
if($targetPackage.TrimEnd('\') -ieq $oldPackage.TrimEnd('\')){
 throw 'Old source and destination package are identical; refusing to overwrite frozen CEF baseline'
}
if($root.TrimEnd('\') -ieq (Split-Path $oldStage -Parent).TrimEnd('\')){
 throw 'Old runtime stage is the target; refusing destructive staging'
}
if(-not (Test-Path -LiteralPath (Join-Path $targetRuntime 'WebView.cs') -PathType Leaf)){
 New-Item -ItemType Directory -Force -Path $targetPackage | Out-Null
 # Exclude all Documentation~, Samples~, Tests~: copy ONLY validated Runtime.
 Copy-Item -LiteralPath $sourceRuntime -Destination $targetPackage -Recurse -Force
}
$stage=Join-Path $root 'Build\cef-native\stage'
$native=Join-Path $stage 'native\Release'
$runtime=Join-Path $stage 'runtime\Release'
New-Item -ItemType Directory -Force -Path $native,$runtime | Out-Null
if(-not (Test-Path -LiteralPath (Join-Path $native 'CompanyWebViewCefTextureProbe.dll') -PathType Leaf)){
 Copy-Item -LiteralPath (Join-Path $oldNative 'CompanyWebViewCefTextureProbe.dll') -Destination $native -Force
}
if(-not (Test-Path -LiteralPath (Join-Path $runtime 'libcef.dll') -PathType Leaf)){
 foreach($item in (Get-ChildItem -LiteralPath $oldRuntime -Force)){
  if($item.Name -match '^(smoke-cache|cef-cache|profiles|logs|results)$'){continue}
  if($item.PSIsContainer){
   Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $runtime $item.Name) -Recurse -Force
  } elseif($item.Extension -notin @('.log','.json','.pdb')){
   Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $runtime $item.Name) -Force
  }
 }
}
foreach($name in @('CompanyWebViewCefSubprocess.exe','libcef.dll','icudtl.dat','resources.pak',
                 'chrome_100_percent.pak','locales\en-US.pak')){
 if(-not (Test-Path -LiteralPath (Join-Path $runtime $name) -PathType Leaf)){
  throw "New bundled CEF stage incomplete: $name"
 }
}
if(-not (Test-Path -LiteralPath (Join-Path $targetRuntime 'WebView.cs') -PathType Leaf)){
 throw 'New bundled CEF managed Runtime import incomplete'
}
if(-not (Test-Path -LiteralPath (Join-Path $native 'CompanyWebViewCefTextureProbe.dll') -PathType Leaf)){
 throw 'New bundled CEF native DLL import incomplete'
}
Write-Host '[DUAL] New oneclick_bundle Runtime + native stage imported; old oneclick_bundle unchanged'
