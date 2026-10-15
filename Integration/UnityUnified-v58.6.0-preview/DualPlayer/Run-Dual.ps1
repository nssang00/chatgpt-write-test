#requires -Version 5.1
param([string]$BundleRoot=$PSScriptRoot,[string]$CefRuntimeDir='',[string]$UnityExe='',
 [ValidateRange(30,300)][int]$AutoSeconds=120,[switch]$SelfTest,[switch]$NoScreenshots,[switch]$TestMissingRuntime)
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
$root=[IO.Path]::GetFullPath((Join-Path $BundleRoot '.'))
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$out=Join-Path $root ('results\dual-'+$stamp)
# Short LOCAL build directory avoids MAX_PATH under Downloads and long Documentation~ names.
$work=Join-Path $env:LOCALAPPDATA ('CWV58\dual-'+$stamp)
$summary=[ordered]@{capturePolicy='Foreground Unity window only; no desktop capture';harness='58.6.0-dual-experimental';status='FAIL';autoChecks='NOT_RUN';stage='PREFLIGHT';problems=@();manualChecks='PENDING'}
function Need([bool]$ok,[string]$msg){if(-not $ok){throw $msg}}
function VerifyKit {
 # The unified sources and WebView2 binary ship directly in this one-folder kit.
 # CEF source is reused directly from the pre-existing validated oneclick_bundle.
 $manifest=Join-Path $root 'SHA256SUMS.txt';Need (Test-Path -LiteralPath $manifest) 'SHA256SUMS.txt missing'
 $count=0
 foreach($line in (Get-Content -LiteralPath $manifest -Encoding UTF8)){
  if([string]::IsNullOrWhiteSpace($line)){continue}
  Need ($line -match '^([0-9A-Fa-f]{64})  (.+)$') 'Malformed kit checksum line'
  $want=$Matches[1].ToLowerInvariant();$rel=$Matches[2].Replace('/',[IO.Path]::DirectorySeparatorChar)
  Need (-not [IO.Path]::IsPathRooted($rel) -and $rel -notmatch '(^|[\\/])\.\.([\\/]|$)') 'Unsafe manifest path'
  $path=Join-Path $root $rel
  Need (Test-Path -LiteralPath $path -PathType Leaf) "Missing kit file: $rel"
  Need ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -eq $want) "Checksum mismatch: $rel"
  $count++
 }
 Need ($count -ge 8) 'Incomplete kit manifest'
 Write-Host "[DUAL] Source identity verified: $count entries"
}
function FindUnity {
 if($UnityExe){Need (Test-Path -LiteralPath $UnityExe -PathType Leaf) 'Invalid -UnityExe';return $UnityExe}
 if($env:UNITY_EDITOR_PATH -and (Test-Path -LiteralPath $env:UNITY_EDITOR_PATH)){return $env:UNITY_EDITOR_PATH}
 $d='C:\Program Files\Unity\Hub\Editor\2022.3.62f3\Editor\Unity.exe'
 Need (Test-Path -LiteralPath $d -PathType Leaf) 'Unity 2022.3.62f3 missing, use -UnityExe'
 return $d
}
function ResolveCefRuntime {
 # No prompt: use previous v58.4.4 native stage or build the exact pinned baseline automatically.
 $helper=Join-Path $root 'DualPlayer\Ensure-CefRuntime.ps1'
 Need (Test-Path -LiteralPath $helper -PathType Leaf) 'Missing CEF automation helper'
 $stage=@(& $helper -BundleRoot $root -ExplicitDir $CefRuntimeDir -UnityExe $unity)
 Need ($stage.Count -eq 1 -and -not [string]::IsNullOrWhiteSpace($stage[0])) 'CEF automation could not resolve a complete pinned native stage'
 return [string]$stage[0]
}
function GetCefPackageFromBundle([string]$stageDir){
 # Reuse original CEF v58.4.4 source tree READ-ONLY. No copy back into oneclick_bundle.
 $roots=@($root,(Split-Path $root -Parent),
  (Join-Path $env:USERPROFILE 'Downloads'),(Join-Path $env:USERPROFILE 'Desktop'))
 # Stage normally lives under oneclick_bundle\Build\cef-native\stage
 $up=$stageDir
 for($k=0;$k -lt 6;$k++){
  if(-not $up){break}
  $roots=@($up)+$roots
  $next=Split-Path $up -Parent
  if($next -eq $up){break}
  $up=$next
 }
 foreach($r in $roots){
  if(-not $r -or -not (Test-Path -LiteralPath $r -PathType Container)){continue}
  foreach($relative in @('Package\com.company.webview',
    'oneclick_bundle\Package\com.company.webview',
    'Assemble\UnityProject\Assets\CompanyWebView')){
   $path=Join-Path $r $relative
   if(Test-Path -LiteralPath (Join-Path $path 'Runtime\WebView.cs') -PathType Leaf){
    Write-Host '[DUAL] Reusing existing oneclick_bundle CEF Unity source (read-only)'
    return $path
   }
  }
  # Bounded search: sibling/Downloads oneclick_bundle only, no full-disk indexing.
  $dirs=@(Get-ChildItem -LiteralPath $r -Directory -ErrorAction SilentlyContinue |
     Where-Object {$_.Name -match '(?i)oneclick|cef|webview' } | Select-Object -First 60)
  foreach($dir in $dirs){
   $source=Join-Path $dir.FullName 'Package\com.company.webview'
   if(Test-Path -LiteralPath (Join-Path $source 'Runtime\WebView.cs') -PathType Leaf){
    Write-Host '[DUAL] Reusing existing oneclick_bundle CEF Unity source (read-only)'
    return $source
   }
  }
 }
 throw 'Existing oneclick_bundle/Package/com.company.webview source folder not found. Keep the original compiled oneclick_bundle next to this kit.'
}
function GetCefStageLayout([string]$from){
 Need (-not [string]::IsNullOrWhiteSpace($from) -and (Test-Path -LiteralPath $from -PathType Container)) 'CEF v58.4.4 native runtime folder not found. Use a previously BUILT CEF stage folder, not the source ZIP.'
 $native=Join-Path $from 'native\Release';$runtime=Join-Path $from 'runtime\Release'
 if(-not (Test-Path -LiteralPath (Join-Path $native 'CompanyWebViewCefTextureProbe.dll') -PathType Leaf)){
  $native=$from;$runtime=$from
 }
 Need (Test-Path -LiteralPath (Join-Path $native 'CompanyWebViewCefTextureProbe.dll') -PathType Leaf) 'CEF probe DLL not found; select Build\cef-native\stage or validated Player Plugins\x86_64.'
 Need (Test-Path -LiteralPath (Join-Path $runtime 'libcef.dll') -PathType Leaf) 'CEF libcef.dll not found. Source-only ZIP is not the compiled CEF runtime.'
 return @{native=$native;runtime=$runtime}
}
function StageCef([string]$from,[string]$to) {
 $layout=GetCefStageLayout $from
 $native=$layout.native;$runtime=$layout.runtime
 New-Item -ItemType Directory -Force -Path $to | Out-Null
 foreach($item in (Get-ChildItem -LiteralPath $runtime -Force)){
  if($item.Name -match '^(smoke-cache|cef-cache|profiles|logs|Results)$'){continue}
  if($item.PSIsContainer){Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $to $item.Name) -Recurse -Force}
  elseif($item.Extension -notin @('.log','.json','.pdb')){Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $to $item.Name) -Force}
 }
 Copy-Item -LiteralPath (Join-Path $native 'CompanyWebViewCefTextureProbe.dll') -Destination $to -Force
 foreach($name in @('CompanyWebViewCefTextureProbe.dll','CompanyWebViewCefSubprocess.exe','libcef.dll','icudtl.dat','resources.pak','chrome_100_percent.pak','locales\en-US.pak')){
  Need (Test-Path -LiteralPath (Join-Path $to $name) -PathType Leaf) "CEF runtime resource missing: $name"
 }
}
$code=2
try {
 if($TestMissingRuntime){throw 'TEST_ONLY: simulated missing CEF runtime; intentionally no Unity execution'}
 VerifyKit
 if($SelfTest){$summary.status='SELFTEST_PASS';$summary.stage='SELFTEST';$code=0}
 else {
  Need ($env:OS -eq 'Windows_NT' -and [IntPtr]::Size -eq 8) 'Windows x64 only'
  $unity=FindUnity
  $CefRuntimeDir=ResolveCefRuntime
  $layout=GetCefStageLayout $CefRuntimeDir
  $legacySource=GetCefPackageFromBundle $CefRuntimeDir
  New-Item -ItemType Directory -Force -Path $out,$work | Out-Null

  # New extracted archive has its OWN oneclick_bundle/ with Package and Build.
  $bundledPackage=Join-Path $root 'Package\com.company.webview'
  $localStage=Join-Path $root 'Build\cef-native\stage'
  $localManaged=Join-Path $bundledPackage 'Runtime\WebView.cs'
  if(-not (Test-Path -LiteralPath $localManaged -PathType Leaf) -or
     -not (Test-Path -LiteralPath (Join-Path $localStage 'runtime\Release\libcef.dll') -PathType Leaf)){
    $importer=Join-Path $root 'DualPlayer\Import-ExistingOneClick.ps1'
    Need (Test-Path -LiteralPath $importer -PathType Leaf) 'Missing existing OneClick importer'
    & $importer -LegacyPackagePath $legacySource -LegacyStagePath $CefRuntimeDir -TargetBundleRoot $root
  }
  $null=GetCefStageLayout $localStage
  $source=$bundledPackage
  $CefRuntimeDir=$localStage
  Write-Host '[DUAL] Local oneclick_bundle Package + Build stage populated and verified'
  $project=Join-Path $work 'UnityProject'
  foreach($p in @('Assets\Editor','Assets\Scripts','Packages','ProjectSettings')){New-Item -ItemType Directory -Force -Path (Join-Path $project $p) | Out-Null}
  # Create and verify the missing UnifiedExperimental directory BEFORE copying sources.
  # Shared with Windows CI's realistic OneClick Unity Assets assembly fixture.
  $assembler=Join-Path $root 'DualPlayer\Install-UnifiedManagedSources.ps1'
  Need (Test-Path -LiteralPath $assembler -PathType Leaf) 'Unified managed-source installer missing from kit'
  & $assembler -CefPackagePath $source -UnityAssetsDir (Join-Path $project 'Assets') -KitRoot $root
  $runtime=Join-Path $project 'Assets\CompanyWebView\Runtime\UnifiedExperimental'
  Need (Test-Path -LiteralPath (Join-Path $runtime 'UnifiedWebView.cs') -PathType Leaf) 'Unified facade copy failed'
  Copy-Item -LiteralPath (Join-Path $root 'DualPlayer\BuildUnifiedDualPlayer.cs') -Destination (Join-Path $project 'Assets\Editor')
  Copy-Item -LiteralPath (Join-Path $root 'DualPlayer\UnifiedDualPlayerEvidence.cs') -Destination (Join-Path $project 'Assets\Scripts')
  '{"dependencies":{"com.unity.ugui":"1.0.0","com.unity.modules.jsonserialize":"1.0.0"}}' | Set-Content -LiteralPath (Join-Path $project 'Packages\manifest.json') -Encoding UTF8
  'm_EditorVersion: 2022.3.62f3' | Set-Content -LiteralPath (Join-Path $project 'ProjectSettings\ProjectVersion.txt') -Encoding UTF8
  $srcDll=Join-Path $root 'Plugins\x86_64\CompanyWebView2UnifiedPreview.dll'
  Need (Test-Path -LiteralPath $srcDll) 'No compiled WebView2 unified DLL'
  $dest=Join-Path $project 'Assets\Plugins\x86_64'
  StageCef $CefRuntimeDir $dest
  Copy-Item -LiteralPath $srcDll -Destination $dest -Force
  $summary.stage='UNITY_BUILD'
  $summary.buildWorkspace='LOCALAPPDATA/CWV58 (short path)'
  $player=Join-Path $work 'Player\UnifiedDualPreview.exe'
  New-Item -ItemType Directory -Force -Path (Split-Path $player -Parent) | Out-Null
  $buildLog=Join-Path $out 'unity-editor-build.log'
  $arg=('-batchmode -nographics -quit -buildTarget Win64 -projectPath "{0}" -executeMethod BuildUnifiedDualPlayer.Build -dualBuildPath "{1}" -logFile "{2}"' -f $project,$player,$buildLog)
  $p=Start-Process -FilePath $unity -ArgumentList $arg -PassThru
  if(-not $p.WaitForExit(1200000)){Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue;throw 'Unity build timeout'}
  Need ($p.ExitCode -eq 0) "Unity build failed: $($p.ExitCode)"
  Need (Test-Path -LiteralPath $player) 'Player exe not generated'
  $plugin=Join-Path $work 'Player\UnifiedDualPreview_Data\Plugins\x86_64'
  StageCef $CefRuntimeDir $plugin
  Copy-Item -LiteralPath $srcDll -Destination $plugin -Force
  $summary.stage='PLAYER_RUNTIME'
  $runtimeJson=Join-Path $out 'player-runtime-evidence.json'
  $log=Join-Path $out 'unity-player.log'
  Write-Host "[DUAL] Open both views (CEF Texture LEFT, WebView2 RIGHT) for $AutoSeconds seconds"
  $arg=('-screen-fullscreen 0 -screen-width 1400 -screen-height 850 -dualDuration {0} -dualEvidencePath "{1}" -logFile "{2}"' -f $AutoSeconds,$runtimeJson,$log)
  $p=Start-Process -FilePath $player -ArgumentList $arg -WorkingDirectory (Split-Path $player -Parent) -PassThru
  if(-not $NoScreenshots){
   . (Join-Path $root 'DualPlayer\Screen-Automation.ps1')
   Start-DualScreenAutomation -Player $p -DurationSeconds $AutoSeconds -OutputFolder $out
   $screenReport=Join-Path $out 'screen-automation.json'
   if(Test-Path -LiteralPath $screenReport){
    $screen=Get-Content -LiteralPath $screenReport -Raw -Encoding UTF8|ConvertFrom-Json
    $summary.screenCapture=$screen.status
    $summary.screenCaptureCount=@($screen.screenshots|Where-Object result -eq 'CAPTURED').Count
   }
  }
  if(-not $p.WaitForExit(($AutoSeconds+90)*1000)){Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue;throw 'Player timeout'}
  Need (Test-Path -LiteralPath $runtimeJson) 'Player did not write evidence'
  $e=Get-Content -LiteralPath $runtimeJson -Raw -Encoding UTF8 | ConvertFrom-Json
  Need ($e.harness -eq '58.6.0-dual-experimental' -and $e.status -eq 'PASS_AUTO') "Dual runtime failed: $($e.error)"
  Need ($e.cefReady -and $e.cefRawImageBound -and $e.cefAcceleratedFrames -gt 0) 'CEF Texture not proven'
  Need ($e.overlayReady -and $e.overlayMessageCount -gt 0) 'WebView2 messaging not proven'
  Need ($e.cefShutdown -and $e.overlayJoined -and $p.ExitCode -eq 0) 'Dual shutdown failed'
  Need ($e.overlayUnicodeRoundtripCount -gt 0) 'Unicode JS-to-native-to-C# automation failed'
  $summary.status='PENDING_MANUAL';$summary.autoChecks='PASS';$summary.stage='COMPLETE_AUTO';$code=0
 }
} catch {
 $summary.problems+= $_.Exception.Message
 Write-Host "[DUAL] FAIL: $($_.Exception.Message)" -ForegroundColor Red
} finally {
 New-Item -ItemType Directory -Force -Path $out | Out-Null
 $summary | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $out 'summary.json') -Encoding UTF8
 if(-not $TestMissingRuntime){
 $snippets=Join-Path $out 'diagnostics-redacted.log'
 $clips=@()
 foreach($name in @('unity-editor-build.log','unity-player.log')){
  $log=Join-Path $out $name
  if(Test-Path -LiteralPath $log -PathType Leaf){
   $clips+= '['+$name+']'
   $clips+=@(Get-Content -LiteralPath $log -Encoding UTF8 |
     Where-Object{$_ -match '(?i)\[UNIFIED-DUAL\]|\[DUAL\]|\berror\b|Exception|FAILED|WebView2|CEF|CS[0-9]{4}|shutdown|joined'} |
     Select-Object -Last 220 | ForEach-Object{
       $_ -replace '(?i)[A-Z]:\\Users\\[^\\ ]+','<USER_HOME>' -replace '(?i)(Authorization|Cookie|Set-Cookie):\s*[^\r\n]+','$1: <REDACTED>' -replace '(?i)https?://\S+','<URL>'
     })
  }
 }
 $clips|Set-Content -LiteralPath $snippets -Encoding UTF8
 }
 # Never let a failed preflight be masked by PowerShell scalar unrolling:
 # @(... pipeline ...) is an array for zero, one and many result files.
 $safe=@(@('summary.json','diagnostics-redacted.log','player-runtime-evidence.json','screen-automation.json') |
   ForEach-Object{Join-Path $out $_} | Where-Object{Test-Path -LiteralPath $_ -PathType Leaf})
 $shotDir=Join-Path $out 'screenshots'
 if(Test-Path -LiteralPath $shotDir){$safe+=@(Get-ChildItem -LiteralPath $shotDir -File -Filter '*.png'|Select-Object -ExpandProperty FullName)}
 if(@($safe).Count -gt 0){$zip="$out.zip";Compress-Archive -LiteralPath $safe -DestinationPath $zip -Force;Write-Host "[DUAL] Upload ONLY: $zip"}
}
exit $code
