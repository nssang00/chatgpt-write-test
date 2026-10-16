#requires -Version 5.1
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot '..\DualPlayer\UnityPlayerCache.ps1')
$root=Join-Path $env:TEMP ('cwv-player-cache-fixture-'+[guid]::NewGuid().ToString('N'))
function Put([string]$path,[string]$body){
 New-Item -ItemType Directory -Force -Path (Split-Path $path -Parent) | Out-Null
 [IO.File]::WriteAllText($path,$body)
}
function Must([bool]$condition,[string]$msg){if(-not $condition){throw $msg}}
try{
 $manifest=Join-Path $root 'kit\SHA256SUMS.txt'
 $unity=Join-Path $root 'unity\Unity.exe'
 $native=Join-Path $root 'stage\native\Release'
 $runtime=Join-Path $root 'stage\runtime\Release'
 $legacy=Join-Path $root 'legacy'
 $stage=Join-Path $root 'stage'
 Put $manifest ('a' * 64+'  Runtime/foo.cs')
 Put $unity 'unity 2022.3.62f3 fixture'
 Put (Join-Path $native 'CompanyWebViewCefTextureProbe.dll') 'native pinned'
 Put (Join-Path $runtime 'libcef.dll') 'CEF 154 fixture'
 Put (Join-Path $legacy 'Runtime\WebView.cs') 'public class Sample {}'
 $args=@{KitManifest=$manifest;UnityExe=$unity;CefSource=$legacy;CefStage=$stage;
  NativeDll=$native;RuntimeDir=$runtime}
 $a=Get-DualPlayerCacheKey @args
 $b=Get-DualPlayerCacheKey @args
 Must ($a -ceq $b -and $a -match '^[0-9a-f]{24}$') 'Identical input must yield stable key'
 $work=Join-Path $root ('player-cache\'+$a)
 Must (-not (Test-DualPlayerCache -Work $work -Key $a)) 'Missing build must be a MISS'
 $plugin=Join-Path $work 'Player\UnifiedDualPreview_Data\Plugins\x86_64'
 Put (Join-Path $work 'Player\UnifiedDualPreview.exe') 'player fixture'
 foreach($name in @('CompanyWebViewCefTextureProbe.dll','CompanyWebView2UnifiedPreview.dll',
  'CompanyWebViewCefSubprocess.exe','libcef.dll','icudtl.dat','resources.pak',
  'chrome_100_percent.pak','locales\en-US.pak')){
  Put (Join-Path $plugin $name) 'fixture'
 }
 Put (Join-Path $work 'PlayerCache.key') $a
 Must (Test-DualPlayerCache -Work $work -Key $a) 'Valid build must be a HIT'
 Must (-not (Test-DualPlayerCache -Work $work -Key ('f'*24))) 'Mismatched marker must not hit'
 Remove-Item -LiteralPath (Join-Path $plugin 'libcef.dll')
 Must (-not (Test-DualPlayerCache -Work $work -Key $a)) 'Missing native resource must invalidate cache'
 Put (Join-Path $plugin 'libcef.dll') 'fixture'
 Put (Join-Path $legacy 'Runtime\WebView.cs') 'public class ChangedSource {}'
 $changed=Get-DualPlayerCacheKey @args
 Must ($a -cne $changed) 'CEF managed source changes must invalidate cache'
 Put $manifest ('b' * 64+'  Runtime/foo.cs')
 Must ((Get-DualPlayerCacheKey @args) -cne $changed) 'Kit source manifest changes must invalidate cache'
 Write-Host 'Unity Player persistent cache fixture PASS: HIT, MISS, marker, runtime integrity, source and kit invalidation'
}finally{
 if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}
}
