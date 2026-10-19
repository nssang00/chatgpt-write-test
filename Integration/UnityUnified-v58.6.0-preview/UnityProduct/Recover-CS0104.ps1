#requires -Version 5.1
<# Auto-recover the exact known Unity 2022 CS0104 PackageInfo and CS0019 RectInt build failures.
   Returns 0 if recovered, 20 if no eligible previous failure (normal install),
   1 if an attempted recovery fails. Never redownloads CEF or recreates a project. #>
[CmdletBinding()]
param(
 [string]$UnityExe,
 [string]$CefStage,
 [switch]$LaunchPlayer
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$scriptDir=$PSScriptRoot
if([string]::IsNullOrWhiteSpace($scriptDir)) {
 $scriptDir=Split-Path -Path $MyInvocation.MyCommand.Path -Parent
}
if([string]::IsNullOrWhiteSpace($scriptDir)){Write-Host '[UPM RECOVER] Cannot locate kit directory'; exit 1}

$cacheRoot=if([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)){$null}else{Join-Path $env:LOCALAPPDATA 'CWV58\upm-product'}
$oldLine='var info = PackageInfo.FindForAssembly(typeof(UnifiedWebViewPanel).Assembly);'
$fixedLine='var info = UnityEditor.PackageManager.PackageInfo.FindForAssembly(typeof(UnifiedWebViewPanel).Assembly);'
$oldRect='if (bounds != lastBounds)'
$fixedRect='if (bounds.x != lastBounds.x || bounds.y != lastBounds.y || bounds.width != lastBounds.width || bounds.height != lastBounds.height)'
if([string]::IsNullOrWhiteSpace($cacheRoot) -or -not (Test-Path -LiteralPath $cacheRoot -PathType Container)){
 Write-Host '[UPM RECOVER] No prior Unity product cache. Normal one-click build will start.'
 exit 20
}
$eligible=@()
foreach($entry in @(Get-ChildItem -LiteralPath $cacheRoot -Directory -ErrorAction Stop)){
 if($entry.Name -cnotmatch '^[a-f0-9]{24}$'){continue}
 $project=Join-Path $entry.FullName 'UnityProject'
 $source=Join-Path $project 'Packages\com.company.webview\Editor\UnifiedWebViewBuildCopy.cs'
 $builder=Join-Path $project 'Packages\com.company.webview\Editor\UnifiedWebViewAutoBuild.cs'
 $panel=Join-Path $project 'Packages\com.company.webview\Runtime\UnifiedExperimental\UnifiedWebViewPanel.cs'
 $log=Join-Path $entry.FullName 'UnityEditorAutoBuild.log'
 $marker=Join-Path $entry.FullName 'BuildComplete.key'
 if((Test-Path -LiteralPath $marker -PathType Leaf) -or
    -not (Test-Path -LiteralPath $source -PathType Leaf) -or
    -not (Test-Path -LiteralPath $builder -PathType Leaf) -or
    -not (Test-Path -LiteralPath $panel -PathType Leaf) -or
    -not (Test-Path -LiteralPath $log -PathType Leaf)) {continue}
 $current=[IO.File]::ReadAllText($source,[Text.Encoding]::UTF8)
 $currentPanel=[IO.File]::ReadAllText($panel,[Text.Encoding]::UTF8)
 # Recover only a known compiler failure, never an arbitrary user project or unrelated Unity exception.
 $needsApi=($current.IndexOf($oldLine,[StringComparison]::Ordinal) -ge 0) -and
   (Select-String -LiteralPath $log -Pattern 'CS0104.*PackageInfo' -Quiet)
 $needsRect=($currentPanel.IndexOf($oldRect,[StringComparison]::Ordinal) -ge 0) -and
   (Select-String -LiteralPath $log -Pattern 'CS0019.*RectInt' -Quiet)
 if(-not $needsApi -and -not $needsRect){continue}
 $eligible+= [pscustomobject]@{Work=$entry.FullName; Project=$project; Source=$source; Panel=$panel; Log=$log;
   NeedsApi=$needsApi;NeedsRect=$needsRect;LastFailure=(Get-Item -LiteralPath $log).LastWriteTimeUtc;Key=$entry.Name}
}
if($eligible.Count -eq 0){
 Write-Host '[UPM RECOVER] Known CS0104/CS0019 failure not found. Normal one-click build will start.'
 exit 20
}
# Most recently failed *only*; no ambiguous edits across multiple generated projects.
$candidate=@($eligible | Sort-Object -Property LastFailure -Descending)[0]
$reportDir=Join-Path $scriptDir 'AutoResults'
New-Item -ItemType Directory -Force -Path $reportDir|Out-Null
$report=Join-Path $reportDir 'product-auto-summary.json'
$errorPath=Join-Path $reportDir 'compile-errors-redacted.txt'
$player=Join-Path $candidate.Work 'Player\CompanyWebViewPreview.exe'
$summary=[ordered]@{
 status='FAILED';stage='PATCH_EXISTING_COMPILER_ERRORS';cache='RECOVERING';cacheKey=$candidate.Key;
 package=(Join-Path $candidate.Project 'Packages\com.company.webview');project=$candidate.Project;
 player=$player;unityLog=$candidate.Log;reusedExistingProject=$true;
 redownloadCEF=$false;unityProjectRecreated=$false;fixedCS0104=$false;fixedCS0019=$false;error=''
}
$lock=$null
try {
 $lockPath=Join-Path $candidate.Work 'build.lock'
 try {$lock=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}
 catch {throw 'Generated Unity cache is already in use. Close that Unity Editor and retry.'}
 if($candidate.NeedsApi){
  $contents=[IO.File]::ReadAllText($candidate.Source,[Text.Encoding]::UTF8)
  if(([regex]::Matches($contents,[regex]::Escape($oldLine))).Count -ne 1){
   throw 'Unexpected PackageInfo source. Refusing an unsafe automatic patch.'
  }
  $backup=$candidate.Source+'.before-cs0104-fix.bak'
  if(-not (Test-Path -LiteralPath $backup -PathType Leaf)){
   Copy-Item -LiteralPath $candidate.Source -Destination $backup -Force
  }
  [IO.File]::WriteAllText($candidate.Source,$contents.Replace($oldLine,$fixedLine),([Text.UTF8Encoding]::new($false)))
  $summary.fixedCS0104=$true
  Write-Host '[UPM RECOVER] Fixed Unity 2022 CS0104 PackageInfo ambiguity'
 }
 if($candidate.NeedsRect){
  $contents=[IO.File]::ReadAllText($candidate.Panel,[Text.Encoding]::UTF8)
  if(([regex]::Matches($contents,[regex]::Escape($oldRect))).Count -ne 1){
   throw 'Unexpected RectInt source. Refusing an unsafe automatic patch.'
  }
  $backup=$candidate.Panel+'.before-cs0019-fix.bak'
  if(-not (Test-Path -LiteralPath $backup -PathType Leaf)){
   Copy-Item -LiteralPath $candidate.Panel -Destination $backup -Force
  }
  [IO.File]::WriteAllText($candidate.Panel,$contents.Replace($oldRect,$fixedRect),([Text.UTF8Encoding]::new($false)))
  $summary.fixedCS0019=$true
  Write-Host '[UPM RECOVER] Fixed Unity 2022 CS0019 RectInt comparison'
 }
 Write-Host ('[UPM RECOVER] Reusing existing Unity project: '+$candidate.Project)
 $summary.stage='RETRY_UNITY_BATCH_BUILD'
 if([string]::IsNullOrWhiteSpace($UnityExe)){
  if(-not [string]::IsNullOrWhiteSpace($env:UNITY_EDITOR_PATH) -and (Test-Path -LiteralPath $env:UNITY_EDITOR_PATH -PathType Leaf)) {
   $UnityExe=$env:UNITY_EDITOR_PATH
  } else {$UnityExe='C:\Program Files\Unity\Hub\Editor\2022.3.62f3\Editor\Unity.exe'}
 }
 if(-not (Test-Path -LiteralPath $UnityExe -PathType Leaf)) {throw "Unity Editor not found at '$UnityExe'"}
 $args=('-batchmode -nographics -quit -buildTarget Win64 -projectPath "{0}" -executeMethod Company.WebView.Unified.Editor.UnifiedWebViewAutoBuild.Build -productBuildPath "{1}" -logFile "{2}"' -f $candidate.Project,$player,$candidate.Log)
 Write-Host '[UPM RECOVER] Rebuilding with existing Unity Library cache; no CEF download or full test.'
 $p=Start-Process -FilePath $UnityExe -ArgumentList $args -PassThru
 if(-not $p.WaitForExit(1200000)){
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  throw 'Unity product build timed out; inspect UnityEditorAutoBuild.log'
 }
 if($p.ExitCode -ne 0){throw "Unity batch build returned $($p.ExitCode); see diagnostics and Unity Editor log"}
 $pluginDir=Join-Path $candidate.Work 'Player\CompanyWebViewPreview_Data\Plugins\x86_64'
 $required=@($player,
  (Join-Path $pluginDir 'libcef.dll'),
  (Join-Path $pluginDir 'CompanyWebViewCefTextureProbe.dll'),
  (Join-Path $pluginDir 'CompanyWebView2UnifiedPreview.dll'),
  (Join-Path $candidate.Project 'Assets\CompanyWebViewGenerated\DualPreview.unity'),
  (Join-Path $candidate.Project 'Assets\CompanyWebViewGenerated\Prefabs\CefTexturePanel.prefab'),
  (Join-Path $candidate.Project 'Assets\CompanyWebViewGenerated\Prefabs\WebView2OverlayPanel.prefab'))
 foreach($file in $required){if(-not(Test-Path -LiteralPath $file -PathType Leaf)){throw "Incomplete Unity product build: $file"}}
 # Existing cache identity: this project was not reconstructed or relocated.
 [IO.File]::WriteAllText((Join-Path $candidate.Work 'BuildComplete.key'),$candidate.Key,([Text.UTF8Encoding]::new($false)))
 $summary.stage='COMPLETE';$summary.status='AUTO_BUILD_PASS';$summary.cache='REUSED_FAILED_PROJECT'
 Write-Host ('[UPM RECOVER] PRODUCT READY: '+$player)
 if($LaunchPlayer){Start-Process -FilePath $player|Out-Null;Write-Host '[UPM RECOVER] Player launched.'}
} catch {
 $summary.status='FAILED';$summary.error=$_.Exception.Message
 Write-Host ('[UPM RECOVER] FAILED: '+$summary.error)
 if(Test-Path -LiteralPath $candidate.Log -PathType Leaf){
  $lines=@(Get-Content -LiteralPath $candidate.Log -Encoding UTF8|Where-Object {
    $_ -match '(error CS[0-9]+|BuildFailedException|ScriptCompilation.*fail|Exception:|Error building Player|BuildPipeline.*fail)'
  }|Select-Object -Unique -First 35)
  $redacted=@()
  foreach($line in $lines){
    if(-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)){
      $redacted+=[regex]::Replace($line,[regex]::Escape($env:USERPROFILE),'<USERPROFILE>',[Text.RegularExpressions.RegexOptions]::IgnoreCase)
    }else{$redacted+=$line}
  }
  $redacted|Set-Content -LiteralPath $errorPath -Encoding UTF8
  Write-Host ('[UPM RECOVER] Sanitized compiler diagnostics: '+$errorPath)
 }
} finally {
 if($null -ne $lock){$lock.Dispose()}
 $summary|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $report -Encoding UTF8
 Write-Host ('[UPM RECOVER] Summary: '+$report)
}
if($summary.status -eq 'AUTO_BUILD_PASS'){exit 0} else {exit 1}
