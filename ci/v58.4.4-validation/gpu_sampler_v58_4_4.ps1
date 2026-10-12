function Get-OptionalGpuMemorySample([int]$ProcessId) {
    # GPU process counters are optional. Discard invalid/partial sets rather than
    # converting missing samples to zero or emitting non-terminating errors.
    $counterErrors = @()
    try {
        $counterSet = Get-Counter '\GPU Process Memory(*)\Dedicated Usage','\GPU Process Memory(*)\Shared Usage' -ErrorAction SilentlyContinue -ErrorVariable +counterErrors
        if ($null -eq $counterSet -or @($counterErrors).Count -gt 0) {
            return [pscustomobject]@{ available=$false; dedicatedMb=$null; sharedMb=$null; reason='counter_query_failed' }
        }
        $dedicated = 0.0; $shared = 0.0
        $seenDedicated = $false; $seenShared = $false
        $instancePattern = 'pid_' + $ProcessId + '_'
        foreach ($sample in @($counterSet.CounterSamples)) {
            if ($sample.InstanceName -notlike ('*' + $instancePattern + '*')) { continue }
            if ($null -eq $sample.Status -or [int64]$sample.Status -ne 0) { continue }
            $value = [double]$sample.CookedValue
            if ([double]::IsNaN($value) -or [double]::IsInfinity($value) -or $value -lt 0) { continue }
            if ($sample.Path -match 'Dedicated Usage$') { $dedicated += $value; $seenDedicated = $true }
            elseif ($sample.Path -match 'Shared Usage$') { $shared += $value; $seenShared = $true }
        }
        if ($seenDedicated -and $seenShared) {
            return [pscustomobject]@{
                available=$true; dedicatedMb=[math]::Round($dedicated / 1MB,2)
                sharedMb=[math]::Round($shared / 1MB,2); reason='ok'
            }
        }
        return [pscustomobject]@{ available=$false; dedicatedMb=$null; sharedMb=$null; reason='no_complete_valid_process_sample' }
    } catch {
        return [pscustomobject]@{ available=$false; dedicatedMb=$null; sharedMb=$null; reason='counter_exception' }
    }
}
