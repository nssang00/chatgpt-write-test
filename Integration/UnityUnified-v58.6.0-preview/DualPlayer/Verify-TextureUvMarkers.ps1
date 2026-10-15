#requires -Version 5.1
param(
 [Parameter(Mandatory=$true)][string]$EvidenceFolder
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing
# Color-block order is a true screen-space check, not a mesh UV source contract.
# No screenshots are taken by this helper. It reads only foreground-captured
# 01_initial.png and 03_restored.png, then emits numbers, not screenshots.
$report=[ordered]@{
 schema='cube-uv-screen-v1';status='INCOMPLETE';orientation='UNVERIFIED';
 phases=@();checkedScreenshots=0
}
foreach($name in @('01_initial','03_restored')){
 $path=Join-Path (Join-Path $EvidenceFolder 'screenshots') ($name+'.png')
 $entry=[ordered]@{name=$name;result='MISSING';blueSamples=0;redSamples=0;blueMeanY=$null;redMeanY=$null}
 if(Test-Path -LiteralPath $path -PathType Leaf){
  $bitmap=$null
  try {
   $bitmap=[Drawing.Bitmap]::FromFile($path)
   [long]$blueSum=0;[long]$redSum=0
   for($y=32;$y -lt ($bitmap.Height-20);$y+=3){
    for($x=15;$x -lt [int]($bitmap.Width*0.48);$x+=3){
     $c=$bitmap.GetPixel($x,$y)
     # Exact page fixture bands: top #284dff, bottom #e53b55.
     if($c.R -ge 25 -and $c.R -le 110 -and $c.G -ge 25 -and $c.G -le 155 -and $c.B -ge 170){
      $entry.blueSamples++;$blueSum+=$y
     }elseif($c.R -ge 170 -and $c.G -ge 30 -and $c.G -le 165 -and $c.B -ge 45 -and $c.B -le 170){
      $entry.redSamples++;$redSum+=$y
     }
    }
   }
   if($entry.blueSamples -ge 100 -and $entry.redSamples -ge 100){
    $entry.blueMeanY=[Math]::Round($blueSum/$entry.blueSamples,1)
    $entry.redMeanY=[Math]::Round($redSum/$entry.redSamples,1)
    $entry.result= if($entry.blueMeanY -lt $entry.redMeanY-30){'PASS'}else{'FAIL'}
    $report.checkedScreenshots++
   }else{
    $entry.result='MARKER_NOT_FOUND'
   }
  } catch { $entry.result='SCAN_ERROR';$entry['error']=$_.Exception.Message }
  finally {if($null -ne $bitmap){$bitmap.Dispose()}}
 }
 $report.phases+= $entry
}
if($report.checkedScreenshots -eq 2){
 $failures=@($report.phases | Where-Object {$_.result -eq 'FAIL'})
 if($failures.Count -eq 0){$report.status='PASS';$report.orientation='TOP_BLUE_BOTTOM_RED'}
 else{$report.status='FAIL';$report.orientation='INVERTED'}
}
$reportPath=Join-Path $EvidenceFolder 'uv-visual-evidence.json'
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Host ("[DUAL] UV color-marker screenshot check: "+$report.status)
