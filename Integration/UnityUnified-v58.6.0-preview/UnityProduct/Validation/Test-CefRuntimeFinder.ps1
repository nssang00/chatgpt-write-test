#requires -Version 5.1
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot '..\Find-CefRuntime.ps1')
$originalLocal=$env:LOCALAPPDATA
$originalUser=$env:USERPROFILE
$originalOverride=$env:CEF_V58_4_4_RUNTIME_DIR
$tmp=Join-Path $env:TEMP ('cwv-upm-runtime-fixture-'+[guid]::NewGuid().ToString('N'))
function Put([string]$file){New-Item -ItemType Directory -Force -Path (Split-Path $file -Parent)|Out-Null;[IO.File]::WriteAllText($file,'fixture')}
function StageFiles([string]$native,[string]$runtime){
 Put (Join-Path $native 'CompanyWebViewCefTextureProbe.dll')
 foreach($n in @('libcef.dll','CompanyWebViewCefSubprocess.exe','icudtl.dat','resources.pak',
                  'chrome_100_percent.pak','locales\en-US.pak')){Put (Join-Path $runtime $n)}
}
function Check([bool]$success,[string]$message){if(-not $success){throw $message}}
try {
 $env:LOCALAPPDATA=Join-Path $tmp 'Local'
 $env:USERPROFILE=Join-Path $tmp 'User'
 $env:CEF_V58_4_4_RUNTIME_DIR=''
 $split=Join-Path $tmp 'validated\Build\cef-native\stage'
 StageFiles (Join-Path $split 'native\Release') (Join-Path $split 'runtime\Release')
 $s=Find-ValidatedCefLayout -RequestedPath $split
 Check ($s.Native -like '*native\Release') 'Split stage not resolved'
 Check ($s.Runtime -like '*runtime\Release') 'Split resources not resolved'
 $flat=Join-Path $env:LOCALAPPDATA 'CWV58\pc\abc123\Player\UnifiedDualPreview_Data\Plugins\x86_64'
 StageFiles $flat $flat
 $f=Find-ValidatedCefLayout -KitDir (Join-Path $tmp 'kit')
 Check ($f.Root -eq [IO.Path]::GetFullPath($flat)) 'Persistent cached Player not found'
 $direct=Find-ValidatedCefLayout -RequestedPath $flat
 Check ($direct.Root -eq $f.Root) 'Explicit flat Player path not supported'
 $old=Join-Path $env:USERPROFILE 'Downloads\CompanyWebView_v58.6\oneclick_bundle\Build\cef-native\stage'
 StageFiles (Join-Path $old 'native\Release') (Join-Path $old 'runtime\Release')
 $download=Find-ValidatedCefLayout -RequestedPath (Join-Path $env:USERPROFILE 'Downloads\CompanyWebView_v58.6\oneclick_bundle')
 Check ($download.Root -eq [IO.Path]::GetFullPath($old)) 'Existing oneclick_bundle split stage not supported'
 Remove-Item -LiteralPath (Join-Path $flat 'libcef.dll') -Force
 $fallback=Find-ValidatedCefLayout -KitDir (Join-Path $tmp 'kit')
 Check ($fallback.Root -eq [IO.Path]::GetFullPath($old)) 'Incomplete preferred cache must fall back to another complete source'
 $failed=$false
 try{$null=Find-ValidatedCefLayout -RequestedPath $flat}catch{$failed=$_.Exception.Message -match 'CEF runtime incomplete'}
 Check $failed 'Explicit incomplete Player path silently succeeded or fell back'
 Write-Host 'Offline CEF runtime reuse resolver PASS: split, flat Player cache, legacy oneclick, incomplete cache, explicit error'
}finally {
 $env:LOCALAPPDATA=$originalLocal
 $env:USERPROFILE=$originalUser
 $env:CEF_V58_4_4_RUNTIME_DIR=$originalOverride
 if(Test-Path -LiteralPath $tmp){Remove-Item -LiteralPath $tmp -Recurse -Force}
}
