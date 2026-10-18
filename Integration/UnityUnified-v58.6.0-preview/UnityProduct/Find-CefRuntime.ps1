#requires -Version 5.1
# Offline-only, bounded lookup for previously built CEF 58.4.4. Never downloads or compiles.
# Returns one split-stage or flat Unity Player plugin directory with all required files.
function Test-ExistingCefLayout {
 [CmdletBinding()]
 param([string]$Folder)
 if([string]::IsNullOrWhiteSpace($Folder) -or -not (Test-Path -LiteralPath $Folder -PathType Container)){return $null}
 $path=[IO.Path]::GetFullPath($Folder)
 $native=Join-Path $path 'native\Release'
 $runtime=Join-Path $path 'runtime\Release'
 if(-not (Test-Path -LiteralPath (Join-Path $native 'CompanyWebViewCefTextureProbe.dll') -PathType Leaf)){
  $native=$path;$runtime=$path
 }
 if(-not (Test-Path -LiteralPath (Join-Path $native 'CompanyWebViewCefTextureProbe.dll') -PathType Leaf)){return $null}
 foreach($file in @('libcef.dll','CompanyWebViewCefSubprocess.exe','icudtl.dat','resources.pak',
                    'chrome_100_percent.pak','locales\en-US.pak')){
  if(-not (Test-Path -LiteralPath (Join-Path $runtime $file) -PathType Leaf)){return $null}
 }
 return @{Root=$path;Native=$native;Runtime=$runtime}
}
function Find-ExistingCefInFolder {
 [CmdletBinding()]
 param([string]$Folder)
 if([string]::IsNullOrWhiteSpace($Folder) -or -not (Test-Path -LiteralPath $Folder -PathType Container)){return $null}
 foreach($suffix in @('', 'Build\cef-native\stage','oneclick_bundle\Build\cef-native\stage',
  'Player\UnifiedDualPreview_Data\Plugins\x86_64',
  'UnityProject\Assets\Plugins\x86_64',
  'UnityHarness\Build\CompanyWebViewCefProbe_Data\Plugins\x86_64',
  'oneclick_bundle\UnityHarness\Build\CompanyWebViewCefProbe_Data\Plugins\x86_64')){
  $candidate=if($suffix){Join-Path $Folder $suffix}else{$Folder}
  $layout=Test-ExistingCefLayout -Folder $candidate
  if($null -ne $layout){return $layout}
 }
 return $null
}
function Find-ValidatedCefLayout {
 [CmdletBinding()]
 param([string]$RequestedPath='', [string]$KitDir='')
 # A caller-supplied path is authoritative, and never silently replaced by other binaries.
 if(-not [string]::IsNullOrWhiteSpace($RequestedPath)){
  $explicit=Find-ExistingCefInFolder -Folder $RequestedPath
  if($null -eq $explicit){
   throw "CEF runtime incomplete at -CefStage '$RequestedPath'. Supply an existing split Build\cef-native\stage OR flat Player\UnifiedDualPreview_Data\Plugins\x86_64 containing libcef.dll and CompanyWebViewCefTextureProbe.dll."
  }
  return $explicit
 }
 $roots=New-Object 'System.Collections.Generic.List[string]'
 if(-not [string]::IsNullOrWhiteSpace($env:CEF_V58_4_4_RUNTIME_DIR)){$roots.Add($env:CEF_V58_4_4_RUNTIME_DIR)}
 if(-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)){
  $cache=Join-Path $env:LOCALAPPDATA 'CWV58'
  foreach($name in @('pc','dual-*')){
   if($name -eq 'pc'){
    $base=Join-Path $cache 'pc'
    if(Test-Path -LiteralPath $base -PathType Container){
     foreach($d in @(Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 96)){$roots.Add($d.FullName)}
    }
   }else{
    if(Test-Path -LiteralPath $cache -PathType Container){
     foreach($d in @(Get-ChildItem -LiteralPath $cache -Directory -Filter $name -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 64)){$roots.Add($d.FullName)}
    }
   }
  }
  $roots.Add((Join-Path $env:LOCALAPPDATA 'CompanyWebView\CEF-v58.4.4\Build\cef-native\stage'))
  $roots.Add((Join-Path $env:LOCALAPPDATA 'CompanyWebView\CEF-v58.4.4\oneclick_bundle'))
 }
 if(-not [string]::IsNullOrWhiteSpace($KitDir)){
  $roots.Add($KitDir)
  $roots.Add((Split-Path -Path $KitDir -Parent))
 }
 if(-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)){
  foreach($kind in @('Downloads','Desktop')){
   $base=Join-Path $env:USERPROFILE $kind
   if(-not (Test-Path -LiteralPath $base -PathType Container)){continue}
   $roots.Add($base)
   # Only search two known, bounded directory levels; never recurse across the disk.
   $top=@(Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue |
      Where-Object {$_.Name -match '(?i)cef|oneclick|webview|dual|58'} |
      Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 96)
   foreach($d in $top){
    $roots.Add($d.FullName)
    $one=Join-Path $d.FullName 'oneclick_bundle'
    $roots.Add($one)
    $child=@(Get-ChildItem -LiteralPath $d.FullName -Directory -ErrorAction SilentlyContinue |
      Where-Object {$_.Name -match '(?i)cef|oneclick|webview|dual|58|bundle'} |
      Select-Object -First 32)
    foreach($sub in $child){$roots.Add($sub.FullName)}
   }
  }
 }
 $seen=@{}
 foreach($folder in $roots){
  if([string]::IsNullOrWhiteSpace($folder)){continue}
  if($seen.ContainsKey($folder)){continue}
  $seen[$folder]=$true
  $layout=Find-ExistingCefInFolder -Folder $folder
  if($null -ne $layout){return $layout}
 }
 throw 'No previously built CEF 58.4.4 runtime found. No download attempted. Pass -CefStage to your existing oneclick_bundle\Build\cef-native\stage or %LOCALAPPDATA%\CWV58\pc\<cache-key>\Player\UnifiedDualPreview_Data\Plugins\x86_64.'
}
