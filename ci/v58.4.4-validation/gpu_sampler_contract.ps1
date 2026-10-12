$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'gpu_sampler_v58_4_4.ps1'
$expectedSha256 = '7d72d0692be3161b0a1a2f102e7e360778c31b63d3039adaf795f5b8a8068c35'
$sha = (Get-FileHash $source -Algorithm SHA256).Hash.ToLowerInvariant()
if ($sha -ne $expectedSha256) { throw "GPU sampler source hash mismatch: $sha" }
$raw = Get-Content $source -Raw
foreach ($needle in @('Get-OptionalGpuMemorySample([int]$ProcessId)', '-ErrorAction SilentlyContinue -ErrorVariable +counterErrors', '[int64]$sample.Status -ne 0', 'no_complete_valid_process_sample', 'counter_exception')) {
    if (-not $raw.Contains($needle)) { throw "Missing v58.4.4 required sampler behavior: $needle" }
}
. $source

function Assert([bool]$Pass, [string]$Label) {
    if (-not $Pass) { throw "GPU sampler contract failed: $Label" }
    Write-Host "PASS $Label"
}
function FakeSample([int]$ProcessNumber, [string]$Kind, [double]$Value, [object]$Status = 0) {
    return [pscustomobject]@{
        InstanceName=('pid_{0}_eng_0' -f $ProcessNumber)
        Path=('\GPU Process Memory(pid_{0}_eng_0)\{1} Usage' -f $ProcessNumber,$Kind)
        Status=$Status
        CookedValue=$Value
    }
}
$script:mode = 'samples'
$script:samples = @()
function Get-Counter {
    [CmdletBinding()]
    param([Parameter(Position=0)][string[]]$Counter)
    if ($script:mode -eq 'no_data') { return $null }
    if ($script:mode -eq 'write_error') { Write-Error 'Invalid performance counter data'; return $null }
    if ($script:mode -eq 'throw') { throw 'GPU performance counter unavailable' }
    return [pscustomobject]@{ CounterSamples=@($script:samples) }
}

$processNumber = 1234
$originalPid = $PID
$script:samples = @(
    (FakeSample 1234 'Dedicated' (2 * 1MB))
    (FakeSample 1234 'Shared' (1 * 1MB))
    (FakeSample 4567 'Dedicated' (80 * 1MB))
    (FakeSample 4567 'Shared' (40 * 1MB))
)
$r = Get-OptionalGpuMemorySample -ProcessId $processNumber
Assert ($r.available -and $r.reason -eq 'ok' -and $r.dedicatedMb -eq 2 -and $r.sharedMb -eq 1) 'valid values and PID isolation'
Assert ($PID -eq $originalPid) 'PowerShell automatic PID unchanged'
$script:samples = @((FakeSample 1234 'Dedicated' (2 * 1MB) -1),(FakeSample 1234 'Shared' (1 * 1MB)))
$r = Get-OptionalGpuMemorySample -ProcessId $processNumber
Assert (-not $r.available -and $r.reason -eq 'no_complete_valid_process_sample' -and $null -eq $r.dedicatedMb) 'invalid counter status excluded'
$script:samples = @((FakeSample 1234 'Dedicated' -1),(FakeSample 1234 'Shared' (1 * 1MB)))
$r = Get-OptionalGpuMemorySample -ProcessId $processNumber
Assert (-not $r.available -and $r.reason -eq 'no_complete_valid_process_sample') 'negative values excluded'
$script:samples = @((FakeSample 1234 'Dedicated' ([double]::NaN)),(FakeSample 1234 'Shared' (1 * 1MB)))
$r = Get-OptionalGpuMemorySample -ProcessId $processNumber
Assert (-not $r.available -and $r.reason -eq 'no_complete_valid_process_sample') 'NaN excluded'
$script:samples = @((FakeSample 1234 'Dedicated' (2 * 1MB)))
$r = Get-OptionalGpuMemorySample -ProcessId $processNumber
Assert (-not $r.available -and $r.reason -eq 'no_complete_valid_process_sample') 'partial memory sets excluded'
$script:mode = 'no_data'
$r = Get-OptionalGpuMemorySample -ProcessId $processNumber
Assert (-not $r.available -and $r.reason -eq 'counter_query_failed') 'missing counter result classified'
$script:mode = 'write_error'
$r = Get-OptionalGpuMemorySample -ProcessId $processNumber
Assert (-not $r.available -and $r.reason -eq 'counter_query_failed') 'nonterminating counter error classified'
$script:mode = 'throw'
$r = Get-OptionalGpuMemorySample -ProcessId $processNumber
Assert (-not $r.available -and $r.reason -eq 'counter_exception') 'terminating counter exception classified'
Assert (([math]::Round(100.0 * 61 / 70, 2)) -eq 87.14) 'Stage2 reported coverage arithmetic'
Write-Host 'v58.4.4 GPU sampler validation PASS'
