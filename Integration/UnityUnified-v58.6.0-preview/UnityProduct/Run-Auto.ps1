#requires -Version 5.1
<# One-click product integration preview. Existing pinned CEF binaries only; no network/download/build of CEF.
    Creates an isolated Unity project and Windows Player; never changes an existing user project. #>
[CmdletBinding()]
param(
 [string]$UnityExe,
 [string]$CefStage,
 [switch]$LaunchPlayer
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$kitDir=$PSScriptRoot
if([string]::IsNullOrWhiteSpace($kitDir)) { $kitDir=Split-Path -Path $MyInvocation.MyCommand.Path -Parent }
if([string]::IsNullOrWhiteSpace($kitDir)){throw 'Unable to locate the UPM automation kit'}
$results=Join-Path $kitDir 'AutoResults'
New-Item -ItemType Directory -Force -Path $results | Out-Null
$summary=[ordered]@{status='FAILED';stage='PREFLIGHT';cache='UNKNOWN';cacheKey='';package='';project='';player='';unityLog='';error=''}
$lock=$null
try {
 if([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {throw 'LOCALAPPDATA is empty; Windows user local cache is required'}
 if([string]::IsNullOrWhiteSpace($UnityExe)){
  if(-not [string]::IsNullOrWhiteSpace($env:UNITY_EDITOR_PATH) -and (Test-Path -LiteralPath $env:UNITY_EDITOR_PATH -PathType Leaf)){
   $UnityExe=$env:UNITY_EDITOR_PATH
  }else{
   $UnityExe='C:\Program Files\Unity\Hub\Editor\2022.3.62f3\Editor\Unity.exe'
  }
 }
 if(-not (Test-Path -LiteralPath $UnityExe -PathType Leaf)){
  throw "Unity 2022.3.62f3 editor not found at '$UnityExe'. Install editor + Windows Build Support or run Run-Auto.cmd -UnityExe 'C:\...\Unity.exe'."
 }
 $UnityExe=[IO.Path]::GetFullPath($UnityExe)
 $summary.stage='CHECK_PACKAGE'
 $package=Join-Path $kitDir 'Dist\com.company.webview'
 $native=Join-Path $package 'NativePayload~\x86_64'
 $validPackage=(Test-Path -LiteralPath (Join-Path $package 'package.json') -PathType Leaf) -and
               (Test-Path -LiteralPath (Join-Path $native 'libcef.dll') -PathType Leaf) -and
               (Test-Path -LiteralPath (Join-Path $package 'Editor\UnifiedWebViewAutoBuild.cs') -PathType Leaf) -and
               (Test-Path -LiteralPath (Join-Path $package 'Runtime\UnifiedExperimental\UnifiedWebViewPanel.cs') -PathType Leaf)
 if(-not $validPackage){
  if(Test-Path -LiteralPath $package){
   throw "Incomplete Dist package: $package . Move or remove this generated Dist package explicitly, then rerun."
  }
  Write-Host '[UPM AUTO] Assembling UPM package from validated local CEF cache (no download)...'
  $assembler=Join-Path $kitDir 'Build-UnityProduct.ps1'
  if(-not (Test-Path -LiteralPath $assembler -PathType Leaf)){throw 'Build-UnityProduct.ps1 is missing'}
  if([string]::IsNullOrWhiteSpace($CefStage)){
   & $assembler -OutputRoot (Join-Path $kitDir 'Dist')
  }else{
   & $assembler -CefStage $CefStage -OutputRoot (Join-Path $kitDir 'Dist')
  }
  if(-not (Test-Path -LiteralPath (Join-Path $native 'libcef.dll') -PathType Leaf)){
   throw 'UPM package assembly returned without complete pinned CEF runtime'
  }
 }
 # If user extracted this kit over an old folder, never silently reuse the broken Editor source.
 $postCopy=Join-Path $package 'Editor\UnifiedWebViewBuildCopy.cs'
 if(-not (Test-Path -LiteralPath $postCopy -PathType Leaf)){
  throw "UPM package is missing the fixed Editor postprocessor: $postCopy"
 }
 $currentCopy=[IO.File]::ReadAllText($postCopy,[Text.Encoding]::UTF8)
 $fixedApi='UnityEditor.PackageManager.PackageInfo.FindForAssembly('
 if($currentCopy.IndexOf($fixedApi,[StringComparison]::Ordinal) -lt 0){
  throw 'An old Dist package contains the CS0104 bug. Extract the new ZIP into a fresh folder.'
 }
 # An existing Dist package must not silently preserve the old Unity 2022 RectInt bug.
 $panelSource=Join-Path $package 'Runtime\UnifiedExperimental\UnifiedWebViewPanel.cs'
 if(-not (Test-Path -LiteralPath $panelSource -PathType Leaf)){
  throw "UPM package missing runtime panel source: $panelSource"
 }
 $panelContents=[IO.File]::ReadAllText($panelSource,[Text.Encoding]::UTF8)
 if($panelContents.Contains('if (bounds != lastBounds)')){
  throw 'An old Dist package contains Unity 2022 CS0019. Extract the v58.7.3 ZIP to a fresh folder.'
 }
 $summary.package=$package
 # Stable build identity; changing UPM sources, pinned archives or Unity installation invalidates the cache.
 $keyItems=New-Object 'System.Collections.Generic.List[string]'
 foreach($rel in @('CefOneClick-v58.4.4-source.zip','CompanyWebView2UnifiedPreview.dll',
  'Build-UnityProduct.ps1','Find-CefRuntime.ps1','Run-Auto.ps1',
  'Editor\UnifiedWebViewAutoBuild.cs','Editor\UnifiedWebViewSetupMenu.cs',
  'Editor\UnifiedWebViewBuildCopy.cs','Runtime\UnifiedWebViewPanel.cs',
  'ExistingRuntime\UnifiedWebView.cs','ExistingRuntime\CefTextureBackendBridge.cs',
  'ExistingRuntime\WebView2OverlayBackendBridge.cs')){
  $file=Join-Path $kitDir $rel
  if(-not (Test-Path -LiteralPath $file -PathType Leaf)){throw "Missing kit input: $rel"}
  $keyItems.Add($rel)
  $keyItems.Add((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash)
 }
 $editor=Get-Item -LiteralPath $UnityExe
 $keyItems.Add($UnityExe.ToLowerInvariant())
 $keyItems.Add(('{0}:{1}' -f $editor.Length,$editor.LastWriteTimeUtc.Ticks))
 $algo=[Security.Cryptography.SHA256]::Create()
 try{$bytes=$algo.ComputeHash([Text.Encoding]::UTF8.GetBytes(($keyItems.ToArray() -join [Environment]::NewLine)))}
 finally{$algo.Dispose()}
 $key=[BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant().Substring(0,24)
 $summary.cacheKey=$key
 $work=Join-Path $env:LOCALAPPDATA ('CWV58\upm-product\'+$key)
 New-Item -ItemType Directory -Force -Path $work | Out-Null
 $project=Join-Path $work 'UnityProject'
 $player=Join-Path $work 'Player\CompanyWebViewPreview.exe'
 $log=Join-Path $work 'UnityEditorAutoBuild.log'
 $marker=Join-Path $work 'BuildComplete.key'
 $summary.project=$project
 $summary.player=$player
 $summary.unityLog=$log
 $lockPath=Join-Path $work 'build.lock'
 try{ $lock=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
 catch{throw 'Another automation process is using the same Unity cache; close it and retry'}
 $plugins=Join-Path $work 'Player\CompanyWebViewPreview_Data\Plugins\x86_64'
 $ready=(Test-Path -LiteralPath $marker -PathType Leaf) -and
        ((Get-Content -LiteralPath $marker -Raw -Encoding UTF8).Trim() -ceq $key) -and
        (Test-Path -LiteralPath $player -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $plugins 'libcef.dll') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $plugins 'CompanyWebViewCefTextureProbe.dll') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $plugins 'CompanyWebView2UnifiedPreview.dll') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $project 'Assets\CompanyWebViewGenerated\DualPreview.unity') -PathType Leaf)
 if($ready){
  $summary.cache='HIT'
  Write-Host ('[UPM AUTO] CACHE HIT — existing product Player reused: '+$player)
 } else {
  $summary.cache='MISS'
  Write-Host '[UPM AUTO] CACHE MISS — installing embedded UPM into isolated project, then building once.'
  if(Test-Path -LiteralPath $marker){Remove-Item -LiteralPath $marker -Force}
  # Clean only generated content below our version-keyed cache; do not touch user Unity projects.
  foreach($sub in @($project,(Join-Path $work 'Player'))){
   if(Test-Path -LiteralPath $sub){Remove-Item -LiteralPath $sub -Recurse -Force}
  }
  foreach($folder in @('Assets','Packages','ProjectSettings')){
   New-Item -ItemType Directory -Force -Path (Join-Path $project $folder)|Out-Null
  }
  $embedded=Join-Path $project 'Packages\com.company.webview'
  # Embedded package avoids package-path quoting and user Package Manager interaction.
  Copy-Item -LiteralPath $package -Destination $embedded -Recurse -Force
  if(-not (Test-Path -LiteralPath (Join-Path $embedded 'Editor\UnifiedWebViewAutoBuild.cs') -PathType Leaf)){
   throw 'Embedded UPM package copy failed'
  }
  $manifest='{"dependencies":{"com.unity.ugui":"1.0.0","com.unity.modules.jsonserialize":"1.0.0"}}'
  [IO.File]::WriteAllText((Join-Path $project 'Packages\manifest.json'),$manifest,[Text.Encoding]::UTF8)
  [IO.File]::WriteAllText((Join-Path $project 'ProjectSettings\ProjectVersion.txt'),("m_EditorVersion: 2022.3.62f3"+[Environment]::NewLine),[Text.Encoding]::UTF8)
  New-Item -ItemType Directory -Force -Path (Split-Path $player -Parent)|Out-Null
  $summary.stage='UNITY_BATCH_BUILD'
  $arg=('-batchmode -nographics -quit -buildTarget Win64 -projectPath "{0}" -executeMethod Company.WebView.Unified.Editor.UnifiedWebViewAutoBuild.Build -productBuildPath "{1}" -logFile "{2}"' -f $project,$player,$log)
  Write-Host ('[UPM AUTO] Running Unity 2022.3.62f3 in batchmode. Editor log: '+$log)
  $proc=Start-Process -FilePath $UnityExe -ArgumentList $arg -PassThru
  if(-not $proc.WaitForExit(1200000)){
   Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
   throw 'Unity batch product build exceeded 20 minutes; check log'
  }
  if($proc.ExitCode -ne 0){throw "Unity batch build failed (exit code $($proc.ExitCode)); check $log"}
  foreach($must in @($player,(Join-Path $plugins 'libcef.dll'),
    (Join-Path $plugins 'CompanyWebViewCefTextureProbe.dll'),
    (Join-Path $plugins 'CompanyWebView2UnifiedPreview.dll'),
    (Join-Path $project 'Assets\CompanyWebViewGenerated\DualPreview.unity'),
    (Join-Path $project 'Assets\CompanyWebViewGenerated\Prefabs\CefTexturePanel.prefab'),
    (Join-Path $project 'Assets\CompanyWebViewGenerated\Prefabs\WebView2OverlayPanel.prefab'))){
   if(-not (Test-Path -LiteralPath $must -PathType Leaf)){throw "Unity built incomplete output: $must"}
  }
  # Atomic completion marker: cache never HITs a failed or partially copied build.
  [IO.File]::WriteAllText($marker,$key,[Text.Encoding]::UTF8)
 }
 $summary.stage='COMPLETE'
 $summary.status='AUTO_BUILD_PASS'
 Write-Host ('[UPM AUTO] PRODUCT READY: '+$player)
 Write-Host ('[UPM AUTO] Unity project with generated prefabs/scene: '+$project)
 if($LaunchPlayer){
  $summary.stage='LAUNCH_PLAYER'
  Start-Process -FilePath $player | Out-Null
  Write-Host '[UPM AUTO] Windows Player launched; close the window when done.'
 }
} catch {
 $summary.status='FAILED'
 $summary.error=$_.Exception.Message
 Write-Error ('[UPM AUTO] '+$summary.error)
} finally {
 if($null -ne $lock){$lock.Dispose()}
 if($summary.status -ne 'AUTO_BUILD_PASS' -and -not [string]::IsNullOrWhiteSpace($summary.unityLog) -and
    (Test-Path -LiteralPath $summary.unityLog -PathType Leaf)) {
  $errorPath=Join-Path $results 'compile-errors-redacted.txt'
  $lines=@(Get-Content -LiteralPath $summary.unityLog -Encoding UTF8 | Where-Object {
   $_ -match '(error CS[0-9]+|BuildFailedException|ScriptCompilation.*fail|Exception:|Error building Player|BuildPipeline.*fail)'
  } | Select-Object -Unique -First 35)
  $safe=@()
  foreach($line in $lines){
   if(-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)){
    $safe+=[regex]::Replace($line,[regex]::Escape($env:USERPROFILE),'<USERPROFILE>',[Text.RegularExpressions.RegexOptions]::IgnoreCase)
   }else{$safe+=$line}
  }
  $safe|Set-Content -LiteralPath $errorPath -Encoding UTF8
  Write-Host ('[UPM AUTO] Build errors: '+$errorPath)
 }
 $report=Join-Path $results 'product-auto-summary.json'
 $summary|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $report -Encoding UTF8
 Write-Host ('[UPM AUTO] Summary: '+$report)
 if($summary.status -ne 'AUTO_BUILD_PASS'){exit 1}
}
