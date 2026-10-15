#requires -Version 5.1
# Automatically import original pinned CEF Unity sources into the NEW kit's nested oneclick_bundle.
# Never modifies the pre-existing original on the user's computer.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$KitRoot)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$kit=[IO.Path]::GetFullPath($KitRoot)
$package=Join-Path $kit 'oneclick_bundle\Package\com.company.webview'
$target=Join-Path $package 'Runtime'
$entry=Join-Path $target 'WebView.cs'
$sha='f568ba150a2ab87b0bb6298f0364597a6c53e668774b8d74e24b19b2387b8134'
if(Test-Path -LiteralPath $entry -PathType Leaf) {
 if((Get-FileHash -LiteralPath $entry -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha){
  throw 'Embedded CEF WebView.cs hash does not match validated v58.4.4'
 }
 Write-Output $package;return
}
$roots=@((Split-Path -Parent $kit),
 (Join-Path $env:USERPROFILE 'Downloads'),(Join-Path $env:USERPROFILE 'Desktop'))
$found=$null
foreach($r in $roots) {
 if(-not $r -or -not (Test-Path -LiteralPath $r -PathType Container)){continue}
 foreach($name in @('oneclick_bundle','old_oneclick_bundle','CEF-v58.4.4\oneclick_bundle')){
  $p=Join-Path $r $name
  $web=Join-Path $p 'Package\com.company.webview\Runtime\WebView.cs'
  if(Test-Path -LiteralPath $web -PathType Leaf){$found=Join-Path $p 'Package\com.company.webview';break}
 }
 if($found){break}
 $children=@(Get-ChildItem -LiteralPath $r -Directory -ErrorAction SilentlyContinue |
   Where-Object{$_.Name -match '(?i)cef|oneclick|webview'}|Select-Object -First 60)
 foreach($child in $children) {
  $c=Join-Path $child.FullName 'oneclick_bundle\Package\com.company.webview'
  if(Test-Path -LiteralPath (Join-Path $c 'Runtime\WebView.cs') -PathType Leaf){$found=$c;break}
 }
 if($found){break}
}
if(-not $found){
 throw 'The validated CEF runtime is bundled, but the original Unity WebView.cs could not be auto-imported. Place the original oneclick_bundle next to this ASCII kit; no files must be copied manually.'
}
$original=Join-Path $found 'Runtime'
$sourceFile=Join-Path $original 'WebView.cs'
if((Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha){
 throw 'Original oneclick_bundle CEF WebView.cs differs from validated 58.4.4; not mixing incompatible CEF sources.'
}
New-Item -ItemType Directory -Force -Path $target|Out-Null
$allowed=@('.cs','.asmdef','.asmref','.shader','.compute','.hlsl','.cginc','.uxml','.uss','.png','.asset','.json')
$files=@(Get-ChildItem -LiteralPath $original -Recurse -File |
  Where-Object {$allowed -contains $_.Extension.ToLowerInvariant()})
foreach($file in $files){
 $rel=$file.FullName.Substring($original.Length).TrimStart([char[]]@('\','/'))
 $dest=Join-Path $target $rel
 New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent)|Out-Null
 Copy-Item -LiteralPath $file.FullName -Destination $dest -Force -ErrorAction Stop
}
if(-not (Test-Path -LiteralPath $entry -PathType Leaf)){
 throw 'CEF runtime managed sources not imported'
}
Write-Host "[DUAL] Imported $($files.Count) validated CEF Unity files into kit/oneclick_bundle (no long-path Documentation~)"
Write-Output $package
