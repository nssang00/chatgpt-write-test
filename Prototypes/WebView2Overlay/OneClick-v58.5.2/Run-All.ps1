param(
 [string]$BundleRoot=$PSScriptRoot,
 [string]$UnityExe='',
 [ValidateRange(10,300)][int]$AutoSeconds=35,
 [switch]$SelfTest
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=[IO.Path]::GetFullPath((Join-Path $BundleRoot '.'))
$project=Join-Path $root 'UnityProject'
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$out=Join-Path $root ('results\webview2-v58.5.2-'+$stamp)
New-Item -ItemType Directory -Force -Path $out | Out-Null
$summary=[ordered]@{
 harnessVersion='58.5.2'; status='FAIL'; autoChecks='NOT_RUN'; manualChecks='PENDING'
 stage='PREFLIGHT'; editor=''; runtime=$null; problems=@(); notes=@('Visual/IME/DPI/focus checks require Windows manual verification.')
 startedUtc=(Get-Date).ToUniversalTime().ToString('o')
}
function Assert([bool]$ok,[string]$msg){if(-not $ok){throw $msg}}
function ValidatePackage {
 $path=Join-Path $root 'SHA256SUMS.txt'
 Assert (Test-Path -LiteralPath $path) 'Missing SHA256SUMS.txt: download complete compiled GitHub artifact'
 $checked=0
 foreach($line in (Get-Content -LiteralPath $path -Encoding UTF8)){
  if(-not $line){continue}
  if(-not ($line -match '^([a-fA-F0-9]{64})  (.+)
  $sha=$Matches[1].ToLowerInvariant()
  $rel=$Matches[2].Replace('/',[IO.Path]::DirectorySeparatorChar)
  Assert (-not [IO.Path]::IsPathRooted($rel) -and $rel -notmatch '(^|[\\/])\.\.([\\/]|$)') "Unsafe hash path: $rel"
  $file=Join-Path $root $rel
  Assert (Test-Path -LiteralPath $file -PathType Leaf) "Missing file: $rel"
  Assert ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -eq $sha) "HASH_MISMATCH: $rel"
  $checked++
 }
 Assert ($checked -ge 8) "Incomplete manifest: $checked"
 Assert (Test-Path -LiteralPath (Join-Path $project 'Assets\Plugins\x86_64\CompanyWebView2OverlayPilot.dll')) 'Missing compiled x64 DLL'
 return $checked
}
function FindUnity {
 if($UnityExe){Assert (Test-Path -LiteralPath $UnityExe) "Missing -UnityExe: $UnityExe";return (Resolve-Path -LiteralPath $UnityExe).Path}
 if($env:UNITY_EDITOR_PATH -and (Test-Path -LiteralPath $env:UNITY_EDITOR_PATH)){return (Resolve-Path -LiteralPath $env:UNITY_EDITOR_PATH).Path}
 foreach($p in @(
  (Join-Path $env:ProgramFiles 'Unity\Hub\Editor\2022.3.62f3\Editor\Unity.exe'),
  'C:\Program Files\Unity\Hub\Editor\2022.3.62f3\Editor\Unity.exe'
  )){
  if(Test-Path -LiteralPath $p){return $p}
 }
 throw 'Unity 2022.3.62f3 Editor missing. Install using Unity Hub or use Run-All.cmd -UnityExe "C:\path\Unity.exe"'
}
$exit=2
try{
 Assert ($env:OS -eq 'Windows_NT') 'Windows x64 required'
 Assert ([IntPtr]::Size -eq 8) 'PowerShell x64 required'
 $count=ValidatePackage
 Write-Host "[PASS] Package SHA-256 checked: $count files"
 if($SelfTest){
  $summary.status='SELFTEST_PASS';$summary.notes+= 'Only file preflight checked; no Unity Player execution.'
  $exit=0
 }else{
  $unity=FindUnity
  $summary.editor=$unity
  $summary.stage='UNITY_BUILD'
  $player=Join-Path $out 'Player\WebView2Pilot.exe'
  New-Item -ItemType Directory -Force (Split-Path $player -Parent) | Out-Null
  $buildLog=Join-Path $out 'unity-editor-build.log'
  $args=('-batchmode -nographics -quit -buildTarget Win64 -projectPath "{0}" -executeMethod WebView2OneClickBuilder.Build -pilotBuildPath "{1}" -logFile "{2}"' -f $project,$player,$buildLog)
  Write-Host "Building scratch Unity Windows x64 Player..."
  $proc=Start-Process -FilePath $unity -ArgumentList $args -PassThru
  if(-not $proc.WaitForExit(900000)){
   Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
   throw 'Unity Editor build timeout (15min)'
  }
  Assert ($proc.ExitCode -eq 0) "Unity build failed (exit $($proc.ExitCode)); inspect unity-editor-build.log"
  Assert (Test-Path -LiteralPath $player) 'Unity Player executable absent'
  $summary.stage='PLAYER_RUNTIME'
  $evidence=Join-Path $out 'player-runtime-evidence.json'
  $playLog=Join-Path $out 'unity-player.log'
  $args=('-screen-fullscreen 0 -screen-width 1024 -screen-height 720 -pilotAutoSeconds {0} -pilotReportPath "{1}" -logFile "{2}"' -f $AutoSeconds,$evidence,$playLog)
  Write-Host "Running visible Windows Unity Player for $AutoSeconds seconds..."
  $proc=Start-Process -FilePath $player -ArgumentList $args -WorkingDirectory (Split-Path $player -Parent) -PassThru
  if(-not $proc.WaitForExit(($AutoSeconds+65)*1000)){
   Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
   throw 'Unity Player timeout; possible hang'
  }
  Assert (Test-Path -LiteralPath $evidence) 'Player evidence absent; inspect unity-player.log'
  $data=Get-Content -LiteralPath $evidence -Raw -Encoding UTF8 | ConvertFrom-Json
  $summary.runtime=$data
  Assert ($data.harnessVersion -eq '58.5.2') 'Wrong runtime harness version'
  Assert ($data.status -eq 'PASS_AUTO') "Runtime failed: $($data.error), status $($data.status)"
  Assert ($proc.ExitCode -eq 0) "Unity Player exited $($proc.ExitCode)"
  $summary.status='PENDING_MANUAL';$summary.autoChecks='PASS';$summary.stage='COMPLETE_AUTO'
  $exit=0
 }
}catch{
 $summary.problems+= $_.Exception.Message
 Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
}finally{
 $summary.completedUtc=(Get-Date).ToUniversalTime().ToString('o')
 $sum=Join-Path $out 'summary.json'
 $summary | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $sum -Encoding UTF8
 $zip="$out.zip"
 try {
  Compress-Archive -Path (Join-Path $out '*') -DestinationPath $zip -Force -CompressionLevel Optimal
  Write-Host "Upload result ZIP: $zip"
 }catch{Write-Warning "Results ZIP failed: $_"}
 Write-Host "Final: $($summary.status). Manual IME/DPI/focus checks remain even if automatic checks PASS."
}
exit $exit
)){throw "Malformed SHA256SUMS: $line"}
  $sha=$Matches[1].ToLowerInvariant()
  $rel=$Matches[2].Replace('/',[IO.Path]::DirectorySeparatorChar)
  Assert (-not [IO.Path]::IsPathRooted($rel) -and $rel -notmatch '(^|[\\/])\.\.([\\/]|$)') "Unsafe hash path: $rel"
  $file=Join-Path $root $rel
  Assert (Test-Path -LiteralPath $file -PathType Leaf) "Missing file: $rel"
  Assert ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -eq $sha) "HASH_MISMATCH: $rel"
  $checked++
 }
 Assert ($checked -ge 8) "Incomplete manifest: $checked"
 Assert (Test-Path -LiteralPath (Join-Path $project 'Assets\Plugins\x86_64\CompanyWebView2OverlayPilot.dll')) 'Missing compiled x64 DLL'
 return $checked
}
function FindUnity {
 if($UnityExe){Assert (Test-Path -LiteralPath $UnityExe) "Missing -UnityExe: $UnityExe";return (Resolve-Path -LiteralPath $UnityExe).Path}
 if($env:UNITY_EDITOR_PATH -and (Test-Path -LiteralPath $env:UNITY_EDITOR_PATH)){return (Resolve-Path -LiteralPath $env:UNITY_EDITOR_PATH).Path}
 foreach($p in @(
  (Join-Path $env:ProgramFiles 'Unity\Hub\Editor\2022.3.62f3\Editor\Unity.exe'),
  'C:\Program Files\Unity\Hub\Editor\2022.3.62f3\Editor\Unity.exe'
  )){
  if(Test-Path -LiteralPath $p){return $p}
 }
 throw 'Unity 2022.3.62f3 Editor missing. Install using Unity Hub or use Run-All.cmd -UnityExe "C:\path\Unity.exe"'
}
$exit=2
try{
 Assert ($env:OS -eq 'Windows_NT') 'Windows x64 required'
 Assert ([IntPtr]::Size -eq 8) 'PowerShell x64 required'
 $count=ValidatePackage
 Write-Host "[PASS] Package SHA-256 checked: $count files"
 if($SelfTest){
  $summary.status='SELFTEST_PASS';$summary.notes+= 'Only file preflight checked; no Unity Player execution.'
  $exit=0
 }else{
  $unity=FindUnity
  $summary.editor=$unity
  $summary.stage='UNITY_BUILD'
  $player=Join-Path $out 'Player\WebView2Pilot.exe'
  New-Item -ItemType Directory -Force (Split-Path $player -Parent) | Out-Null
  $buildLog=Join-Path $out 'unity-editor-build.log'
  $args=('-batchmode -nographics -quit -buildTarget Win64 -projectPath "{0}" -executeMethod WebView2OneClickBuilder.Build -pilotBuildPath "{1}" -logFile "{2}"' -f $project,$player,$buildLog)
  Write-Host "Building scratch Unity Windows x64 Player..."
  $proc=Start-Process -FilePath $unity -ArgumentList $args -PassThru
  if(-not $proc.WaitForExit(900000)){
   Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
   throw 'Unity Editor build timeout (15min)'
  }
  Assert ($proc.ExitCode -eq 0) "Unity build failed (exit $($proc.ExitCode)); inspect unity-editor-build.log"
  Assert (Test-Path -LiteralPath $player) 'Unity Player executable absent'
  $summary.stage='PLAYER_RUNTIME'
  $evidence=Join-Path $out 'player-runtime-evidence.json'
  $playLog=Join-Path $out 'unity-player.log'
  $args=('-screen-fullscreen 0 -screen-width 1024 -screen-height 720 -pilotAutoSeconds {0} -pilotReportPath "{1}" -logFile "{2}"' -f $AutoSeconds,$evidence,$playLog)
  Write-Host "Running visible Windows Unity Player for $AutoSeconds seconds..."
  $proc=Start-Process -FilePath $player -ArgumentList $args -WorkingDirectory (Split-Path $player -Parent) -PassThru
  if(-not $proc.WaitForExit(($AutoSeconds+65)*1000)){
   Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
   throw 'Unity Player timeout; possible hang'
  }
  Assert (Test-Path -LiteralPath $evidence) 'Player evidence absent; inspect unity-player.log'
  $data=Get-Content -LiteralPath $evidence -Raw -Encoding UTF8 | ConvertFrom-Json
  $summary.runtime=$data
  Assert ($data.harnessVersion -eq '58.5.2') 'Wrong runtime harness version'
  Assert ($data.status -eq 'PASS_AUTO') "Runtime failed: $($data.error), status $($data.status)"
  Assert ($proc.ExitCode -eq 0) "Unity Player exited $($proc.ExitCode)"
  $summary.status='PENDING_MANUAL';$summary.autoChecks='PASS';$summary.stage='COMPLETE_AUTO'
  $exit=0
 }
}catch{
 $summary.problems+= $_.Exception.Message
 Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
}finally{
 $summary.completedUtc=(Get-Date).ToUniversalTime().ToString('o')
 $sum=Join-Path $out 'summary.json'
 $summary | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $sum -Encoding UTF8
 $zip="$out.zip"
 try {
  Compress-Archive -Path (Join-Path $out '*') -DestinationPath $zip -Force -CompressionLevel Optimal
  Write-Host "Upload result ZIP: $zip"
 }catch{Write-Warning "Results ZIP failed: $_"}
 Write-Host "Final: $($summary.status). Manual IME/DPI/focus checks remain even if automatic checks PASS."
}
exit $exit
