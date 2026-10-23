# Windows FAT32/exFAT real volume integration. Only run on a GitHub Windows runner.
# Creates, formats and detaches ONLY a new GUID-named disposable VHD.
param(
    [Parameter(Mandatory=$true)][string]$Engine,
    [Parameter(Mandatory=$true)][ValidateSet('FAT32','exFAT')][string]$FileSystem,
    [string]$EvidenceDirectory = 'build-logs/fat-live'
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or
    [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP) -or -not $IsWindows) {
    throw 'FAT volume integration may only run on an isolated GitHub-hosted Windows runner.'
}
$enginePath = (Resolve-Path -LiteralPath $Engine).Path
if (-not $enginePath.EndsWith('.exe',[StringComparison]::OrdinalIgnoreCase)) { throw 'Expected compiled Windows engine.' }
New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
$evidenceDir = (Resolve-Path -LiteralPath $EvidenceDirectory).Path
$report = Join-Path $evidenceDir 'live-fat-evidence.json'
$id = [guid]::NewGuid().ToString('N').Substring(0,12)
$testDir = Join-Path $env:RUNNER_TEMP "rw-fat-live-$id"
New-Item -ItemType Directory -Force -Path $testDir | Out-Null
$vhd = Join-Path $testDir "rw-fat-live-$id.vhd"
$letter = $null
foreach ($candidate in @('R','S','T','U','V','W','X','Y','Z')) {
    if (-not (Test-Path -LiteralPath ($candidate + ':\'))) { $letter = $candidate; break }
}
if ($null -eq $letter) { throw 'No unused drive letter is available.' }
$devicePath = '\\.\' + $letter + ':'
$label = if ($FileSystem -eq 'FAT32') { 'RWFAT32CI' } else { 'RWEXFATCI' }
$sizeMiB = if ($FileSystem -eq 'FAT32') { 512 } else { 256 }
$diskpartCreate = Join-Path $testDir 'create.txt'
$diskpartDetach = Join-Path $testDir 'detach.txt'
@(
    "create vdisk file=" + '"' + $vhd + '"' + " maximum=$sizeMiB type=fixed"
    'select vdisk file="' + $vhd + '"'
    'attach vdisk'
    'convert gpt'
    'create partition primary'
    "format fs=$FileSystem quick label=$label"
    "assign letter=$letter"
) | Set-Content -LiteralPath $diskpartCreate -Encoding ascii
@('select vdisk file="' + $vhd + '"','detach vdisk') | Set-Content -LiteralPath $diskpartDetach -Encoding ascii
$e = [ordered]@{
    schema=1; case='windows-live-fat-deleted-file-sha256'; filesystem=$FileSystem;
    result='not-run'; device=$devicePath; image_file_input=$false;
    real_physical_media_tested=$false; windows_gui_executed=$false;
    vhd_identity_verified=$false; raw_volume_scan_completed=$false;
    deleted_candidate_found=$false; preview_sha256_matches_original=$false;
    recovered_sha256_matches_original=$false; same_source_disk_rejected=$false;
    vhd_detached=$false;
    native_exe_sha256=(Get-FileHash -LiteralPath $enginePath -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Save-Evidence { $e | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $report -Encoding utf8 }
function Invoke-DiskPart([string]$inputFile,[string]$logFile) {
    & diskpart.exe /s $inputFile *>&1 | Out-File -LiteralPath $logFile -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw "diskpart exit $LASTEXITCODE; see $logFile" }
}
function Invoke-Json([string[]]$arguments,[string]$name) {
    $stdout=Join-Path $evidenceDir "$name.stdout"
    $stderr=Join-Path $evidenceDir "$name.stderr"
    & $enginePath @arguments 1> $stdout 2> $stderr
    if ($LASTEXITCODE -ne 0) {
        $details=Get-Content -LiteralPath $stderr -Raw -Encoding utf8
        throw "$name failed ($LASTEXITCODE): $details"
    }
    $rows=@(Get-Content -LiteralPath $stdout -Encoding utf8 | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
    return $rows
}
try {
    Invoke-DiskPart $diskpartCreate (Join-Path $evidenceDir 'create-diskpart.log')
    $di=Get-DiskImage -ImagePath $vhd -ErrorAction Stop
    if (-not $di.Attached) { throw 'The disposable VHD did not attach.' }
    $vhdDisk=$di | Get-Disk -ErrorAction Stop
    $part=$null; $volume=$null
    for ($attempt=0; $attempt -lt 20; ++$attempt) {
        $part=Get-Partition -DriveLetter $letter -ErrorAction SilentlyContinue
        $volume=Get-Volume -DriveLetter $letter -ErrorAction SilentlyContinue
        if ($part -and $volume) { break }
        Start-Sleep -Seconds 1
    }
    if (-not $part -or -not $volume -or $part.DiskNumber -ne $vhdDisk.Number -or
        $volume.FileSystem -ne $FileSystem -or $volume.FileSystemLabel -ne $label) {
        throw "Refusing unexpected drive: filesystem=$($volume.FileSystem), label=$($volume.FileSystemLabel), disk=$($part.DiskNumber), VHD=$($vhdDisk.Number)"
    }
    $e.vhd_identity_verified=$true
    $e.vhd_disk_number=$vhdDisk.Number
    $name="rw_deleted_link_6a3e7f9e519481919cc6d1907ea43143_archive.bin"
    $file=($letter + ':\' + $name)
    $payload=New-Object byte[] 65536
    for($i=0;$i -lt $payload.Length;++$i) { $payload[$i]=[byte](($i*23+17)%251) }
    [IO.File]::WriteAllBytes($file,$payload)
    $handle=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)
    try { $handle.Flush($true) } finally { $handle.Dispose() }
    $expected=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    $e.original_sha256=$expected
    $e.original_size=$payload.Length
    Remove-Item -LiteralPath $file -Force -ErrorAction Stop
    if(Test-Path -LiteralPath $file) { throw 'Test fixture remains after deletion.' }
    $rows=@(Invoke-Json @('scan-fat',$devicePath,'--json') 'scan')
    $e.raw_volume_scan_completed=$true
    $e.scan_count=$rows.Count
    $found=@($rows | Where-Object { $_.kind -eq 'file' -and $_.path.EndsWith($name,[StringComparison]::OrdinalIgnoreCase) })
    if($found.Count -ne 1) {
        $e.scan_candidates=@($rows | Select-Object -First 12 id,size,status,path)
        throw "Expected one deleted entry '$name'; found $($found.Count)."
    }
    $candidate=$found[0]
    $e.candidate_id=[string]$candidate.id
    $e.candidate_status=[string]$candidate.status
    if ([int64]$candidate.size -ne $payload.Length) { throw 'Deleted file metadata size mismatch' }
    if($candidate.status -notin @('free-clusters','heuristic-contiguous')) {
        throw "Deleted candidate cannot be safely extracted: $($candidate.status)"
    }
    $e.deleted_candidate_found=$true
    $preview=@(Invoke-Json @('preview','fat',$devicePath,[string]$candidate.id,'--json') 'preview')
    if($preview.Count -ne 1 -or $preview[0].kind -ne 'preview') { throw 'Preview output invalid' }
    $first=[Math]::Min(256,$payload.Length)
    $expectedHex=[Convert]::ToHexString([byte[]]$payload[0..($first-1)]).ToLowerInvariant()
    if($preview[0].hex -ne $expectedHex -or [int]$preview[0].bytes -ne $first) {
        throw 'Live FAT preview data does not match original.'
    }
    $e.preview_sha256_matches_original=$true
    $blockedOut=Join-Path $evidenceDir 'same-disk.stdout'
    $blockedErr=Join-Path $evidenceDir 'same-disk.stderr'
    & $enginePath 'extract-fat' $devicePath ([string]$candidate.id) ($letter + ':\') '--json' 1>$blockedOut 2>$blockedErr
    $blockedExit=$LASTEXITCODE
    $blockedMessage=Get-Content -LiteralPath $blockedErr -Raw -Encoding utf8
    if($blockedExit -eq 0 -or $blockedMessage -notmatch 'same physical disk') {
        throw "Same-disk extraction guard failed: exit=$blockedExit $blockedMessage"
    }
    $e.same_source_disk_rejected=$true
    $outputDir=Join-Path $testDir 'recovered'
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
    $outputRoot=[IO.Path]::GetPathRoot($outputDir).Substring(0,1)
    $outputPart=Get-Partition -DriveLetter $outputRoot -ErrorAction Stop
    if($outputPart.DiskNumber -eq $vhdDisk.Number) { throw 'Recovery destination shares the VHD physical disk.' }
    $result=@(Invoke-Json @('extract-fat',$devicePath,[string]$candidate.id,$outputDir,'--json') 'extract')
    if($result.Count -ne 1 -or $result[0].kind -ne 'extract') { throw 'Extraction output invalid' }
    $recovered=[IO.Path]::GetFullPath([string]$result[0].path)
    $safeRoot=[IO.Path]::GetFullPath($outputDir).TrimEnd('\')+'\'
    if(-not $recovered.StartsWith($safeRoot,[StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $recovered -PathType Leaf)) { throw 'Recovered file was not safely published.' }
    $e.recovered_sha256=(Get-FileHash -LiteralPath $recovered -Algorithm SHA256).Hash.ToLowerInvariant()
    $e.recovered_size=(Get-Item -LiteralPath $recovered).Length
    if($e.recovered_sha256 -ne $expected -or $e.recovered_size -ne $payload.Length) {
        $bytes=[IO.File]::ReadAllBytes($recovered)
        $e.first32_hex=[Convert]::ToHexString([byte[]]$bytes[0..31])
        throw 'Actual deleted FAT/exFAT recovered SHA256 differs from original.'
    }
    $e.recovered_sha256_matches_original=$true
    $e.result='passed'
    Write-Host "[PASS] $FileSystem real Windows raw volume deletion, scan, preview, extract, SHA-256."
} catch {
    $e.error=$_.Exception.Message
    $e.result='failed'
    Write-Error -ErrorAction Continue "[FAILED] $FileSystem : $($e.error)"
    throw
} finally {
    Save-Evidence
    if(Test-Path -LiteralPath $vhd) {
        try {
            Invoke-DiskPart $diskpartDetach (Join-Path $evidenceDir 'detach-diskpart.log')
            $di=Get-DiskImage -ImagePath $vhd -ErrorAction SilentlyContinue
            if($di -and $di.Attached) { throw 'Disposable VHD still attached.' }
            $e.vhd_detached=$true
            Remove-Item -LiteralPath $testDir -Recurse -Force
            Save-Evidence
        } catch {
            $e.cleanup_error=$_.Exception.Message
            $e.result='failed';Save-Evidence
            throw
        }
    }
}