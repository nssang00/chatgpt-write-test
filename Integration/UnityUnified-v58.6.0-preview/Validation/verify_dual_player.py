from pathlib import Path
root=Path(__file__).resolve().parents[1]
dual=root/'DualPlayer'
builder=(dual/'BuildUnifiedDualPlayer.cs').read_text(encoding='utf-8')
tele=(dual/'UnifiedDualPlayerEvidence.cs').read_text(encoding='utf-8')
ps=(dual/'Run-Dual.ps1').read_text(encoding='utf-8')
cmd=(dual/'Run-Dual.cmd').read_text(encoding='utf-8')
guide=(dual/'README_FIRST_KO.md').read_text(encoding='utf-8')
for required in ['CefTextureSurface','UnifiedTextureSceneHost','UnifiedOverlaySceneHost',
 'GraphicsDeviceType.Direct3D11','PlayerSettings.resizableWindow=true',
 'Assign(textureHost,"validatedTextureSurface",cefSurface)',
 'BuildPipeline.BuildPlayer','-dualBuildPath']:
 assert required in builder, required
for required in ['cefAcceleratedFrames','cefRawImageBound','overlayMessageCount',
 'overlayJoined','cefShutdown','status="FAIL_AUTO"','manualImeDpiZOrderPending=true',
 'WriteAllText','Application.Quit']:
 assert required in tele, required
for required in ['GetCefPackageFromBundle','Get-FileHash','SHA256SUMS.txt',
 'CompanyWebViewCefTextureProbe.dll','libcef.dll','Run','-dualEvidencePath',
 'CEF runtime','player-runtime-evidence.json','PENDING_MANUAL',
 'Compress-Archive -LiteralPath $safe']:
 assert required in ps, required
cache=(dual/'UnityPlayerCache.ps1').read_text(encoding='utf-8')
for required in ("Get-DualPlayerCacheKey", "Test-DualPlayerCache", "PlayerCache.key",
                 "SHA256", "CompanyWebViewCefTextureProbe.dll", "libcef.dll",
                 "UnityProject", "Runtime", "CompanyWebView2UnifiedPreview.dll"):
    if required == "UnityProject":
        assert required in ps, required
    else:
        assert required in cache, required
for required in ("$summary.buildCache='HIT'", "$summary.buildCache='MISS'",
                 "if(Test-DualPlayerCache -Work $work -Key $key)",
                 "[IO.File]::Open((Join-Path $work 'build.lock')",
                 "Set-Content -LiteralPath $marker -Value $key",
                 "LOCALAPPDATA/CWV58/pc"):
    assert required in ps, required
assert ps.index("if(Test-DualPlayerCache -Work $work -Key $key)") < ps.index("StageCef $CefRuntimeDir $dest")
assert 'Run-Dual.ps1' in cmd and 'oneclick_bundle' in guide
assert 'UnityProject' not in ps.split("$safe=@(")[1].split(")")[0]
assert '50e8c2' not in ps, 'Do not invent source identity'
assert 'new Rect(0f,0f,1f,1f)' in builder, 'Hidden source RawImage must not apply visible UV flips'
assert '(evidence.overlayUnicodeRoundtripCount==0 || evidence.overlayPingRoundtripCount==0)' in tele, 'Retry until both probes are proven'
bridge=(root/'Runtime'/'WebView2OverlayBackendBridge.cs').read_text(encoding='utf-8')
assert 'CallingConvention=CallingConvention.Cdecl, CharSet=CharSet.Unicode)]\n        private static extern int WV2Unified_ReadMessage' in bridge, 'Incoming native wchar_t* buffer requires UTF-16 marshal'
print('Dual Player CEF Texture + WebView2 HWND source/evidence contract PASS; Unity runtime NOT RUN')

assert 'UnifiedSource-v58.6.0.zip' not in ps, 'One folder kit must not require the old source snapshot ZIP'
installer=(dual/'Install-UnifiedManagedSources.ps1').read_text(encoding='utf-8')
for required in ("Join-Path $targetRuntime 'UnifiedExperimental'",
                 'New-Item -ItemType Directory -Force -Path $unified',
                 'Runtime\\WebView.cs','Copy-Item -LiteralPath $original -Destination $destination'):
 assert required in installer, required
assert 'Install-UnifiedManagedSources.ps1' in ps
assert "$runtime $name" not in ps

