#requires -Version 5.1
param([string]$RepoRoot=$env:GITHUB_WORKSPACE)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
function Require([bool]$ok,[string]$why){if(-not $ok){throw $why}}
$repo=[IO.Path]::GetFullPath($RepoRoot)
$kit=Join-Path $repo 'CompanyWebViewDualOneClick'
$oneclick=Join-Path $kit 'oneclick_bundle'
$src=Join-Path $repo 'Integration\UnityUnified-v58.6.0-preview'
foreach($x in @('Runtime','DualPlayer','Plugins\x86_64','oneclick_bundle\Package\com.company.webview\Runtime',
 'oneclick_bundle\Build\cef-native\stage\native\Release',
 'oneclick_bundle\Build\cef-native\stage\runtime\Release')){
 New-Item -ItemType Directory -Force -Path (Join-Path $kit $x) | Out-Null
}
# Existing CI archived only the native CEF sources, not the validated public Unity facade.
# Package the actual pinned CEF binaries, and provide an automatic source importer for
# the user's pre-existing v58.4.4 oneclick_bundle (never claim to have embedded
# bytes for a file that GitHub CI does not possess).
$managedSha='f568ba150a2ab87b0bb6298f0364597a6c53e668774b8d74e24b19b2387b8134'
$hash='80453dc4c58e8ff8bc6fa62867aad08f033cb55550ff2e3b4e761ff9fc8218fe'
$sourcePlaceholder=Join-Path $oneclick 'Package\com.company.webview\Runtime'
New-Item -ItemType Directory -Force -Path $sourcePlaceholder|Out-Null
'Original validated Unity C# sources are automatically imported into this folder from your existing oneclick_bundle at first run. No long-path Documentation~ copy.'|
  Set-Content -LiteralPath (Join-Path $sourcePlaceholder 'SOURCE_IMPORT_NOTE.txt') -Encoding ASCII
