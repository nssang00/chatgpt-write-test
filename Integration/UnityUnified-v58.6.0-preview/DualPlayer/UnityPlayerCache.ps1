#requires -Version 5.1
# Cache only built experimental Unity Players. Validated CEF v58.4.4 sources/stage are read-only.
Set-StrictMode -Version Latest

function Get-DualPlayerCacheKey {
 [CmdletBinding()]
 param(
  [Parameter(Mandatory=$true)][string]$KitManifest,
  [Parameter(Mandatory=$true)][string]$UnityExe,
  [Parameter(Mandatory=$true)][string]$CefSource,
  [Parameter(Mandatory=$true)][string]$CefStage,
  [Parameter(Mandatory=$true)][string]$NativeDll,
  [Parameter(Mandatory=$true)][string]$RuntimeDir
 )
 $unityInfo=Get-Item -LiteralPath $UnityExe -ErrorAction Stop
 $lib=Get-Item -LiteralPath (Join-Path $RuntimeDir 'libcef.dll') -ErrorAction Stop
 $nativePath=Join-Path $NativeDll 'CompanyWebViewCefTextureProbe.dll'
 $nativeInfo=Get-Item -LiteralPath $nativePath -ErrorAction Stop
 $srcRuntime=Join-Path $CefSource 'Runtime'
 if(-not (Test-Path -LiteralPath $srcRuntime -PathType Container)){throw 'Validated CEF managed Runtime is missing'}
 $files=@(Get-ChildItem -LiteralPath $srcRuntime -File -Filter '*.cs' -Recurse |
   Sort-Object FullName)
 if($files.Count -eq 0){throw 'Validated CEF source has no C# Runtime'}
 $data=New-Object System.Collections.Generic.List[string]
 $data.Add('CompanyWebView-v58.6.0-experimental-PlayerCache-v1')
 $data.Add((Get-FileHash -LiteralPath $KitManifest -Algorithm SHA256).Hash)
 $data.Add([IO.Path]::GetFullPath($UnityExe).ToLowerInvariant())
 $data.Add(('{0}/{1}' -f $unityInfo.Length,$unityInfo.LastWriteTimeUtc.Ticks))
 $data.Add([IO.Path]::GetFullPath($CefStage).ToLowerInvariant())
 $data.Add((Get-FileHash -LiteralPath $nativePath -Algorithm SHA256).Hash)
 $data.Add(('{0}/{1}' -f $nativeInfo.Length,$nativeInfo.LastWriteTimeUtc.Ticks))
 $data.Add([IO.Path]::GetFullPath($lib.FullName).ToLowerInvariant())
 $data.Add(('{0}/{1}' -f $lib.Length,$lib.LastWriteTimeUtc.Ticks))
 foreach($f in $files){
  $relative=$f.FullName.Substring($srcRuntime.Length).TrimStart('\','/').Replace('\','/')
  $data.Add($relative)
  $data.Add((Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash)
 }
 $sha=[Security.Cryptography.SHA256]::Create()
 try{$bytes=$sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($data.ToArray() -join [Environment]::NewLine)))}
 finally{$sha.Dispose()}
 return ([BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant().Substring(0,24))
}
function Test-DualPlayerCache {
 [CmdletBinding()]
 param([Parameter(Mandatory=$true)][string]$Work,
       [Parameter(Mandatory=$true)][string]$Key)
 $marker=Join-Path $Work 'PlayerCache.key'
 if(-not (Test-Path -LiteralPath $marker -PathType Leaf)){return $false}
 if((Get-Content -LiteralPath $marker -Raw -Encoding UTF8).Trim() -cne $Key){return $false}
 $player=Join-Path $Work 'Player\UnifiedDualPreview.exe'
 if(-not (Test-Path -LiteralPath $player -PathType Leaf)){return $false}
 $plugin=Join-Path $Work 'Player\UnifiedDualPreview_Data\Plugins\x86_64'
 foreach($name in @('CompanyWebViewCefTextureProbe.dll','CompanyWebView2UnifiedPreview.dll',
  'CompanyWebViewCefSubprocess.exe','libcef.dll','icudtl.dat','resources.pak','chrome_100_percent.pak','locales\en-US.pak')){
  if(-not (Test-Path -LiteralPath (Join-Path $plugin $name) -PathType Leaf)){return $false}
 }
 return $true
}
