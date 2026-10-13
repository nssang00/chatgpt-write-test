from pathlib import Path
root=Path(__file__).resolve().parents[1]
cpp=(root/'Native/WebView2UnityPilot.cpp').read_text('utf-8')
cs=(root/'Unity/WebView2OverlayUnityPilot.cs').read_text('utf-8')
cmake=(root/'Native/CMakeLists.txt').read_text('utf-8')
required=['WV2Pilot_Open','WV2Pilot_SetBounds','WV2Pilot_Close','WV2Pilot_NotifyParentMoved',
'WV2Pilot_SetVisible','WV2Pilot_GetPongCount','CreateCoreWebView2Controller',
'COINIT_APARTMENTTHREADED','GetWindowThreadProcessId','GetCurrentProcessId',
'WM_APP + 41','PostMessageW','std::thread','g_controller->Close()']
for name in required: assert name in cpp, name
for name in ['UNITY_STANDALONE_WIN && !UNITY_EDITOR','enablePilot = false','GetActiveWindow',
'GetClientRect','WorldToScreenPoint','WV2Pilot_SetBounds','WV2Pilot_Close',
'OnDisable','OnDestroy']:
    assert name in cs,name
assert 'WebView2LoaderStatic' in cmake and 'CMAKE_SIZEOF_VOID_P' in cmake
assert all(x not in cpp for x in ('CefPrototype_','CefTexture','IUnityGraphics'))
assert all(x not in cs for x in ('CompanyWebViewCefTextureProbe','CefPrototype_'))
print('v58.5.1 isolated Unity HWND pilot static API/ownership contract PASS')
