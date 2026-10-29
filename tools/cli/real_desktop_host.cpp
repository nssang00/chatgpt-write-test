// Minimal real-engine app:// desktop host for an explicitly trusted generated UI.
// This proves UI -> Native C++ bridge, NOT arbitrary user backend binding,
// native menus, plugin callbacks or redistributable desktop packaging.
#include "nativeweb/webview.hpp"
#include "nativeweb/app_resources.hpp"
#include <fstream>
#include <iostream>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#ifdef XYTRON_APP_HOST_CEF
#include "browser/cef/cef_backend.hpp"
#include "browser/cef/cef_renderer_app.hpp"
#include "include/cef_app.h"
#ifdef _WIN32
#include <windows.h>
#endif
#else
#include "browser/webview2/webview2_backend.hpp"
#include <windows.h>
#endif

namespace {
bool smoke = false;
std::string problem;
bool verified = false;

std::string flag(int argc, char** argv, const std::string& prefix) {
  for (int i=1;i<argc;++i) {
    const std::string arg(argv[i]);
    if (arg.compare(0,prefix.size(),prefix)==0)
      return arg.substr(prefix.size());
  }
  return "";
}

std::shared_ptr<nativeweb::AppResourceBundle>
loadUi(const std::string& name) {
  if (name.empty()) throw std::runtime_error("Explicit --ui path is required");
  std::ifstream in(name.c_str(),std::ios::binary);
  if (!in) throw std::runtime_error("UI index not found");
  std::ostringstream bytes;
  char part[4096];
  std::size_t length=0;
  while (in.read(part,sizeof(part)) || in.gcount()) {
    const std::size_t count=static_cast<std::size_t>(in.gcount());
    length+=count;
    if (length>1024*1024) throw std::runtime_error("UI index exceeds 1 MiB");
    bytes.write(part,static_cast<std::streamsize>(count));
  }
  if (in.bad() || length==0) throw std::runtime_error("Invalid UI index");
  std::string html=bytes.str();
  if (html.find('\0')!=std::string::npos)
    throw std::runtime_error("UI HTML contains invalid NUL");
  if (smoke) {
    // Exercise real engine JS->native Promise. This probe does NOT claim
    // that the scaffold placeholder is the user's C++ backend.
    html+=R"HTML(
<script>
(async function () {
  try {
    const button=document.getElementById("xytron-ping");
    const output=document.getElementById("xytron-result");
    if (!button || !output) throw new Error("Generated UI button missing");
    button.click();
    for (let attempt=0; attempt<100 && output.textContent!=="pong"; ++attempt)
      await new Promise(resolve=>setTimeout(resolve,50));
    if (output.textContent!=="pong")
      throw new Error("Generated button did not receive native pong: "+
                      String(output.textContent));
    await xytron.app.complete();
  } catch (error) {
    await xytron.app.fail(String(error));
  }
})();
</script>
)HTML";
  }
  std::shared_ptr<nativeweb::AppResourceBundle> bundle(
    new nativeweb::AppResourceBundle());
  bundle->add("app://desktop/index.html","text/html",html);
  return bundle;
}

class Listener : public nativeweb::WebViewListener {
public:
  explicit Listener(nativeweb::WebView& webview) : webview_(webview) {
    webview_.bind("app.ping",[]() { return std::string("pong"); });
    if (smoke) {
      webview_.bind("app.complete",[this]() {
        verified=true;
        std::cout << "checkpoint: generated-app-js-native-pong" << std::endl;
        webview_.destroy();
        return true;
      });
      webview_.bind("app.fail",[this](const std::string& msg) {
        problem=msg;
        webview_.destroy();
        return false;
      });
    }
  }
  void onCreated() override {
    std::cout << "checkpoint: native-app-window-created" << std::endl;
  }
  void onLoadFinished(const std::string& url) override {
    std::cout << "checkpoint: native-app-ui-loaded " << url << std::endl;
  }
  void onClosed() override {
#ifdef XYTRON_APP_HOST_CEF
    CefQuitMessageLoop();
#else
    PostQuitMessage(0);
#endif
  }
private:
  nativeweb::WebView& webview_;
};

