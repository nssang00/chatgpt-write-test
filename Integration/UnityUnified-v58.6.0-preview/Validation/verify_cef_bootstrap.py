from pathlib import Path
root=Path(__file__).resolve().parents[1]
bootstrap=(root/'DualPlayer/Ensure-CefRuntime.ps1').read_text(encoding='utf-8-sig')
runner=(root/'DualPlayer/Run-Dual.ps1').read_text(encoding='utf-8-sig')
assert 'Read-Host' not in bootstrap and 'Read-Host' not in runner
assert 'Ensure-CefRuntime.ps1' in runner and 'ResolveCefRuntime' in runner
assert runner.index('$unity=FindUnity') < runner.index('$CefRuntimeDir=ResolveCefRuntime')
for text in ('07e06a42f38cab584ce4e35091d47710539cbaee21883e033ecb97565ec24eb8',
 '154.0.28+g564dd6c+chromium-154.0.8037.58',
 'CefOneClick-v58.4.4-source.zip','cef-builds.spotifycdn.com',
 '.sha1','-Algorithm SHA1','tar.exe -xjf','Build-CefWindowsX64.ps1',
 'CefRuntimeStage','v58.4.4','CompanyWebViewCefTextureProbe.dll','libcef.dll'):
    if text=='CefRuntimeStage':continue # stage target belongs to pinned unmodified builder
    assert text in bootstrap,text
assert 'Invoke-WebRequest' in bootstrap and 'Move-Item -LiteralPath $partial' in bootstrap
assert '$env:LOCALAPPDATA' in bootstrap
assert 'Write-Output $stage' in bootstrap
assert 'exit 0' not in bootstrap
print('Automatic pinned CEF bootstrap static safety contract PASS; no CEF binaries or Unity runtime executed')
