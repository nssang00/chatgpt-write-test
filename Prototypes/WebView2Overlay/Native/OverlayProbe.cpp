#include <windows.h>
#include <wrl.h>
#include <WebView2.h>
using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;
namespace {
HWND g_window=nullptr;
ComPtr<ICoreWebView2Controller> g_controller;
ComPtr<ICoreWebView2> g_webview;
EventRegistrationToken g_token{};
bool g_subscribed=false,g_closing=false;
void Bounds(){if(!g_controller||!IsWindow(g_window))return;RECT r{};GetClientRect(g_window,&r);if(r.right>r.left&&r.bottom>r.top)g_controller->put_Bounds(r);}
void CloseWebView(){g_closing=true;if(g_webview&&g_subscribed){g_webview->remove_WebMessageReceived(g_token);g_subscribed=false;}g_webview.Reset();if(g_controller){g_controller->Close();g_controller.Reset();}}
HRESULT ControllerReady(HRESULT hr,ICoreWebView2Controller* controller){
 if(g_closing||!IsWindow(g_window)){if(controller)controller->Close();return S_OK;}
 if(FAILED(hr)||!controller){OutputDebugStringW(L"WebView2 controller creation failed");return S_OK;}
 g_controller=controller;
 hr=g_controller->get_CoreWebView2(&g_webview);
 if(FAILED(hr)||!g_webview)return S_OK;
 Bounds();
 hr=g_webview->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>(
 [](ICoreWebView2*,ICoreWebView2WebMessageReceivedEventArgs* args)->HRESULT{
 if(!args||g_closing||!g_webview)return S_OK;
 LPWSTR s=nullptr;
 if(SUCCEEDED(args->TryGetWebMessageAsString(&s))&&s){
 if(wcscmp(s,L"probe-ping")==0)g_webview->PostWebMessageAsString(L"probe-pong");
 CoTaskMemFree(s);
 }return S_OK;
 }).Get(),&g_token);
 g_subscribed=SUCCEEDED(hr);
 static const wchar_t html[]=LR"HTML(<!doctype html><html lang="en"><meta charset="utf-8">
 <h1>WebView2 Overlay v58.5.0</h1><p>Resize / move the window; type Korean IME.</p>
 <input aria-label="IME input"><button id="b">Ping</button><p id="r">Waiting</p>
 <script>document.getElementById('b').onclick=()=>chrome.webview.postMessage('probe-ping');
 chrome.webview.addEventListener('message',e=>document.getElementById('r').textContent=e.data);</script></html>)HTML";
 g_webview->NavigateToString(html);return S_OK;
}
HRESULT EnvironmentReady(HRESULT hr,ICoreWebView2Environment* env){
 if(g_closing||!IsWindow(g_window))return S_OK;
 if(FAILED(hr)||!env)return S_OK;
 return env->CreateCoreWebView2Controller(g_window,Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(ControllerReady).Get());
}
LRESULT CALLBACK WndProc(HWND hwnd,UINT msg,WPARAM w,LPARAM l){
 switch(msg){
 case WM_SIZE:Bounds();return 0;
 case WM_MOVE:case WM_MOVING:if(g_controller)g_controller->NotifyParentWindowPositionChanged();break;
 case WM_DPICHANGED:if(l){auto r=reinterpret_cast<RECT*>(l);SetWindowPos(hwnd,nullptr,r->left,r->top,r->right-r->left,r->bottom-r->top,SWP_NOZORDER|SWP_NOACTIVATE);}Bounds();return 0;
 case WM_SETFOCUS:if(g_controller)g_controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);return 0;
 case WM_CLOSE:DestroyWindow(hwnd);return 0;
 case WM_DESTROY:CloseWebView();g_window=nullptr;PostQuitMessage(0);return 0;
 default:break;
 }return DefWindowProcW(hwnd,msg,w,l);
}
}
int WINAPI wWinMain(HINSTANCE h,HINSTANCE,PWSTR,int show){
 HRESULT hr=CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);if(FAILED(hr))return 10;
 SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
 WNDCLASSEXW wc{};wc.cbSize=sizeof(wc);wc.lpfnWndProc=WndProc;wc.hInstance=h;wc.lpszClassName=L"CompanyWebView2Overlay";
 wc.hCursor=LoadCursorW(nullptr,IDC_ARROW);if(!RegisterClassExW(&wc)){CoUninitialize();return 11;}
 g_window=CreateWindowExW(0,wc.lpszClassName,L"Company WebView2 Overlay v58.5.0",WS_OVERLAPPEDWINDOW,CW_USEDEFAULT,CW_USEDEFAULT,1024,720,nullptr,nullptr,h,nullptr);
 if(!g_window){CoUninitialize();return 12;}ShowWindow(g_window,show);UpdateWindow(g_window);
 hr=CreateCoreWebView2EnvironmentWithOptions(nullptr,nullptr,nullptr,Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(EnvironmentReady).Get());
 if(FAILED(hr)){DestroyWindow(g_window);CoUninitialize();return 13;}
 MSG msg{};while(GetMessageW(&msg,nullptr,0,0)>0){TranslateMessage(&msg);DispatchMessageW(&msg);}
 CloseWebView();CoUninitialize();return static_cast<int>(msg.wParam);
}
