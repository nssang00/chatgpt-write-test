// v58.5.2 isolated experimental Unity HWND bridge: single-view only, Windows x64.
// Do not ship: cross-thread HWND parenting and Unity focus/IME require real Stage2 verification.
#include <windows.h>
#include <wrl.h>
#include <WebView2.h>
#include <atomic>
#include <mutex>
#include <thread>
using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace {
constexpr UINT kUpdate = WM_APP + 41;
constexpr UINT kParentMoved = WM_APP + 42;
constexpr UINT kVisibility = WM_APP + 43;
constexpr wchar_t kClass[] = L"CompanyWV2UnityPilotHost";
struct RectValue { int x=0, y=0, width=400, height=300; };
std::thread g_thread;
std::mutex g_lock;
RectValue g_rect;
HWND g_parent=nullptr;
std::atomic<HWND> g_host{nullptr};
std::atomic<DWORD> g_threadId{0};
std::atomic<int> g_status{0}; // 0 idle, 1 starting, 2 ready, 3 closing, <0 failure
std::atomic<int> g_error{0};
std::atomic<int> g_pongs{0};
std::atomic<int> g_acks{0};
std::atomic<bool> g_stop{false};
std::atomic<bool> g_visible{true};
// The following COM objects are ONLY accessed on the dedicated STA thread.
ComPtr<ICoreWebView2Controller> g_controller;
ComPtr<ICoreWebView2> g_webview;
EventRegistrationToken g_webMessageToken{};
bool g_hasMessageHandler=false;
void Fail(int code) {
    g_error.store(code);
    g_status.store(code);
    HWND host=g_host.load();
    if(host && IsWindow(host)) PostMessageW(host, WM_CLOSE, 0, 0);
}
void CleanupOnSta() {
    if(g_webview && g_hasMessageHandler) {
        g_webview->remove_WebMessageReceived(g_webMessageToken);
        g_hasMessageHandler=false;
    }
    g_webview.Reset();
    if(g_controller) {
        g_controller->Close();
        g_controller.Reset();
    }
}
void ResizeWebView() {
    if(!g_controller) return;
    HWND host=g_host.load();
    if(!host || !IsWindow(host)) return;
    RECT bounds{};
    GetClientRect(host, &bounds);
    if(bounds.right > 0 && bounds.bottom > 0) g_controller->put_Bounds(bounds);
}
HRESULT OnController(HRESULT result, ICoreWebView2Controller* controller) {
    if(g_stop.load() || !IsWindow(g_host.load())) {
        if(controller) controller->Close();
        return S_OK;
    }
    if(FAILED(result) || !controller) { Fail(-25); return S_OK; }
    g_controller=controller;
    HRESULT hr=g_controller->get_CoreWebView2(&g_webview);
    if(FAILED(hr) || !g_webview) { Fail(-26); return S_OK; }
    ResizeWebView();
    g_controller->put_IsVisible(g_visible.load() ? TRUE : FALSE);
    hr=g_webview->add_WebMessageReceived(
        Callback<ICoreWebView2WebMessageReceivedEventHandler>(
          [](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args)->HRESULT {
            if(!args || !g_webview || g_stop.load()) return S_OK;
            LPWSTR value=nullptr;
            if(SUCCEEDED(args->TryGetWebMessageAsString(&value)) && value) {
                if(wcscmp(value, L"probe-ping") == 0) {
                    g_webview->PostWebMessageAsString(L"probe-pong");
                    g_pongs.fetch_add(1);
                } else if(wcscmp(value, L"probe-ack") == 0) {
                    g_acks.fetch_add(1);
                }
                CoTaskMemFree(value);
            }
            return S_OK;
          }).Get(), &g_webMessageToken);
    if(FAILED(hr)) { Fail(-27); return S_OK; }
    g_hasMessageHandler=true;
    static const wchar_t html[]=LR"HTML(<!doctype html><html lang="en"><meta charset="utf-8">
<style>body{margin:18px;font:16px Segoe UI;background:#f7f9fc;color:#222}</style>
<h2>Unity HWND - WebView2 v58.5.2 OneClick</h2>
<p>Type Korean IME, resize Unity window, click ping, close Play Mode.</p>
<input id="ime" aria-label="IME test" placeholder="한글 입력 확인">
<button id="ping">Native ping</button><p id="result">Waiting...</p>
<script>
const web=chrome.webview;
document.getElementById('ping').onclick=()=>web.postMessage('probe-ping');
web.addEventListener('message',e=>{
  document.getElementById('result').textContent='Native replied: '+e.data;
  if(e.data==='probe-pong') web.postMessage('probe-ack');
});
setTimeout(()=>web.postMessage('probe-ping'),300);
</script></html>)HTML";
    hr=g_webview->NavigateToString(html);
    if(FAILED(hr)) { Fail(-28); return S_OK; }
    g_status.store(2);
    return S_OK;
}
HRESULT OnEnvironment(HRESULT result, ICoreWebView2Environment* environment) {
    if(g_stop.load() || !IsWindow(g_host.load())) return S_OK;
    if(FAILED(result) || !environment) { Fail(-24); return S_OK; }
    HRESULT hr=environment->CreateCoreWebView2Controller(
        g_host.load(),
        Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(OnController).Get());
    if(FAILED(hr)) Fail(-25);
    return S_OK;
}
LRESULT CALLBACK HostProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch(msg) {
      case WM_SIZE: ResizeWebView(); return 0;
      case WM_MOVE:
        if(g_controller) g_controller->NotifyParentWindowPositionChanged();
        return 0;
      case kParentMoved:
        if(g_controller) g_controller->NotifyParentWindowPositionChanged();
        return 0;
      case kUpdate: {
        RectValue rect;
        { std::lock_guard<std::mutex> lock(g_lock); rect=g_rect; }
        SetWindowPos(hwnd, nullptr, rect.x, rect.y, rect.width, rect.height,
            SWP_NOZORDER | SWP_NOACTIVATE);
        ResizeWebView();
        return 0;
      }
      case kVisibility:
        ShowWindow(hwnd, g_visible.load() ? SW_SHOWNOACTIVATE : SW_HIDE);
        if(g_controller) g_controller->put_IsVisible(g_visible.load() ? TRUE : FALSE);
        return 0;
      case WM_CLOSE:
        DestroyWindow(hwnd); return 0;
      case WM_DESTROY:
        CleanupOnSta();
        g_host.store(nullptr);
        PostQuitMessage(0);
        return 0;
      default: break;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}
void Worker() {
    g_threadId.store(GetCurrentThreadId());
    HRESULT hr=CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if(FAILED(hr)) { g_error.store(-21); g_status.store(-21); g_threadId.store(0); return; }
    WNDCLASSEXW wc{};
    wc.cbSize=sizeof(wc);
    wc.lpfnWndProc=HostProc;
    wc.hInstance=GetModuleHandleW(nullptr);
    wc.lpszClassName=kClass;
    wc.hCursor=LoadCursorW(nullptr, IDC_ARROW);
    if(!RegisterClassExW(&wc) && GetLastError()!=ERROR_CLASS_ALREADY_EXISTS) {
        g_error.store(-22); g_status.store(-22); CoUninitialize(); g_threadId.store(0); return;
    }
    RectValue rect;
    { std::lock_guard<std::mutex> lock(g_lock); rect=g_rect; }
    HWND host=CreateWindowExW(0, kClass, L"Company WV2 Pilot", WS_CHILD|WS_VISIBLE|WS_CLIPSIBLINGS,
       rect.x, rect.y, rect.width, rect.height, g_parent, nullptr, wc.hInstance, nullptr);
    if(!host) {
        g_error.store(-23); g_status.store(-23); CoUninitialize(); g_threadId.store(0); return;
    }
    g_host.store(host);
    if(g_stop.load()) {
        DestroyWindow(host);
    } else {
        hr=CreateCoreWebView2EnvironmentWithOptions(nullptr, nullptr, nullptr,
            Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(OnEnvironment).Get());
        if(FAILED(hr)) Fail(-24);
    }
    MSG msg{};
    while(GetMessageW(&msg,nullptr,0,0)>0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    // The parent may destroy the child on its own, so always perform cleanup on STA.
    CleanupOnSta();
    g_host.store(nullptr);
    g_threadId.store(0);
    CoUninitialize();
    if(g_status.load()>0) g_status.store(0);
}
}
extern "C" {
__declspec(dllexport) int __cdecl WV2Pilot_Open(void* parentHandle,int x,int y,int width,int height) {
    HWND parent=static_cast<HWND>(parentHandle);
    if(!parent || !IsWindow(parent) || width<=0 || height<=0) return -10;
    DWORD pid=0;
    GetWindowThreadProcessId(parent,&pid);
    if(pid!=GetCurrentProcessId()) return -11; // never parent under a foreign process HWND
    if(g_thread.joinable() || g_status.load()!=0) return -12; // singleton, not product multi-view
    g_parent=parent;
    { std::lock_guard<std::mutex> lock(g_lock); g_rect={x,y,width,height}; }
    g_error.store(0); g_pongs.store(0); g_acks.store(0); g_stop.store(false); g_visible.store(true);
    g_status.store(1);
    try { g_thread=std::thread(Worker); }
    catch(...) { g_status.store(0); g_error.store(-13); return -13; }
    return 0;
}
__declspec(dllexport) int __cdecl WV2Pilot_SetBounds(int x,int y,int width,int height) {
    if(width<=0 || height<=0) return -10;
    if(!g_thread.joinable()) return -12;
    { std::lock_guard<std::mutex> lock(g_lock); g_rect={x,y,width,height}; }
    HWND host=g_host.load();
    if(host && IsWindow(host)) PostMessageW(host,kUpdate,0,0);
    return 0;
}
__declspec(dllexport) int __cdecl WV2Pilot_SetVisible(int visible) {
    if(!g_thread.joinable()) return -12;
    g_visible.store(visible!=0);
    HWND host=g_host.load();
    if(host && IsWindow(host)) PostMessageW(host,kVisibility,0,0);
    return 0;
}
__declspec(dllexport) int __cdecl WV2Pilot_NotifyParentMoved() {
    HWND host=g_host.load();
    return host && PostMessageW(host,kParentMoved,0,0) ? 0 : -12;
}
__declspec(dllexport) int __cdecl WV2Pilot_GetState() { return g_status.load(); }
__declspec(dllexport) int __cdecl WV2Pilot_GetLastError() { return g_error.load(); }
__declspec(dllexport) int __cdecl WV2Pilot_GetPongCount() { return g_pongs.load(); }
__declspec(dllexport) int __cdecl WV2Pilot_GetAckCount() { return g_acks.load(); }
__declspec(dllexport) int __cdecl WV2Pilot_Close(unsigned timeoutMs) {
    if(!g_thread.joinable()) { g_status.store(0); return 0; }
    g_stop.store(true);
    HWND host=g_host.load();
    if(host && IsWindow(host)) PostMessageW(host,WM_CLOSE,0,0);
    else {
        DWORD tid=g_threadId.load();
        if(tid) PostThreadMessageW(tid,WM_QUIT,0,0);
    }
    DWORD wait=WaitForSingleObject(g_thread.native_handle(), timeoutMs);
    if(wait!=WAIT_OBJECT_0) return -30; // keep thread handle; do not detach or unload DLL
    g_thread.join();
    g_status.store(0);
    g_parent=nullptr;
    return 0;
}
}
