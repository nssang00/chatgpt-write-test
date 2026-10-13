#requires -Version 5.1
param(
 [string]$BundleRoot=$PSScriptRoot,
 [ValidateRange(60,300)][int]$AutoSeconds=180,
 [string]$UnityExe='',
 [switch]$SelfTest
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=[IO.Path]::GetFullPath((Join-Path $BundleRoot '.'))
$run=Join-Path $root 'Run-All.ps1'
$guide=Join-Path $root 'STAGE2_MANUAL_GUIDE_KO.md'
$telemetry=Join-Path $root 'UnityProject\Assets\Scripts\WebView2OneClickTelemetry.cs'
function Require([bool]$condition,[string]$message){if(-not $condition){throw $message}}
try {
 Require (Test-Path -LiteralPath $run -PathType Leaf) 'Missing Run-All.ps1'
 Require (Test-Path -LiteralPath $guide -PathType Leaf) 'Missing Korean review guide'
 Require (Test-Path -LiteralPath $telemetry -PathType Leaf) 'Missing Unity telemetry'
 $src=Get-Content -LiteralPath $telemetry -Raw -Encoding UTF8
 Require ($src.Contains('public string testRevision="r5";')) 'Expected verified r5 runtime'
 if($SelfTest){Write-Host 'Stage2 manual-review launcher source self-test PASS';exit 0}
 Require ($env:OS -eq 'Windows_NT') 'Windows required'
 Require ([IntPtr]::Size -eq 8) '64-bit Windows PowerShell required'
 Write-Host 'Korean Stage2 review. The Unity Player stays open for the configured duration.'
 Write-Host 'Read STAGE2_MANUAL_GUIDE_KO.md before testing. Do not close the Player early.'
 Write-Host "Test duration: $AutoSeconds seconds."
 Write-Host 'No screenshots or typed Hangul texts are automatically collected.'
 Start-Process -FilePath 'notepad.exe' -ArgumentList ('"'+$guide+'"') | Out-Null
 $confirmation=Read-Host 'Type START after reading the guide'
 Require ($confirmation -eq 'START') 'Review start canceled'
 $results=Join-Path $root 'results'
 New-Item -ItemType Directory -Force -Path $results | Out-Null
 $before=@(Get-ChildItem -LiteralPath $results -Directory |
  Where-Object {$_.Name -like 'webview2-v58.5.2-*'} | ForEach-Object {$_.FullName})
 $arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File',$run,
  '-BundleRoot',$root,'-AutoSeconds',[string]$AutoSeconds)
 if($UnityExe){$arguments+=@('-UnityExe',$UnityExe)}
 Write-Host 'Building and launching visible Unity Windows Player...'
 & powershell.exe @arguments
 $autoCode=$LASTEXITCODE
 $fresh=@(Get-ChildItem -LiteralPath $results -Directory |
  Where-Object {$_.Name -like 'webview2-v58.5.2-*' -and $before -notcontains $_.FullName} |
  Sort-Object LastWriteTime -Descending)
 Require ($fresh.Count -gt 0) 'No new automatic results directory'
 $sourceDir=$fresh[0].FullName
 $summaryPath=Join-Path $sourceDir 'summary.json'
 $evidencePath=Join-Path $sourceDir 'player-runtime-evidence.json'
 Require (Test-Path -LiteralPath $summaryPath) 'Missing automatic summary'
 Require (Test-Path -LiteralPath $evidencePath) 'Missing automatic player evidence'
 $summary=Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 | ConvertFrom-Json
 $evidence=Get-Content -LiteralPath $evidencePath -Raw -Encoding UTF8 | ConvertFrom-Json
 $ok=($autoCode -eq 0 -and $summary.autoChecks -eq 'PASS' -and
  $summary.status -eq 'PENDING_MANUAL' -and $evidence.testRevision -eq 'r5' -and
  $evidence.status -eq 'PASS_AUTO' -and $evidence.fixtureUnicodeEchoAckCount -gt 0 -and
  $evidence.echoRejectedCount -eq 0 -and $evidence.shutdownJoined -eq $true -and
  $evidence.shutdownResult -eq 0 -and $evidence.shutdownPhase -eq 7)
 if(-not $ok){
  Write-Host '[FAIL] Automatic validation is not PASS; manual approval prohibited.' -ForegroundColor Red
  Write-Host "Upload automatic results: $sourceDir.zip"
  exit 2
 }
 Write-Host '[AUTO PASS] Record what you personally observed.'
 Write-Host 'P=PASS, F=FAIL, N=NOT_TESTED. Answer N if uncertain.'
 $items=@(
  @{id='R01';title='WebView2 visible, no blank/black surface'},
  @{id='R02';title='NEW Korean IME text typed, Native Echo exact match shown'},
  @{id='R03';title='Korean composition/candidate popup alignment correct'},
  @{id='R04';title='Mouse/keyboard Tab and Alt+Tab focus correct'},
  @{id='R05';title='Moving/resizing Unity window preserves alignment'},
  @{id='R06';title='Mixed-DPI monitor move/scaling/click alignment correct'},
  @{id='R07';title='HWND overlay z-order limitations understood'},
  @{id='R08';title='Repeated two Player launches/exits cleanly'},
  @{id='R09';title='Ping and Echo still work after resizing'}
 )
 $records=@()
 foreach($item in $items){
  do {
   $answer=(Read-Host ("{0}: {1} [P/F/N]" -f $item.id,$item.title)).Trim().ToUpperInvariant()
  } while($answer -notin @('P','F','N'))
  $status=switch($answer){'P'{'PASS'} 'F'{'FAIL'} default{'NOT_TESTED'}}
  $records+= [ordered]@{id=$item.id;description=$item.title;status=$status}
 }
 $failCount=@($records|Where-Object {$_.status -eq 'FAIL'}).Count
 $pendingCount=@($records|Where-Object {$_.status -eq 'NOT_TESTED'}).Count
 $reported=if($failCount -gt 0){'MANUAL_REPORTED_FAIL'}
  elseif($pendingCount -gt 0){'MANUAL_PARTIAL'}
  else{'MANUAL_REPORTED_PASS_PENDING_EVIDENCE_REVIEW'}
 $comments=Read-Host 'Short non-sensitive reviewer notes (optional)'
 $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
 $reviewDir=Join-Path $results ('stage2-review-'+$stamp)
 New-Item -ItemType Directory -Force -Path $reviewDir | Out-Null
 $report=[ordered]@{
  schemaVersion=1;target='WebView2 Overlay v58.5.2 r5'
  automaticGate='PASS';manualReportedStatus=$reported
  formalStage2Status='PENDING_INDEPENDENT_REVIEW'
  fixtureEchoAckCount=$evidence.fixtureUnicodeEchoAckCount
  manualEchoAckCount=$evidence.manualEchoAckCount
  shutdownJoined=$evidence.shutdownJoined;shutdownPhase=$evidence.shutdownPhase
  screenshotEvidenceAttached=$false
  reviewUtc=(Get-Date).ToUniversalTime().ToString('o')
  sourceResults=([IO.Path]::GetFileName($sourceDir)+'.zip')
  reviewerNotes=$comments;checks=$records
  privacy='No typed input strings, screenshots, browser cookies or profile collected'
 }
 $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $reviewDir 'manual-review.json') -Encoding UTF8
 foreach($name in @('summary.json','player-runtime-evidence.json','unity-player.log','unity-editor-build.log')){
  $path=Join-Path $sourceDir $name
  if(Test-Path -LiteralPath $path -PathType Leaf){Copy-Item -LiteralPath $path -Destination $reviewDir}
 }
 $zip=Join-Path $results ('stage2-review-'+$stamp+'.zip')
 Compress-Archive -Path (Join-Path $reviewDir '*') -DestinationPath $zip -Force -CompressionLevel Optimal
 Write-Host "Manual recorded state: $reported"
 Write-Host 'Formal Stage2 verdict remains PENDING_INDEPENDENT_REVIEW.'
 Write-Host "Upload ZIP: $zip"
 Write-Host 'Upload 2-4 REDACTED screenshots separately; logs may contain local paths.'
 exit 0
}catch {
 Write-Host "[REVIEW FAILURE] $($_.Exception.Message)" -ForegroundColor Red
 exit 3
}
