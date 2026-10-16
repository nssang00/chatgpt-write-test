#include "browser/webview2/webview2_backend.hpp"
#include "core/bridge_message.hpp"
#include "core/json_codec.hpp"
#include "nativeweb/app_resources.hpp"

#include <windows.h>

#include <chrono>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
const char kEntry[]="app://desktop/sharedbuffer_probe.html";

const char kHtml[]=R"XYTRON_HTML(<!doctype html><html><head>
<meta charset="utf-8"><title>WebView2 Base64 vs SharedBuffer</title>
</head><body><script>
(() => {
  'use strict';
  // Two paths have the same JS->Native control event and the same byte
  // pattern. Alternate their order to reduce first/second mover effects.
  const work=[];
  for(const [bytes,count] of [[1024,25],[65536,20],[1048576,8]]) {
    for(let i=0;i<count;++i) {
      if(i%2) work.push({transport:'shared',size:bytes},
                       {transport:'base64',size:bytes});
      else work.push({transport:'base64',size:bytes},
                     {transport:'shared',size:bytes});
    }
  }
  let current=null, nextIndex=0, startedAt=0, releases=0;
  const records=[];
  const fail=(error)=>xytron.postMessage('probe.failure',String(error));
  const checkBytes=(bytes)=>{
    if(bytes.byteLength!==current.size) throw Error('Buffer length mismatch');
    for(let i=0;i<bytes.length;++i)
      if(bytes[i]!==((i*37+17)&255))
        throw Error('Buffer byte mismatch '+i);
  };
  const request=()=>{
    if(nextIndex===work.length) {
      xytron.postMessage('probe.complete',{samples:records,
        js_clock:'performance.now',release_count:releases});
      return;
    }
    current=work[nextIndex];
    const id=nextIndex++;
    startedAt=performance.now();
    xytron.postMessage(current.transport==='shared' ?
      'probe.shared.request' : 'probe.base64.request',{id,size:current.size});
  };
  const received=(transport, buffer)=>{
    if(!current||current.transport!==transport)
      throw Error('Unexpected probe path '+transport);
    // Capture RTT *before* validating the bytes. The same control event and
    // full-content validation are used for both paths, but excluded from RTT.
    const elapsed=performance.now()-startedAt;
    checkBytes(new Uint8Array(buffer));
    records.push({transport,size:current.size,elapsed_ms:elapsed});
  };
  xytron.onMessage('probe.base64.payload',value=>{
    try {
      if(!(value instanceof ArrayBuffer)) throw Error('Expected ArrayBuffer');
      received('base64',value);
      request();
    } catch(e) { fail(e); }
  });
  chrome.webview.addEventListener('sharedbufferreceived',e=>{
    let buffer;
    try {
      const meta=e.additionalData;
      if(!meta||meta.type!=='xytron.shared.probe' ||
         !current||current.transport!=='shared'||
         meta.id!==nextIndex-1||meta.size!==current.size)
        throw Error('Invalid shared buffer metadata');
      buffer=e.getBuffer();
      received('shared',buffer);
      chrome.webview.releaseBuffer(buffer);
      buffer=null;
      releases++;
      request();
    } catch(e) {
      if(buffer) { try { chrome.webview.releaseBuffer(buffer); } catch(_) {} }
      fail(e);
    }
  });
  request();
})();
</script></body></html>)XYTRON_HTML";

class ProbeListener final : public nativeweb::detail::BrowserBackendListener
{
public:
    explicit ProbeListener(nativeweb::detail::WebView2Backend* backend)
        : backend_(backend),done_(false),passed_(false) {}

