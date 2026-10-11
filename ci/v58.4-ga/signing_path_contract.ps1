$ErrorActionPreference='Stop'
$base = 'C:\artifact'
$sample = 'C:\artifact\Runtime\Plugins\x86_64\foo.dll'
$rel = $sample.Substring($base.Length).TrimStart('\') -replace '\\','/'
if ($rel -ne 'Runtime/Plugins/x86_64/foo.dll') { throw "Signing path normalization failed: $rel" }
Write-Host "SIGNING_PATH_NORMALIZATION=PASS $rel"