#ifndef XYTRON_APP_HOST_CEF
LRESULT CALLBACK hostProc(HWND wnd,UINT message,WPARAM w,LPARAM p) {
  if (message==WM_CLOSE) {
    DestroyWindow(wnd);
    return 0;
  }
  if (message==WM_DESTROY) {
    PostQuitMessage(0); // Manual window close must terminate interactive run.
    return 0;
  }
  return DefWindowProcW(wnd,message,w,p);
}
HWND newWindow() {
  const wchar_t* className=L"Xytron.Public.StandaloneHost";
  WNDCLASSW wc={};
  wc.lpfnWndProc=&hostProc;
  wc.hInstance=GetModuleHandleW(nullptr);
  wc.lpszClassName=className;
  if (!RegisterClassW(&wc) && GetLastError()!=ERROR_CLASS_ALREADY_EXISTS)
    return nullptr;
  return CreateWindowExW(0,className,L"Xytron App",WS_OVERLAPPEDWINDOW,
                         CW_USEDEFAULT,CW_USEDEFAULT,900,640,
                         nullptr,nullptr,wc.hInstance,nullptr);
}
#endif
} // namespace

int main(int argc,char** argv) {
  try {
#ifdef XYTRON_APP_HOST_CEF
#ifdef _WIN32
    CefMainArgs cefArgs(GetModuleHandleW(nullptr));
#else
    CefMainArgs cefArgs(argc,argv);
#endif
    CefRefPtr<nativeweb::detail::CefRendererApp> app(
        new nativeweb::detail::CefRendererApp());
    const int child=CefExecuteProcess(cefArgs,app,nullptr);
    if (child>=0) return child;
#endif
    for(int i=1;i<argc;++i) {
      if (std::string(argv[i])=="--smoke") smoke=true;
    }
    const std::shared_ptr<nativeweb::AppResourceBundle> assets=
        loadUi(flag(argc,argv,"--ui="));

#ifdef XYTRON_APP_HOST_CEF
    CefSettings settings;
    settings.no_sandbox=true; // CI/runtime contract; secure sandbox is a release follow-up.
    settings.windowless_rendering_enabled=true;
    settings.log_severity=LOGSEVERITY_WARNING;
    nativeweb::detail::registerCefBackendFactory();
    nativeweb::WebView view;
    Listener listener(view);
    view.setListener(&listener);
    app->setBrowserReadyCallback([&view,assets]() {
      nativeweb::WebViewOptions options;
      options.engine=nativeweb::Engine::Cef;
      options.appResources=assets;
      view.create(0,"app://desktop/index.html",options);
    });
    if (!CefInitialize(cefArgs,settings,app,nullptr))
      throw std::runtime_error("CEF runtime initialization failed");
    CefRunMessageLoop();
    CefShutdown();
#else
    HWND window=newWindow();
    if (!window) throw std::runtime_error("Cannot create Win32 window");
    nativeweb::detail::registerWebView2BackendFactory();
    nativeweb::WebView view;
    Listener listener(view);
    view.setListener(&listener);
    nativeweb::WebViewOptions options;
    options.engine=nativeweb::Engine::WebView2;
    options.appResources=assets;
    view.create(reinterpret_cast<nativeweb::NativeWindowHandle>(window),
                "app://desktop/index.html",options);
    if (!smoke) ShowWindow(window,SW_SHOW);
    MSG msg;
    while (GetMessageW(&msg,nullptr,0,0)>0) {
      TranslateMessage(&msg);
      DispatchMessageW(&msg);
    }
    if (IsWindow(window)) DestroyWindow(window);
#endif
    if (smoke && !verified) {
      std::cerr << "Generated-app bridge smoke incomplete: "<<problem<<std::endl;
      return 3;
    }
    std::cout << "xytron native desktop host: PASS" << std::endl;
    return 0;
  } catch(const std::exception& error) {
    std::cerr << "xytron native desktop host: "<<error.what()<<std::endl;
    return 2;
  }
}
