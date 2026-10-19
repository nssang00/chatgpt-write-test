"""Pinned source-only regression for v58.8 input capabilities, NOT a real Unity Player test."""
from pathlib import Path
from zipfile import ZipFile
import hashlib
r=Path(__file__).resolve().parents[1]
expected_archive='07e06a42f38cab584ce4e35091d47710539cbaee21883e033ecb97565ec24eb8'
expected_wv2='d5fdceca1991d4797148b0d20e4169d4b8e7f318d378da07ad23ac526efba644'
for name,expected in [('CefOneClick-v58.4.4-source.zip',expected_archive),('CompanyWebView2UnifiedPreview.dll',expected_wv2)]:
    assert hashlib.sha256((r/name).read_bytes()).hexdigest()==expected,name
source=(r/'Runtime/CefTextureInputForwarder.cs').read_text('utf-8')
panel=(r/'Runtime/UnifiedWebViewPanel.cs').read_text('utf-8')
setup=(r/'Editor/UnifiedWebViewSetupMenu.cs').read_text('utf-8')
cef=(r/'ExistingRuntime/CefTextureBackendBridge.cs').read_text('utf-8')
facade=(r/'ExistingRuntime/UnifiedWebView.cs').read_text('utf-8')
assemble=(r/'Build-UnityProduct.ps1').read_text('utf-8')
auto=(r/'Run-Auto.ps1').read_text('utf-8')
page=(r/'Demo-cef-input-demo.html').read_text('utf-8')
for sig in ('CefPrototype_InteractionSetFocus','CefPrototype_InteractionMouseMove',
            'CefPrototype_InteractionMouseClick','CefPrototype_InteractionMouseWheel',
            'CefPrototype_InteractionSendKey','CefPrototype_InteractionSendChar',
            'CefPrototype_InteractionImeSetComposition','CefPrototype_InteractionImeCommitText'):
    assert sig in source, sig
with ZipFile(r/'CefOneClick-v58.4.4-source.zip') as z:
    hdr=z.read('oneclick_bundle/Package/com.company.webview/Runtime/Backends/CEF/Native/include/CefPrototypeApi.h').decode()
    for sig in ('CefPrototype_InteractionSetFocus','CefPrototype_InteractionMouseMove',
                'CefPrototype_InteractionMouseClick','CefPrototype_InteractionMouseWheel',
                'CefPrototype_InteractionSendKey','CefPrototype_InteractionSendChar',
                'CefPrototype_InteractionImeSetComposition','CefPrototype_InteractionImeCommitText',
                'CefPrototype_GetTitleUtf8'):
        assert sig in hdr, 'Native export not present in pinned SDK header: '+sig
for sig in ('IPointerDownHandler','IPointerUpHandler','IDragHandler','IScrollHandler',
            'IPointerEnterHandler','IPointerExitHandler','RectTransformUtility.ScreenPointToLocalPointInRectangle',
            'GetMouseButtonDown(0)','OnApplicationFocus','CefPrototype_InteractionSetFocus(1)'):
    assert sig in source,sig
for sig in ('typeof(CefTextureInputForwarder)', 'typeof(EventSystem)', 'typeof(StandaloneInputModule)',
            'companywebview-demo://input','Samples~','cef-input-demo.html',
            'raw.uvRect = new Rect(0f, 1f, 1f, -1f)'):
    assert sig in setup,sig
for sig in ("'Runtime\\CefTextureInputForwarder.cs'", "'Demo-cef-input-demo.html'",'Samples~\\cef-input-demo.html'):
    assert sig in assemble,sig
for sig in ("'Runtime\\CefTextureInputForwarder.cs'", "'Demo-cef-input-demo.html'", "'Samples~\\cef-input-demo.html'"):
    assert sig in auto,sig
assert 'ResolveTextureUrl' in panel and 'streamingAssetsPath' in panel
assert 'title.StartsWith(TitlePrefix' in cef and 'Uri.UnescapeDataString' in cef
assert 'ScriptExecution = false' in cef and 'Messages = false' in cef and 'PageToUnityMessages = false' in cef
assert 'Capabilities.PageToUnityMessages = options.EnableCefPageTitleMessages' in cef
assert 'EnableCefPageTitleMessages' in panel
assert 'if(!Capabilities.Messages && !Capabilities.PageToUnityMessages) return;' in facade
assert "document.title='cwmsg:v1:'" in page
assert '<input ' in page and '<textarea ' in page
assert 'CefPrototype_ExecuteScript' not in cef
print('CEF UI input + explicitly limited title-message preview source contract PASS (no Unity Player executed)')