    bool done() const { return done_; }
    bool passed() const { return passed_; }
    void onBrowserCreated() override {}
    void onLoadStarted(const std::string&) override {}
    void onLoadFinished(const std::string&) override {}
    void onBrowserClosed() override {}
    void onBridgeMessage(const Any&) override
    {
        fail("Unverified renderer bridge message");
    }
    void onVerifiedBridgeMessage(
        const Any& message,
        const nativeweb::detail::VerifiedFrameContext& frame) override
    {
        if(!frame.mainFrame || !frame.trustedContent ||
           !frame.engineVerified || frame.navigation==0) {
            fail("Untrusted frame provenance");
            return;
        }
        try {
            const nativeweb::detail::BridgeMessage decoded=
                nativeweb::detail::parseBridgeMessage(message);
            if(decoded.type!=nativeweb::detail::BridgeMessageType::Event)
                return;
            const VariantDict& envelope=AnyCast<const VariantDict&>(message);
            const Any& body=envelope.at("payload");
            if(decoded.eventName=="probe.shared.request" ||
               decoded.eventName=="probe.base64.request") {
                const VariantDict& payload=AnyCast<const VariantDict&>(body);
                const int requestId=AnyCast<int>(payload.at("id"));
                const int size=AnyCast<int>(payload.at("size"));
                if(requestId<0 || requestId>=106 ||
                   (size!=1024 && size!=65536 && size!=1048576))
                    throw std::runtime_error("Invalid shared buffer request");
                nativeweb::Binary bytes(static_cast<std::size_t>(size));
                for(std::size_t i=0;i<bytes.size();++i)
                    bytes[i]=static_cast<unsigned char>((i*37+17)&255);
                if(decoded.eventName=="probe.shared.request") {
                    if(!backend_->postReadOnlySharedBufferProbe(bytes,requestId))
                        throw std::runtime_error("WebView2 SharedBuffer API unavailable");
                } else {
                    backend_->postBridgeMessage(
                        nativeweb::detail::makeEventMessage(
                            "probe.base64.payload",Any(bytes)));
                }
            } else if(decoded.eventName=="probe.complete") {
                const VariantDict& payload=AnyCast<const VariantDict&>(body);
                const VariantList& samples=AnyCast<const VariantList&>(
                    payload.at("samples"));
                if(samples.size()!=106u ||
                   AnyCast<int>(payload.at("release_count"))!=53)
                    throw std::runtime_error("Incomplete shared buffer run");
                std::cout << "xytron-sharedbuffer-probe-json:"
                          << nativeweb::detail::anyToJson(body)
                          << std::endl;
                done_=true;passed_=true;
            } else if(decoded.eventName=="probe.failure") {
                fail(AnyCast<std::string>(body));
            } else {
                fail("Unknown probe event");
            }
        } catch(const std::exception& e) {
            fail(e.what());
        }
    }
private:
    void fail(const std::string& why)
    {
        std::cerr << "SharedBuffer probe failure: " << why << std::endl;
        passed_=false;done_=true;
    }
    nativeweb::detail::WebView2Backend* backend_;
    bool done_,passed_;
};

LRESULT CALLBACK windowProc(HWND hwnd,UINT msg,WPARAM wp,LPARAM lp)
{
    return DefWindowProcW(hwnd,msg,wp,lp);
}
} // namespace

int main()
{
    const wchar_t* name=L"Xytron.SharedBuffer.Probe";
    WNDCLASSW cls={};
    cls.lpfnWndProc=&windowProc;
    cls.hInstance=GetModuleHandleW(nullptr);
    cls.lpszClassName=name;
    if(!RegisterClassW(&cls) && GetLastError()!=ERROR_CLASS_ALREADY_EXISTS)
        return 2;
    HWND window=CreateWindowExW(0,name,L"WebView2 SharedBuffer E2E",
        WS_OVERLAPPEDWINDOW,CW_USEDEFAULT,CW_USEDEFAULT,
        800,600,nullptr,nullptr,cls.hInstance,nullptr);
    if(!window) return 3;

    int result=1;
    nativeweb::detail::WebView2Backend backend;
    ProbeListener listener(&backend);
    backend.setListener(&listener);
    try {
        std::shared_ptr<nativeweb::AppResourceBundle> assets(
            new nativeweb::AppResourceBundle());
        assets->add(kEntry,"text/html",kHtml);
        nativeweb::detail::BrowserCreateParams params;
        params.parent=reinterpret_cast<nativeweb::NativeWindowHandle>(window);
        params.source=kEntry;
        params.appResources=assets;
        backend.create(params);
        const auto started=std::chrono::steady_clock::now();
        MSG message;
        while(!listener.done() &&
              std::chrono::steady_clock::now()-started<
                std::chrono::seconds(80)) {
            while(PeekMessageW(&message,nullptr,0,0,PM_REMOVE)) {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            Sleep(5);
        }
        result=listener.done() && listener.passed()?0:1;
    } catch(const std::exception& e) {
        std::cerr << "SharedBuffer probe exception: "<<e.what()<<std::endl;
    }
    backend.destroy();
    DestroyWindow(window);
    std::cout<<"webview2-sharedbuffer-real-e2e: "
             <<(result==0?"PASS":"FAIL")<<std::endl;
    return result;
}
