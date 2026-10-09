param([Parameter(Mandatory=$true)][string]$BundleRoot)
$ErrorActionPreference='Stop'
$buildScript = Join-Path $BundleRoot "Tools\Build-CefWindowsX64.ps1"
if (-not (Test-Path -LiteralPath $buildScript)) {
    throw "Bundle-root native build script missing: $buildScript"
}
$packageInternal = Join-Path $BundleRoot "Package\com.company.webview\Tools\Build-CefWindowsX64.ps1"
if (Test-Path -LiteralPath $packageInternal) {
    throw "Package-internal native build script path must not be used after release separation: $packageInternal"
}
[pscustomobject]@{ buildScript=$buildScript; bundleRootTools=$true; packageInternalTools=$false } | ConvertTo-Json -Compress
