#import <AppKit/AppKit.h>
#include "browser/wkwebview/wkwebview_backend.hpp"
#include "nativeweb/webview.hpp"
#include "nativeweb/app_resources.hpp"

#include <atomic>
#include <chrono>
#include <iostream>
#include <memory>
#include <string>

int main()
{
    @autoreleasepool {
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];

        nativeweb::detail::registerWkWebViewBackendFactory();
        nativeweb::WebView webview;
        std::atomic<int> checkpoints(0);
        std::atomic<bool> completed(false);
        std::atomic<bool> good(false);
        webview.bind("math.add",[](int a,int b){return a+b;});
        webview.bind("test.bytes",[](){
            nativeweb::Binary out;
            out.push_back(0);out.push_back(127);out.push_back(255);
            return out;
        });
        webview.onMessage("test.ping",[&](const Any& payload){
            const VariantDict& value=AnyCast<const VariantDict&>(payload);
            const int number=AnyCast<int>(value.find("number")->second);
            if(number==42) ++checkpoints;
            webview.postMessage("test.pong",nativeweb::Binary{0,127,255});
        });
        webview.bind("test.complete",[&](bool ok) {
            good.store(ok && checkpoints.load()==1);
            completed.store(true);
            return true;
        });

        std::shared_ptr<nativeweb::AppResourceBundle> resources(
            new nativeweb::AppResourceBundle());
        const std::string html=R"HTML(<!doctype html>
<html><head><meta charset="utf-8"><title>Xytron macOS E2E</title></head>
<body><script>
(async () => {
  try {
    const count=await xytron.math.add(10,32);
    const b=await xytron.test.bytes();
    if(count!==42 || !(b instanceof ArrayBuffer) ||
       Array.from(new Uint8Array(b)).join(',')!=='0,127,255')
      throw Error('RPC or binary failed');
    const pong=new Promise((resolve,reject)=>{
      const id=xytron.onMessage('test.pong',value=>{
        xytron.offMessage(id);resolve(value);
      });
      setTimeout(()=>reject(Error('Event timeout')),6000);
    });
    xytron.postMessage('test.ping',{number:42});
    const received=await pong;
    if(!(received instanceof ArrayBuffer) ||
      Array.from(new Uint8Array(received)).join(',')!=='0,127,255')
      throw Error('native event Binary failed');
    await xytron.test.complete(true);
  } catch(error) {
    document.body.textContent=String(error);
    await xytron.test.complete(false);
  }
})();
</script></body></html>)HTML";
        resources->add("app://desktop/index.html","text/html",html);
        nativeweb::WebViewOptions options;
        options.engine=nativeweb::Engine::WkWebView;
        options.appResources=resources;
        webview.create(nullptr,"app://desktop/index.html",options);

        const auto start=std::chrono::steady_clock::now();
        while(!completed.load() && std::chrono::steady_clock::now()-start
            <std::chrono::seconds(25)) {
            [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode
                beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
        }
        const bool passed=completed.load() && good.load();
        webview.destroy();
        std::cout << "wkwebview-real-browser-e2e: "
                  << (passed?"PASS":"FAIL") << std::endl;
        return passed?0:1;
    }
}
