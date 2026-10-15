#requires -Version 5.1
# This bootstrapper never prompts: reuse a validated stage, else download/build the EXACT pinned CEF 58.4.4.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$BundleRoot,
 [string]$ExplicitDir='',
 [Parameter(Mandatory=$true)][string]$UnityExe,
 [switch]$NoAutoDownload,
 [switch]$VerifyOnly
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$expectedSourceSha='07e06a42f38cab584ce4e35091d47710539cbaee21883e033ecb97565ec24eb8'
$pinnedVersion='154.0.28+g564dd6c+chromium-154.0.8037.58'
$dist='cef_binary_'+$pinnedVersion+'_windows64'
$cefArchive=$dist+'.tar.bz2'
$cache=Join-Path $env:LOCALAPPDATA 'CompanyWebView\CEF-v58.4.4'
$build=Join-Path $cache 'Build\cef-native'
$stage=Join-Path $build 'stage'
$sourceArchive=Join-Path $BundleRoot 'CefOneClick-v58.4.4-source.zip'
$sourceBundle=Join-Path $cache 'oneclick_bundle'
$extracted=Join-Path $cache 'Downloads\cef'
$cefRoot=Join-Path $extracted $dist
$download=Join-Path $cache ('Downloads\'+$cefArchive)
function IsValidStage([string]$candidate) {
 if([string]::IsNullOrWhiteSpace($candidate) -or -not (Test-Path -LiteralPath $candidate -PathType Container)){return $false}
 $native=Join-Path $candidate 'native\Release';$runtime=Join-Path $candidate 'runtime\Release'
 if(-not (Test-Path -LiteralPath (Join-Path $native 'CompanyWebViewCefTextureProbe.dll') -PathType Leaf)){$native=$candidate;$runtime=$candidate}
 if(-not (Test-Path -LiteralPath (Join-Path $native 'CompanyWebViewCefTextureProbe.dll') -PathType Leaf)){return $false}
 foreach($n in @('libcef.dll','CompanyWebViewCefSubprocess.exe','icudtl.dat','resources.pak','chrome_100_percent.pak','locales\en-US.pak')){
  if(-not (Test-Path -LiteralPath (Join-Path $runtime $n) -PathType Leaf)){return $false}
 }
 return $true
}
function AddIfValid([string]$candidate){if(IsValidStage $candidate){return [IO.Path]::GetFullPath($candidate)};return $null}
# Accept an entire legacy oneclick_bundle, a container with oneclick_bundle inside,
# or an already compiled stage. Never modify the old OneClick tree.
function FindStageUnderFolder([string]$folder) {
 if([string]::IsNullOrWhiteSpace($folder) -or -not (Test-Path -LiteralPath $folder -PathType Container)){return $null}
 foreach($suffix in @(
  '',
  'Build\cef-native\stage',
  'oneclick_bundle\Build\cef-native\stage',
  'UnityHarness\Build\CompanyWebViewCefProbe_Data\Plugins\x86_64',
  'oneclick_bundle\UnityHarness\Build\CompanyWebViewCefProbe_Data\Plugins\x86_64'
 )){
  $candidate=if($suffix){Join-Path $folder $suffix}else{$folder}
  if(IsValidStage $candidate){return [IO.Path]::GetFullPath($candidate)}
 }
 return $null
}
function CandidateSearch {
 $roots=@(
  $BundleRoot,
  (Split-Path -Parent $BundleRoot),
  (Split-Path -Parent (Split-Path -Parent $BundleRoot)),
  (Join-Path $env:USERPROFILE 'Downloads'),
  (Join-Path $env:USERPROFILE 'Desktop'),
  (Join-Path $env:LOCALAPPDATA 'CompanyWebView\CEF-v58.4.4\oneclick_bundle')
 )
 if($env:CEF_V58_4_4_RUNTIME_DIR){$roots=@($env:CEF_V58_4_4_RUNTIME_DIR)+$roots}
 $prior=Join-Path $BundleRoot '.cef-runtime-local.txt'
 if(Test-Path -LiteralPath $prior -PathType Leaf){
  $last=(Get-Content -LiteralPath $prior -Raw -Encoding UTF8).Trim().Trim('"')
  if($last){$roots=@($last)+$roots}
 }
 $seen=@{}
 foreach($rootDir in $roots){
  if(-not $rootDir -or -not (Test-Path -LiteralPath $rootDir -PathType Container)){continue}
  $rootFull=[IO.Path]::GetFullPath($rootDir)
  if($seen.ContainsKey($rootFull)){continue}
  $seen[$rootFull]=$true
  $direct=FindStageUnderFolder $rootFull
  if($direct){return $direct}
  # At most two folder levels; do not recursively crawl users' disks.
  $level1=@(Get-ChildItem -LiteralPath $rootFull -Directory -ErrorAction SilentlyContinue |
    Where-Object {$_.Name -match '(?i)oneclick|cef|webview|company|58' } |
    Select-Object -First 100)
  foreach($one in $level1){
   $stage1=FindStageUnderFolder $one.FullName
   if($stage1){return $stage1}
   $level2=@(Get-ChildItem -LiteralPath $one.FullName -Directory -ErrorAction SilentlyContinue |
     Where-Object {$_.Name -match '(?i)oneclick|cef|webview|company|58|bundle' } |
     Select-Object -First 60)
   foreach($two in $level2){
    $stage2=FindStageUnderFolder $two.FullName
    if($stage2){return $stage2}
   }
  }
 }
 return $null
}
if($ExplicitDir){
 $resolved=FindStageUnderFolder $ExplicitDir
 if(-not $resolved){throw 'Selected oneclick_bundle contains no compiled CEF runtime stage; expected Build\cef-native\stage (or Player Plugins\x86_64).'}
 Write-Host '[CEF AUTO] Existing oneclick_bundle/runtime reuse verified'
 Write-Output $resolved;return
}
if(IsValidStage $stage){
 Write-Host '[CEF AUTO] Using persistent compiled cache'
 Write-Output $stage;return
}
$found=CandidateSearch
if($found){Write-Host '[CEF AUTO] Existing Windows CEF stage located automatically';Write-Output $found;return}
if($VerifyOnly){throw 'CEF_AUTO_NOT_CACHED'}
if($NoAutoDownload){throw 'No previous v58.4.4 runtime found; automatic CEF bootstrap disabled'}
if(-not (Test-Path -LiteralPath $sourceArchive -PathType Leaf)){throw 'Pinned CefOneClick-v58.4.4-source.zip is missing from this kit.'}
$actual=(Get-FileHash -LiteralPath $sourceArchive -Algorithm SHA256).Hash.ToLowerInvariant()
if($actual -ne $expectedSourceSha){throw 'Pinned CEF source SHA256 mismatch. Refusing unknown native source.'}
if(-not (Test-Path -LiteralPath $UnityExe -PathType Leaf)){throw 'Unity 2022.3.62f3 needed for native PluginAPI headers.'}
$unityPluginApi=Join-Path (Split-Path -Parent $UnityExe) 'Data\PluginAPI'
if(-not (Test-Path -LiteralPath $unityPluginApi -PathType Container)){throw 'Unity Editor PluginAPI headers missing; install Unity Windows Build Support.'}
$cmake=Get-Command cmake.exe -ErrorAction SilentlyContinue
if(-not $cmake){
 $fallback='C:\Program Files\CMake\bin\cmake.exe'
 if(Test-Path -LiteralPath $fallback -PathType Leaf){$env:PATH+=( ';'+(Split-Path -Parent $fallback))}
 else{throw 'CMake 3.20+ is needed to auto-build CEF. Install Kitware CMake, then rerun.'}
}
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if(-not (Test-Path -LiteralPath $vswhere -PathType Leaf)){throw 'Visual Studio 2022 C++ Build Tools are required once to build CEF.'}
$vsDir=(& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
if(-not $vsDir){throw 'Visual Studio 2022 MSVC x64 toolchain not found. Install Desktop C++ workload.'}
if(-not (Get-Command tar.exe -ErrorAction SilentlyContinue)){throw 'Windows tar.exe is required to decompress CEF.'}
New-Item -ItemType Directory -Force -Path $cache,$extracted,(Split-Path -Parent $download) | Out-Null
if(-not (Test-Path -LiteralPath (Join-Path $sourceBundle 'config.json') -PathType Leaf)){
 Write-Host '[CEF AUTO] Restoring exact v58.4.4 validated OneClick sources'
 $temp=Join-Path $cache 'validated-source-extract'
 New-Item -ItemType Directory -Force -Path $temp | Out-Null
 # Extract only pinned build inputs. The original archive also contains long
 # Documentation~ and UnityHarness paths not required for CEF native compilation.
 # Skipping these avoids repeating the reported Windows MAX_PATH failure.
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $archive=[IO.Compression.ZipFile]::OpenRead($sourceArchive)
 try {
  $prefix='oneclick_bundle/Package/com.company.webview/Runtime/'
  $selected=0
  foreach($entry in $archive.Entries){
   $name=$entry.FullName
   if($name -ne 'oneclick_bundle/config.json' -and
      $name -ne 'oneclick_bundle/Tools/Build-CefWindowsX64.ps1' -and
      -not $name.StartsWith($prefix,[StringComparison]::Ordinal)){continue}
   if(-not $entry.Name){continue}
   $destination=[IO.Path]::GetFullPath((Join-Path $temp ($name.Replace('/',[IO.Path]::DirectorySeparatorChar))))
   $safeRoot=[IO.Path]::GetFullPath($temp).TrimEnd('\\')+[IO.Path]::DirectorySeparatorChar
   if(-not $destination.StartsWith($safeRoot,[StringComparison]::OrdinalIgnoreCase)){
    throw 'Unsafe CEF source archive path'
   }
   New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
   [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$destination,$true)
   $selected++
  }
  if($selected -lt 10){throw 'Pinned source extraction incomplete'}
 }finally{$archive.Dispose()}
 $original=Join-Path $temp 'oneclick_bundle'
 if(-not (Test-Path -LiteralPath (Join-Path $original 'Tools\Build-CefWindowsX64.ps1') -PathType Leaf)){throw 'Unexpected pinned source archive layout'}
 Copy-Item -LiteralPath $original -Destination $sourceBundle -Recurse -Force
}
$config=Get-Content (Join-Path $sourceBundle 'config.json') -Raw | ConvertFrom-Json
if($config.harnessVersion -ne '58.4.4' -or $config.cefVersion -ne $pinnedVersion -or $config.cefPlatform -ne 'windows64'){
 throw 'CEF baseline build config differs from pinned v58.4.4 values.'
}
if(-not (Test-Path -LiteralPath (Join-Path $cefRoot 'CMakeLists.txt') -PathType Leaf)){
 [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
 $url='https://cef-builds.spotifycdn.com/'+$cefArchive.Replace('+','%2B')
 $shaFile=$download+'.sha1'
 if(-not (Test-Path -LiteralPath $shaFile -PathType Leaf)){
  Write-Host '[CEF AUTO] Getting official CEF SHA1 metadata'
  Invoke-WebRequest -Uri ($url+'.sha1') -OutFile $shaFile -UseBasicParsing
 }
 $expectedSha=(Get-Content -LiteralPath $shaFile -Raw -Encoding ASCII).Trim()
 if($expectedSha -notmatch '^[a-fA-F0-9]{40}$'){throw 'Official CEF checksum is missing or invalid.'}
 $ok=$false
 if(Test-Path -LiteralPath $download -PathType Leaf){
  $ok= (Get-FileHash -LiteralPath $download -Algorithm SHA1).Hash -ieq $expectedSha
 }
 if(-not $ok){
  if(Test-Path -LiteralPath $download){Remove-Item -LiteralPath $download -Force}
  Write-Host '[CEF AUTO] Downloading pinned CEF distribution (large file, first run only)'
  $partial=$download+'.partial'
  try{
   Invoke-WebRequest -Uri $url -OutFile $partial -UseBasicParsing
   if((Get-FileHash -LiteralPath $partial -Algorithm SHA1).Hash -ine $expectedSha){throw 'Official CEF binary SHA1 check failed.'}
   Move-Item -LiteralPath $partial -Destination $download -Force
  }finally{if(Test-Path -LiteralPath $partial){Remove-Item -LiteralPath $partial -Force}}
 }
 Write-Host '[CEF AUTO] Extracting verified CEF distribution'
 & tar.exe -xjf $download -C $extracted
 if($LASTEXITCODE -ne 0){throw "Windows tar failed to extract CEF distribution (exit $LASTEXITCODE)"}
 if(-not (Test-Path -LiteralPath (Join-Path $cefRoot 'CMakeLists.txt') -PathType Leaf)){throw 'CEF extracted root not found'}
}
Write-Host '[CEF AUTO] Compiling pinned CEF 58.4.4 x64 runtime'
$builder=Join-Path $sourceBundle 'Tools\Build-CefWindowsX64.ps1'
$buildLog=Join-Path $cache 'Build\cef-native-build.log'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $buildLog) | Out-Null
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $builder -CefRoot $cefRoot -UnityPluginApi $unityPluginApi -BuildDir $build -LogDir (Join-Path $cache 'Build\logs') *>&1 | Tee-Object -FilePath $buildLog | Out-Host
if($LASTEXITCODE -ne 0){throw 'Pinned CEF native build failed. Inspect persistent cache Build\cef-native-build.log.'}
if(-not (IsValidStage $stage)){throw 'CEF build did not produce all expected runtime resources.'}
Write-Host '[CEF AUTO] Pinned runtime ready; no folder input was needed'
Write-Output $stage
