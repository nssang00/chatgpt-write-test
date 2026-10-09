param([int]$ExitCode=33,[bool]$GpuCrash=$true)
$failureCode = if ($GpuCrash) { "REFRESH_GPU_PROCESS_CRASH" } else { "REFRESH_PROBE_FAILED" }
$result = [ordered]@{
  failureCode=$failureCode
  gating=$false
  continuedToFullSuite=$true
  shouldAbort=$false
  status="WARN"
}
$result | ConvertTo-Json -Compress
