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
<meta charset="utf-8"><title>WebView2 SharedBuffer native probe</title>
</head><body><script>
(() => {
  'use strict';
  const sizes = [
    ...Array(25).fill(1024), ...Array(20).fill(65536),
    ...Array(8).fill(1048576)
  ];
  let next=0, sentAt=0;
  const records=[];
  const begin=()=> {
    if (next === sizes.length) {
      xytron.postMessage('probe.complete',{samples:records,
        js_clock:'performance.now',release_count:records.length});
      return;
    }
    const size=sizes[next];
    const id=next++;
    sentAt=performance.now();
    xytron.postMessage('probe.request',{id,size});
  };
  chrome.webview.addEventListener('sharedbufferreceived',e=>{
    let buffer;
    try {
      const metadata=e.additionalData;
      if(!metadata || metadata.type!=='xytron.shared.probe')
        throw Error('invalid shared metadata');
      const id=metadata.id, expectedSize=sizes[id];
      if(id!==records.length || metadata.size!==expectedSize)
        throw Error('unexpected shared buffer response');
      buffer=e.getBuffer();
      const bytes=new Uint8Array(buffer);
      if(bytes.byteLength!==expectedSize)
        throw Error('SharedBuffer size mismatch');
      // Validate the whole region (not just the first and last byte).
      for(let i=0;i<bytes.length;++i) {
        if(bytes[i]!==((i*37+17)&255))
          throw Error('SharedBuffer content mismatch at '+i);
      }
      const elapsed=performance.now()-sentAt;
      records.push({size:expectedSize,elapsed_ms:elapsed});
      chrome.webview.releaseBuffer(buffer);
      buffer=null;
      begin();
    } catch(error) {
      if(buffer) {
        try { chrome.webview.releaseBuffer(buffer); } catch(_) {}
      }
      xytron.postMessage('probe.failure',String(error));
    }
  });
  begin();
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
            if(decoded.eventName=="probe.request") {
                const VariantDict& payload=AnyCast<const VariantDict&>(body);
                const int requestId=AnyCast<int>(payload.at("id"));
                const int size=AnyCast<int>(payload.at("size"));
                if(requestId<0 || requestId>=53 ||
                   (size!=1024 && size!=65536 && size!=1048576))
                    throw std::runtime_error("Invalid shared buffer request");
                nativeweb::Binary bytes(static_cast<std::size_t>(size));
                for(std::size_t i=0;i<bytes.size();++i)
                    bytes[i]=static_cast<unsigned char>((i*37+17)&255);
                if(!backend_->postReadOnlySharedBufferProbe(bytes,requestId))
                    throw std::runtime_error("WebView2 SharedBuffer API unavailable");
            } else if(decoded.eventName=="probe.complete") {
                const VariantDict& payload=AnyCast<const VariantDict&>(body);
                const VariantList& samples=AnyCast<const VariantList&>(
                    payload.at("samples"));
                if(samples.size()!=53u ||
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
