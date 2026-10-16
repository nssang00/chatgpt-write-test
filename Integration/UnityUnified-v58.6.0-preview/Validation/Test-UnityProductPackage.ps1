#requires -Version 5.1
# Synthetic dependency fixture: proves package assembly, NOT real CEF/Unity behavior.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=Join-Path $env:TEMP ('cwv-upm-fixture-'+[guid]::NewGuid().ToString('N'))
$script=Join-Path $PSScriptRoot 'New-UnityProductPackage.ps1'
$integration=Split-Path $PSScriptRoot -Parent
function Put([string]$path,[string]$value){
 New-Item -ItemType Directory -Force -Path (Split-Path $path -Parent) | Out-Null
 [IO.File]::WriteAllText($path,$value)
}
function Must([bool]$condition,[string]$message){if(-not $condition){throw $message}}
try{
 $legacy=Join-Path $root 'cef\Runtime'
 $stage=Join-Path $root 'cef\stage'
 $webview2=Join-Path $root 'CompanyWebView2UnifiedPreview.dll'
 $target=Join-Path $root 'out\com.company.webview'
 Put (Join-Path $legacy 'WebView.cs') 'namespace Company.WebView { public class WebView {} }'
 Put (Join-Path $legacy 'CefTextureSurface.cs') 'namespace Company.WebView { public class CefTextureSurface {} }'
 Put (Join-Path $stage 'native\Release\CompanyWebViewCefTextureProbe.dll') 'native CEF fixture'
 foreach($name in @('CompanyWebViewCefSubprocess.exe','libcef.dll','icudtl.dat','resources.pak','chrome_100_percent.pak','locales\en-US.pak')){
  Put (Join-Path (Join-Path $stage 'runtime\Release') $name) ('native '+$name)
 }
 Put (Join-Path $stage 'runtime\Release\session.log') 'DO NOT COPY'
 Put $webview2 'valid WebView2 fixture'
 $args=@{CefRuntimeDir=$legacy;CefStageDir=$stage;WebView2Dll=$webview2;
  OutputDir=$target;IntegrationRoot=$integration}
 # Missing input must fail before writing output.
 $missing=Join-Path $stage 'runtime\Release\icudtl.dat'
 Remove-Item -LiteralPath $missing
 $didFail=$false
 try { & $script @args 2>$null }catch{$didFail=$true}
 Must $didFail 'Missing CEF resource must reject package export'
 Must (-not (Test-Path -LiteralPath $target)) 'Failed export created target'
 Put $missing 'restored fixture'
 & $script @args
 Must (Test-Path -LiteralPath $target -PathType Container) 'Missing assembled UPM'
 $json=Get-Content (Join-Path $target 'package.json') -Raw -Encoding UTF8|ConvertFrom-Json
 Must ($json.name -eq 'com.company.webview') 'UPM package name'
 Must ($json.version -match 'preview') 'Must remain marked PREVIEW'
 foreach($file in @('Runtime\CefValidated\WebView.cs','Runtime\CefValidated\CefTextureSurface.cs',
  'Runtime\Unified\UnifiedWebView.cs','Runtime\Unified\UnifiedTextureSceneHost.cs',
  'Runtime\Unified\UnifiedOverlaySceneHost.cs','Runtime\Company.WebView.Runtime.asmdef',
  'Editor\CompanyWebViewPrefabWizard.cs','Editor\CompanyWebViewBuildStage.cs','Editor\Company.WebView.Editor.asmdef',
  'Runtime\Plugins\x86_64\CompanyWebViewCefTextureProbe.dll',
  'Runtime\Plugins\x86_64\CompanyWebView2UnifiedPreview.dll',
  'Runtime\Plugins\x86_64\locales\en-US.pak')){
  Must (Test-Path -LiteralPath (Join-Path $target $file) -PathType Leaf) "Missing expected UPM file: $file"
 }
 Must (-not (Test-Path -LiteralPath (Join-Path $target 'Runtime\Plugins\x86_64\session.log'))) 'Log leakage'
 Must (-not (Test-Path -LiteralPath (Join-Path $target 'DualPlayer'))) 'OneClick test leaked into release package'
 $expected=(Get-FileHash -LiteralPath (Join-Path $legacy 'WebView.cs') -Algorithm SHA256).Hash
 $got=(Get-FileHash -LiteralPath (Join-Path $target 'Runtime\CefValidated\WebView.cs') -Algorithm SHA256).Hash
 Must ($expected -ceq $got) 'Validated legacy CEF source modified'
 $didFail=$false
 try{& $script @args 2>$null}catch{$didFail=$true}
 Must $didFail 'Existing output must never be overwritten'
 Write-Host '[UPM FIXTURE] PASS: missing dependencies, non-overwrite, source hash, layout, exclusion, Editor prefab source'
}finally{
 if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}
}
