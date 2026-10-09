param([Parameter(Mandatory=$true)][string]$PackageRoot)
$ErrorActionPreference = 'Stop'
$promotedRuntime = Join-Path $PackageRoot "Runtime\Backends\CEF\Native\Host\CefRuntime.cpp"
$stalePrototype = Join-Path $PackageRoot "Prototypes\CefTexture"
if (-not (Test-Path -LiteralPath $promotedRuntime)) {
    throw "Promoted Runtime CEF source missing; refusing stale prototype cleanup: $promotedRuntime"
}
$removed = $false
if (Test-Path -LiteralPath $stalePrototype) {
    Remove-Item -LiteralPath $stalePrototype -Recurse -Force
    $prototypeRoot = Join-Path $PackageRoot "Prototypes"
    if ((Test-Path -LiteralPath $prototypeRoot) -and -not (Get-ChildItem -LiteralPath $prototypeRoot -Force | Select-Object -First 1)) {
        Remove-Item -LiteralPath $prototypeRoot -Force
    }
    $removed = $true
}
[pscustomobject]@{ removed=$removed; staleExists=(Test-Path -LiteralPath $stalePrototype); promotedExists=(Test-Path -LiteralPath $promotedRuntime) } | ConvertTo-Json -Compress
