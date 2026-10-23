#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Url,
  [Parameter(Mandatory=$true)][string]$Sha256,
  [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($Url -notmatch '^https://') { throw 'CWV kit must use HTTPS' }
if ($Sha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'CWV_KIT_SHA256 must be an exact 64-character SHA256' }
if (Test-Path -LiteralPath $Destination) { throw 'Destination must not already exist' }
$zip = Join-Path $env:RUNNER_TEMP 'cwv-private-kit.zip'
try {
  Invoke-WebRequest -Uri $Url -OutFile $zip -UseBasicParsing -MaximumRedirection 3
  $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
  if ($hash -ine $Sha256) { throw "CompanyWebView kit SHA256 mismatch: $hash" }
  Expand-Archive -LiteralPath $zip -DestinationPath $Destination
  $candidates = @(Get-ChildItem -LiteralPath $Destination -Filter 'Build-Native-Rpc.ps1' -File -Recurse)
  if ($candidates.Count -ne 1) { throw 'Expected exactly one CompanyWebView kit root' }
  $root = $candidates[0].DirectoryName
  foreach ($item in @('Build-Native-Rpc.ps1','Run-Auto.ps1','Test-Bridge-PlayerSmoke.ps1','CI/Fetch-VerifiedSdk.ps1','CI/Test-GpuEvidence.ps1','Validation/ProductPanelCompile.csproj')) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $item) -PathType Leaf)) { throw "Required kit file missing: $item" }
  }
  "CWV_KIT_ROOT=$root" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
  Write-Host '[CWV] Private source kit verified and extracted (archive not published)'
} finally {
  Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
}
