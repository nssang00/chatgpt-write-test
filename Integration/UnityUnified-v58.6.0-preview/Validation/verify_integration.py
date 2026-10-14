from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
web=(root/'Runtime/UnifiedWebView.cs').read_text(encoding='utf-8')
bridge=(root/'Runtime/CefTextureBackendBridge.cs').read_text(encoding='utf-8')
host=(root/'Runtime/UnifiedTextureSceneHost.cs').read_text(encoding='utf-8')
readme=(root/'README.md').read_text(encoding='utf-8')
for needle in ('TargetKind.RawImage','TargetKind.MeshMaterial','TargetKind.RenderTexture',
    'PresentationMode.Overlay','new CefTextureBackendBridge()','NotSupportedException',
    'backend.Dispose()','CEF Texture requires validated subprocess'):
    assert needle in web, needle
for needle in ('validatedCef.Initialize','validatedCef.Open','validatedCef.LoadUrl',
    'validatedCef.PumpMessageLoop','validatedCef.Shutdown','Messages = false',
    'ScriptExecution = false','FullImeComposition = false'):
    assert needle in bridge, needle
assert 'UNITY_STANDALONE_WIN && !UNITY_EDITOR' in host
assert 'CefTextureSurface' in host and 'view.Pump()' in host
assert re.search(r'Overlay.{0,250}NotSupportedException',web,re.DOTALL) or (
    'mode == PresentationMode.Overlay' in web and 'NotSupportedException' in web)
for sha in ('07e06a42f38cab584ce4e35091d47710539cbaee21883e033ecb97565ec24eb8',
 '3f04d0ab41aadd83d07dc451e12325a51422417da89316b671b2e97557b5a2f3'):
    assert sha in readme
assert 'NO UNITY' in (root/'README.md').read_text(encoding='utf-8').upper() or 'not a Unity GPU' in readme
print('Unity v58.6.0 integration preview static contract PASS (NO UNITY GPU/RUNTIME)')
