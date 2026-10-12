from pathlib import Path
r=Path(__file__).resolve().parents[1]
s=(r/'Native'/'OverlayProbe.cpp').read_text()
c=(r/'Native'/'CMakeLists.txt').read_text()
for token in ['COINIT_APARTMENTTHREADED','CreateCoreWebView2Controller','GetMessageW','put_Bounds','NotifyParentWindowPositionChanged','WM_DPICHANGED','MoveFocus(','NavigateToString','add_WebMessageReceived','PostWebMessageAsString','CloseWebView();','g_controller->Close();']:
 assert token in s,token
assert 'WebView2LoaderStatic' in c and 'CMAKE_SIZEOF_VOID_P' in c
assert all(x not in s for x in ['CefPrototype_','UnityEngine','IUnityGraphics'])
print('v58.5.0 isolated prototype static contract PASS')
