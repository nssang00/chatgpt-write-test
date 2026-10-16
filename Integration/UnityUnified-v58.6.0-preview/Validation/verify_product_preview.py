from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]
template=root/'ProductPackageTemplate'
manifest=json.loads((template/'package.json').read_text(encoding='utf-8'))
runtime=json.loads((template/'Runtime/Company.WebView.Runtime.asmdef').read_text(encoding='utf-8'))
editor=json.loads((template/'Editor/Company.WebView.Editor.asmdef').read_text(encoding='utf-8'))
wizard=(template/'Editor/CompanyWebViewPrefabWizard.cs').read_text(encoding='utf-8')
export=(root/'Validation/New-UnityProductPackage.ps1').read_text(encoding='utf-8')
host=(root/'Runtime/UnifiedTextureSceneHost.cs').read_text(encoding='utf-8')
plan=(root/'PRODUCT_ROADMAP_TEST_MATRIX_KO.md').read_text(encoding='utf-8')
assert manifest['name']=='com.company.webview'
assert manifest['version'].startswith('0.') and 'preview' in manifest['version']
assert manifest['dependencies'].get('com.unity.ugui')
assert runtime['name']=='Company.WebView.Runtime' and 'Unity.ugui' in runtime['references']
assert editor['name']=='Company.WebView.Editor'
assert 'Company.WebView.Runtime' in editor['references'] and editor['includePlatforms']==['Editor']
for expr in ('Create Preview Prefabs','PrefabUtility.SaveAsPrefabAsset','CompanyWebViewTexture.prefab',
             'CompanyWebViewOverlay.prefab','CefTextureSurface','UnifiedTextureSceneHost',
             'UnifiedOverlaySceneHost','SetRef(cef, "target", image)', '"enablePreview", true'):
    assert expr in wizard,expr
for expr in ('Get-FileHash','CopyFile','RequireFile','CefRuntimeDir','CefStageDir',
             'CompanyWebViewCefSubprocess.exe','CompanyWebView2UnifiedPreview.dll',
             'ProductPackageTemplate','UnifiedWebView.cs',
             '[IO.Directory]::Move($tmp,$output)','Test-Path -LiteralPath $output',
             'UnifiedDualPlayerEvidence.cs','CefCubeTextureProof.cs'):
    assert expr in export,expr
assert 'previous.Close();' in host and host.index('previous.Close();') < host.index('previous.Dispose();')
for gate in ('PKG-01','UX-02','CORE-03','JS-04','IN-05','MULTI-06','LIFE-07',
             'BUILD-08','GPU-09','OVL-10','RPC-11','GPU-12','REL-13','NOT_IMPLEMENTED'):
    assert gate in plan,gate
print('UPM Product PREVIEW source/manifest/wizard/lifecycle and competitor plan contract PASS; Unity Editor NOT RUN')
