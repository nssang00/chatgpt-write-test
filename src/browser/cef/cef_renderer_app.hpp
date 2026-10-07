#ifndef NATIVEWEB_CEF_RENDERER_APP_HPP_INCLUDED
#define NATIVEWEB_CEF_RENDERER_APP_HPP_INCLUDED

#include "include/cef_app.h"
#include "include/cef_v8.h"

#include <cstdint>
#include <functional>
#include <map>
#include <string>

namespace nativeweb {
namespace detail {

class CefRendererApp :
    public CefApp,
    public CefBrowserProcessHandler,
    public CefRenderProcessHandler
{
public:
    CefRendererApp();

    CefRefPtr<CefBrowserProcessHandler>
    GetBrowserProcessHandler() override
    {
        return this;
    }

    CefRefPtr<CefRenderProcessHandler>
    GetRenderProcessHandler() override
    {
        return this;
    }

    void setBrowserReadyCallback(
        const std::function<void()>& callback);

    void OnContextInitialized() override;

    void OnContextCreated(
        CefRefPtr<CefBrowser> browser,
        CefRefPtr<CefFrame> frame,
        CefRefPtr<CefV8Context> context) override;

    void OnContextReleased(
        CefRefPtr<CefBrowser> browser,
        CefRefPtr<CefFrame> frame,
        CefRefPtr<CefV8Context> context) override;

    bool OnProcessMessageReceived(
        CefRefPtr<CefBrowser> browser,
        CefRefPtr<CefFrame> frame,
        CefProcessId sourceProcess,
        CefRefPtr<CefProcessMessage> message) override;

    std::string beginInvoke(
        CefRefPtr<CefFrame> frame,
        CefRefPtr<CefV8Context> context,
        CefRefPtr<CefV8Value> promise,
        const CefString& method,
        const CefV8ValueList& arguments);

private:
    struct PendingPromise
    {
        CefRefPtr<CefV8Context> context;
        CefRefPtr<CefV8Value> promise;
    };

    class InvokeHandler;

    std::function<void()> browserReadyCallback_;
    std::uint64_t nextRequestId_;
    std::map<std::string, PendingPromise> pending_;

    IMPLEMENT_REFCOUNTING(CefRendererApp);
};

} // namespace detail
} // namespace nativeweb

#endif
