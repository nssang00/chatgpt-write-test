// v58.5.2 r3 isolated experimental Unity HWND bridge: single-view only, Windows x64.
// Do not ship: cross-thread HWND parenting and Unity focus/IME require real Stage2 verification.
#include <windows.h>
#include <wrl.h>
#include <WebView2.h>
#include <atomic>
#include <mutex>
#include <thread>
#include <map>
#include <string>
#include "EchoProtocol.h"
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
std::atomic<int> g_fixtureEchoAcks{0};
std::atomic<int> g_manualEchoAcks{0};
std::atomic<int> g_echoRejected{0};
std::map<std::wstring,std::wstring> g_pendingEcho; // STA thread only; never logged or persisted
std::atomic<int> g_shutdownPhase{0}; // 0 live, 1 requested, 2 WM_CLOSE, 3 cleaning, 4 COM closed, 5 STA ending, 6 worker ended, 7 joined
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
    g_shutdownPhase.store(3);
    g_pendingEcho.clear();
    if(g_webview && g_hasMessageHandler) {
        g_webview->remove_WebMessageReceived(g_webMessageToken);
        g_hasMessageHandler=false;
    }
    g_webview.Reset();
    if(g_controller) {
        g_controller->Close();
        g_controller.Reset();
    }
    g_shutdownPhase.store(4);
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
                const std::wstring message(value); // WebView2 gives UTF-16, not UTF-8
                if(message==L"probe-ping") {
                    g_webview->PostWebMessageAsString(L"probe-pong");
                    g_pongs.fetch_add(1);
                } else if(message==L"probe-ack") {
                    g_acks.fetch_add(1);
                } else {
                    wv2echo::Frame frame;
                    if(wv2echo::Parse(message,wv2echo::kRequest,frame)) {
                        const auto key=wv2echo::Key(frame);
                        // auto must be the pinned Korean+emoji Unicode fixture.
                        if((frame.mode==L"auto" && !wv2echo::IsFixture(frame)) ||
                           g_pendingEcho.size()>=16 || g_pendingEcho.count(key)!=0) {
                            g_echoRejected.fetch_add(1);
                        } else {
                            g_pendingEcho.emplace(key,frame.payload);
                            const auto reply=wv2echo::Make(wv2echo::kResponse,frame);
                            if(FAILED(g_webview->PostWebMessageAsString(reply.c_str()))) {
                                g_pendingEcho.erase(key);
                                g_echoRejected.fetch_add(1);
                            }
                        }
                    } else if(wv2echo::Parse(message,wv2echo::kAck,frame)) {
                        const auto key=wv2echo::Key(frame);
                        auto it=g_pendingEcho.find(key);
                        if(it!=g_pendingEcho.end() && it->second==frame.payload) {
                            if(frame.mode==L"auto" && wv2echo::IsFixture(frame))
                                g_fixtureEchoAcks.fetch_add(1);
                            else if(frame.mode==L"manual")
                                g_manualEchoAcks.fetch_add(1);
                            g_pendingEcho.erase(it);
                        } else {
                            g_echoRejected.fetch_add(1);
                        }
                    }
                }
                CoTaskMemFree(value);
            }
            return S_OK;
          }).Get(), &g_webMessageToken);
    if(FAILED(hr)) { Fail(-27); return S_OK; }
    g_hasMessageHandler=true;
    static const wchar_t html[]=LR"HTML(<!doctype html><html lang="ko"><meta charset="utf-8">
