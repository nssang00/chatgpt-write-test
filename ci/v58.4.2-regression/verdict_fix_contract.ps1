$ErrorActionPreference='Stop'
# Exact rule for close-isolation: closed view may be textureless; open views may not.
$views=@(
 [pscustomobject]@{closed=$false;textureCreated=$true;softwareFrames=0},
 [pscustomobject]@{closed=$true;textureCreated=$false;softwareFrames=0}
)
$bad=@($views|Where-Object{[int64]$_.softwareFrames -ne 0 -or (-not [bool]$_.closed -and -not [bool]$_.textureCreated)})
if($bad.Count -ne 0){throw 'close-isolation valid state rejected'}
$views[0].textureCreated=$false
$bad=@($views|Where-Object{[int64]$_.softwareFrames -ne 0 -or (-not [bool]$_.closed -and -not [bool]$_.textureCreated)})
if($bad.Count -ne 1){throw 'open texture regression not caught'}
# Child output isolation pattern: pipeline to Write-Host must produce no success-stream payload.
function ChildLike { 'REGRESSION CASE: FAIL'; $false }
function Wrapped { ChildLike | ForEach-Object { Write-Host $_ }; return $false }
$x=Wrapped
if($x -is [array]){throw 'wrapped regression verdict leaked child output into caller result'}
if([bool]$x){throw 'wrapped failure became truthy'}
Write-Host 'REGRESSION_VERDICT_FIX=PASS'
