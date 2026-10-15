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
# Exact archived Unity sources from CEF v58.4.4 protected CI, not a guessed remake.
$parts=@(Get-ChildItem -LiteralPath (Join-Path $repo 'cef-provenance-repo\ci\v58.2-runtime') -Filter 'source-part*.b64' -File|Sort-Object Name)
Require ($parts.Count -eq 3) 'Original CEF source payload must have exactly 3 parts'
$payload=Join-Path $env:RUNNER_TEMP 'cef-valid-runtime.tar.xz'
[IO.File]::WriteAllBytes($payload,[Convert]::FromBase64String((($parts|ForEach-Object{(Get-Content -LiteralPath $_.FullName -Raw).Trim()}) -join '')))
$hash=(Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash.ToLowerInvariant()
Require ($hash -eq '80453dc4c58e8ff8bc6fa62867aad08f033cb55550ff2e3b4e761ff9fc8218fe') 'Validated source payload differs from protected CEF v58.4.4 CI'
$temp=Join-Path $env:RUNNER_TEMP 'cef-unpack1'
$expanded=Join-Path $env:RUNNER_TEMP 'cef-unpack2'
New-Item -ItemType Directory -Force -Path $temp,$expanded|Out-Null
& 'C:\Program Files\7-Zip\7z.exe' x $payload "-o$temp" -y | Out-Null
Require ($LASTEXITCODE -eq 0) 'CEF xz expansion failed'
$tar=Get-ChildItem -LiteralPath $temp -File -Filter '*.tar'|Select-Object -First 1
Require ($null -ne $tar) 'Expanded CEF TAR missing'
& 'C:\Program Files\7-Zip\7z.exe' x $tar.FullName "-o$expanded" -y | Out-Null
Require ($LASTEXITCODE -eq 0) 'CEF TAR expansion failed'
$sourceRuntime=Join-Path $expanded 'Package\com.company.webview\Runtime'
$sourceWebView=Join-Path $sourceRuntime 'WebView.cs'
if(-not (Test-Path -LiteralPath $sourceWebView -PathType Leaf)){
  Write-Host "[AUDIT] CEF runtime archive root:" -ForegroundColor Yellow
  @(Get-ChildItem -LiteralPath $expanded -File -Recurse |
    Where-Object{$_.Extension -in '.cs','.asmdef','.json','.md','.cpp'} |
    Select-Object -First 100 |
    ForEach-Object{$_.FullName.Substring($expanded.Length+1)}) | ForEach-Object{Write-Host "  $_"}
  throw 'Original v58.2 Runtime source archive does not contain validated v58.4.4 managed Unity facade WebView.cs. Do not substitute an unvalidated facade.'
}
$managedSha=(Get-FileHash -LiteralPath $sourceWebView -Algorithm SHA256).Hash.ToLowerInvariant()
Require ($managedSha -eq 'f568ba150a2ab87b0bb6298f0364597a6c53e668774b8d74e24b19b2387b8134') 'Managed CEF facade SHA mismatch'
$targetRuntime=Join-Path $oneclick 'Package\com.company.webview\Runtime'
$allowed=@('.cs','.asmdef','.asmref','.shader','.compute','.hlsl','.cginc','.uxml','.uss','.png','.asset','.json')
$unityFiles=@(Get-ChildItem -LiteralPath $sourceRuntime -Recurse -File | Where-Object{$allowed -contains $_.Extension.ToLowerInvariant()})
foreach($f in $unityFiles){
 $rel=$f.FullName.Substring($sourceRuntime.Length).TrimStart([char[]]@('\','/'))
 $dest=Join-Path $targetRuntime $rel
 New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent)|Out-Null
 Copy-Item -LiteralPath $f.FullName -Destination $dest
}
Require (Test-Path -LiteralPath (Join-Path $targetRuntime 'WebView.cs')) 'Embedded oneclick_bundle managed source missing'
Write-Host "[PACKAGE] Managed runtime sources staged, count=$($unityFiles.Count)"
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
 'UnifiedDualPlayerEvidence.cs','Install-UnifiedManagedSources.ps1')){
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
  3. The ORIGINAL pinned CEF 58.4.4 runtime stage and Unity sources are INSIDE oneclick_bundle.
  4. Do not copy old oneclick_bundle, do not choose external paths, do not apply patches.
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
& (Join-Path $kit 'DualPlayer\Install-UnifiedManagedSources.ps1') -CefPackagePath (Join-Path $oneclick 'Package\com.company.webview') -UnityAssetsDir $assets -KitRoot $kit
foreach($required in @('WebView.cs','UnifiedExperimental\UnifiedWebView.cs','UnifiedExperimental\CefTextureBackendBridge.cs')){
 Require (Test-Path -LiteralPath (Join-Path $assets ('CompanyWebView\Runtime\'+$required)) -PathType Leaf) "Scratch Unity managed copy failed: $required"
}
Require (@(Get-ChildItem -LiteralPath $assets -File -Recurse|Where-Object{$_.FullName -match 'Documentation~'}).Count -eq 0) 'Unnecessary Documentation~ copied to scratch Unity'
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