<style>
body{margin:20px;font:16px "Segoe UI",sans-serif;background:#f7f9fc;color:#202937}
input{width:min(92%,700px);font-size:19px;padding:10px;border:1px solid #8996a8;border-radius:6px}
button{margin:10px 8px 6px 0;padding:10px 14px;cursor:pointer}
.result{white-space:pre-wrap;overflow-wrap:anywhere;background:#fff;padding:12px;border-radius:6px}
.small{font-size:13px;color:#535d6b}
</style>
<h2>WebView2 v58.5.2 r5 — 한글 Native Echo</h2>
<p>입력 문자열 전체가 C++ Native를 왕복하며 그대로 유지되는지 확인하세요.</p>
<label for="ime">한글 / Emoji / 줄바꿈 검사 (입력한 그대로 Echo)</label>
<p><input id="ime" aria-label="Korean IME and Native Echo" value="안녕하세요 WebView2 한글 😀"
placeholder="한글과 이모지를 입력하세요" maxlength="4096"></p>
<button id="echo">Send to Native Echo</button>
<button id="ping">Native ping (고정 응답 확인)</button>
<p id="autoResult" class="small">자동 Unicode 왕복 검사 대기...</p>
<p id="echoResult" class="result" aria-live="polite">Echo 버튼을 누르면 입력한 한글이 여기에 나타납니다.</p>
<p id="pingResult" class="small">Ping: 대기 중</p>
<p class="small">Native Echo: 원문 일치 비교 · Native ping: 고정 probe-pong 응답 · IME 후보창과 커서 위치는 별도 수동 확인</p>
<script>
const web=chrome.webview;
const pending=new Map();
const fixture='안녕하세요 WebView2 한글 😀';
let nextId=1;
const input=document.getElementById('ime');
const display=document.getElementById('echoResult');
function sendEcho(kind,value){
  if(!value.length){display.textContent='빈 문자열은 전송하지 않습니다.';return;}
  const id=(kind==='auto')?'0':String(nextId++);
  pending.set(kind+'|'+id,value);
  web.postMessage('echo-v1|'+kind+'|'+id+'|'+value);
}
function receiveEcho(data){
  const head='echo-return-v1|';
  if(!data.startsWith(head)) return false;
  const rem=data.substring(head.length);
  const a=rem.indexOf('|');
  const b=rem.indexOf('|',a+1);
  if(a<1 || b<a+2) return true;
  const kind=rem.substring(0,a);
  const id=rem.substring(a+1,b);
  const value=rem.substring(b+1);
  const key=kind+'|'+id;
  const original=pending.get(key);
  if(original===undefined) return true;
  pending.delete(key);
  const same=(original===value);
  if(kind==='auto'){
    document.getElementById('autoResult').textContent=same?
      '자동 한글+Emoji UTF-16 Echo: PASS (C++ 왕복 원문 일치)':
      '자동 한글+Emoji UTF-16 Echo: FAIL (원문 불일치)';
  }else{
    display.textContent='Native Echo: '+value+'\n원문과 '+(same?'정확히 일치 ✅':'불일치 ❌');
  }
  if(same)web.postMessage('echo-ack-v1|'+kind+'|'+id+'|'+value);
  return true;
}
document.getElementById('echo').onclick=()=>sendEcho('manual',input.value);
document.getElementById('ping').onclick=()=>web.postMessage('probe-ping');
web.addEventListener('message',event=>{
  const data=event.data;
  if(typeof data!=='string')return;
  if(receiveEcho(data))return;
  if(data==='probe-pong'){
    document.getElementById('pingResult').textContent='Ping: Native replied probe-pong';
    web.postMessage('probe-ack');
  }
});
setTimeout(()=>{
  web.postMessage('probe-ping');
  sendEcho('auto',fixture);
},350);
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
        g_shutdownPhase.store(2);
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
    g_shutdownPhase.store(5);
    g_host.store(nullptr);
    g_threadId.store(0);
    CoUninitialize();
    if(g_status.load()>0) g_status.store(0);
    g_shutdownPhase.store(6);
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
    g_error.store(0); g_pongs.store(0); g_acks.store(0); g_fixtureEchoAcks.store(0); g_manualEchoAcks.store(0); g_echoRejected.store(0); g_shutdownPhase.store(0); g_stop.store(false); g_visible.store(true);
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
__declspec(dllexport) int __cdecl WV2Pilot_GetFixtureEchoAckCount() { return g_fixtureEchoAcks.load(); }
__declspec(dllexport) int __cdecl WV2Pilot_GetManualEchoAckCount() { return g_manualEchoAcks.load(); }
__declspec(dllexport) int __cdecl WV2Pilot_GetEchoRejectedCount() { return g_echoRejected.load(); }
__declspec(dllexport) int __cdecl WV2Pilot_GetShutdownPhase() {
    return g_shutdownPhase.load();
}
// Request an asynchronous shutdown while the Unity Player UI is still running.
__declspec(dllexport) int __cdecl WV2Pilot_RequestClose() {
    if(!g_thread.joinable()) return 0;
    if(g_stop.exchange(true)) return 0; // one shutdown request only
    g_shutdownPhase.store(1);
    if(g_status.load()>0) g_status.store(3);
    HWND host=g_host.load();
    if(host && IsWindow(host)) {
        if(PostMessageW(host,WM_CLOSE,0,0)) return 0;
    }
    DWORD tid=g_threadId.load();
    if(tid && PostThreadMessageW(tid,WM_QUIT,0,0)) return 0;
    // If thread startup is still pending, Worker checks g_stop after CreateWindowEx.
    return tid == 0 ? 0 : -32;
}
__declspec(dllexport) int __cdecl WV2Pilot_Close(unsigned timeoutMs) {
    if(!g_thread.joinable()) { g_status.store(0); return 0; }
    int request=WV2Pilot_RequestClose();
    if(request!=0 && request!=-32) return request;
    DWORD wait=WaitForSingleObject(g_thread.native_handle(), timeoutMs);
    if(wait==WAIT_TIMEOUT) return -30;
    if(wait!=WAIT_OBJECT_0) return -31; // WAIT_FAILED; preserve worker handle
    g_thread.join();
    g_status.store(0);
    g_parent=nullptr;
    g_shutdownPhase.store(7);
    return 0;
}
}