# Pin binary runtime to the COMPLETE original successful v58.4.4 Windows CI build.
$artifact=Join-Path $repo 'cef-windows-validated-artifact'
Require (Test-Path -LiteralPath $artifact -PathType Container) 'Original CEF CI native artifact not downloaded'
$cefDll=Get-ChildItem -LiteralPath $artifact -Recurse -File -Filter 'libcef.dll'|Select-Object -First 1
Require ($null -ne $cefDll) 'Original CEF CI artifact does not contain CEF stage runtime'
$sourceRuntimeBinary=Split-Path $cefDll.FullName -Parent
Require ((Split-Path $sourceRuntimeBinary -Leaf) -eq 'Release') 'CEF artifact not runtime/Release'
Require ((Split-Path (Split-Path $sourceRuntimeBinary -Parent) -Leaf) -eq 'runtime') 'CEF artifact stage layout unexpected'
$stageRoot=Split-Path (Split-Path $sourceRuntimeBinary -Parent) -Parent
$sourceNative=Join-Path $stageRoot 'native\Release'
Require (Test-Path -LiteralPath (Join-Path $sourceNative 'CompanyWebViewCefTextureProbe.dll') -PathType Leaf) 'Validated native CEF Texture probe missing'
$runtimeDest=Join-Path $oneclick 'Build\cef-native\stage\runtime\Release'
$nativeDest=Join-Path $oneclick 'Build\cef-native\stage\native\Release'
& robocopy $sourceRuntimeBinary $runtimeDest /E /R:1 /W:1 /NFL /NDL /NP /NJH /NJS /XF *.pdb *.log *.json /XD smoke-cache cef-cache profiles results | Out-Null
Require ($LASTEXITCODE -lt 8) 'CEF native runtime resources robocopy failed'
Copy-Item -LiteralPath (Join-Path $sourceNative 'CompanyWebViewCefTextureProbe.dll') -Destination $nativeDest -Force
foreach($required in @('libcef.dll','CompanyWebViewCefSubprocess.exe','icudtl.dat',
 'resources.pak','chrome_100_percent.pak','locales\en-US.pak')){
 Require (Test-Path -LiteralPath (Join-Path $runtimeDest $required) -PathType Leaf) "CEF stage incomplete: $required"
}
Require ((Get-Item -LiteralPath (Join-Path $runtimeDest 'libcef.dll')).Length -gt 100MB) 'CEF libcef.dll is not a full binary payload'
Write-Host "[PACKAGE] Real v58.4.4 CEF native stage copied inside nested oneclick_bundle"
# Dedicated unified app binaries and minimal bootstrap scripts at ASCII-only paths.
Copy-Item -LiteralPath (Join-Path $src 'DualPlayer\Run-Dual.cmd') -Destination (Join-Path $kit 'Run-Dual.cmd')
Copy-Item -LiteralPath (Join-Path $src 'DualPlayer\Run-Dual.ps1') -Destination (Join-Path $kit 'Run-Dual.ps1')
foreach($name in @('Screen-Automation.ps1','BuildUnifiedDualPlayer.cs',
 'UnifiedDualPlayerEvidence.cs','Install-UnifiedManagedSources.ps1','Import-CefUnitySources.ps1')){
 Copy-Item -LiteralPath (Join-Path $src ('DualPlayer\'+$name)) -Destination (Join-Path $kit 'DualPlayer') -Force
}
foreach($name in @('UnifiedWebView.cs','CefTextureBackendBridge.cs','WebView2OverlayBackendBridge.cs',
 'UnifiedTextureSceneHost.cs','UnifiedOverlaySceneHost.cs')){
 Copy-Item -LiteralPath (Join-Path $src ('Runtime\'+$name)) -Destination (Join-Path $kit 'Runtime') -Force
}
Copy-Item -LiteralPath (Join-Path $repo 'build-webview2/Release/CompanyWebView2UnifiedPreview.dll') -Destination (Join-Path $kit 'Plugins\x86_64') -Force
@'
CompanyWebViewDualOneClick - EXPERIMENTAL Windows Unity D3D11
HOW TO USE:
  1. Extract the ZIP ONCE to a folder with ENGLISH letters only, e.g. C:\WebViewDual\
  2. Double-click Run-Dual.cmd from the extracted folder.
  3. Pinned CEF 58.4.4 BINARY stage is INSIDE oneclick_bundle. Unity C# files auto-import on first run.
  4. Keep old oneclick_bundle in Downloads; its validated Unity sources are imported automatically. No manual copying.
  5. At end, upload only results\dual-*.zip.
Proof: Original pinned CI v58.4.4 CEF Stage / run 38311313634.
No Unity GPU dual-backend Player evidence yet; released product is not certified.
'@|Set-Content -LiteralPath (Join-Path $kit 'README_FIRST.txt') -Encoding ASCII
$info=[ordered]@{
 schema='cef-bundled-stage-v1';
 originalValidationRun=38311313634;
 cefVersion='58.4.4';
 cefSourcePayloadSha256=$hash;
 cefManagedFacadeSha256=$managedSha;
 runtimeEntryCount=@(Get-ChildItem -LiteralPath $runtimeDest -Recurse -File).Count;
 status='Validated original CI native build artifact re-used; Unity dual-runtime not tested';
}
$info|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $oneclick 'STAGE_PROVENANCE.json') -Encoding UTF8
# Regression: simulate the exact user-reported path (but ASCII folder) and require C# files, not Documentation~.
$scratch=Join-Path $env:RUNNER_TEMP 'CompanyWebViewDualOneClick_regression'
$assets=Join-Path $scratch 'results\dual-20261015-090746\UnityProject\Assets'
# Simulate exact previous Downloads/oneclick_bundle asset copy with an isolated
# pinned-hash fixture only if the canonical source bytes are provided externally.
# Do NOT fabricate a CEF WebView.cs solely to make a hosted-runner build pass.
Require (Test-Path -LiteralPath (Join-Path $kit 'DualPlayer\Import-CefUnitySources.ps1')) 'CEF Unity source auto-importer not packaged'
Write-Host '[PACKAGE] Long-path documentation copy removed; CEF facade requires validated local original and is imported on first run'

# Manifest covers each actual file inside the ZIP including the 300+MB binary. SHA comparison enforced by Run-Dual.
$files=@(Get-ChildItem -LiteralPath $kit -Recurse -File | Sort-Object FullName)
$hashes=@(foreach($f in $files){
 $relative=$f.FullName.Substring($kit.Length+1).Replace('\','/')
 '{0}  {1}' -f (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant(),$relative
})
$hashes|Set-Content -LiteralPath (Join-Path $kit 'SHA256SUMS.txt') -Encoding UTF8
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $kit 'Run-Dual.ps1') -BundleRoot $kit -SelfTest
Require ($LASTEXITCODE -eq 0) 'ASCII full CEF OneClick self-test failed'
Write-Host "[PACKAGE] Final nested CEF OneClick PASS: $($files.Count) verified files; no Unity Player GPU claim"
