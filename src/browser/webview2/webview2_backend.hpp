#ifndef NATIVEWEB_WEBVIEW2_BACKEND_HPP_INCLUDED
#define NATIVEWEB_WEBVIEW2_BACKEND_HPP_INCLUDED

#if !defined(_WIN32)
#error NativeWeb WebView2 backend is Windows-only
#endif

#include "browser/common/browser_backend.hpp"

#include <atomic>
#include <functional>
#include <string>

#include <windows.h>
#include <wrl.h>
#include <WebView2.h>

namespace nativeweb {
namespace detail {

class WebView2Backend : public BrowserBackend
{
public:
    WebView2Backend();
    ~WebView2Backend() override;

    const char* engineName() const override;
    Engine engine() const override;
    Capabilities capabilities() const override;

    void setListener(BrowserBackendListener* listener) override;
    void create(const BrowserCreateParams& params) override;
    void destroy() override;
    bool isCreated() const override;
    void load(const std::string& source) override;
    void reload() override;
    void postBridgeMessage(const Any& message) override;

private:
    struct CreateState
    {
        CreateState()
            : done(false),
              result(E_PENDING)
        {
        }

        bool done;
        HRESULT result;
    };

    struct DispatchTask
    {
        explicit DispatchTask(
            const std::function<void()>& value)
            : function(value)
        {
        }

        std::function<void()> function;
    };

    void requireUiThread() const;
    void createDispatchWindow();
    void destroyDispatchWindow();
    bool postToUi(const std::function<void()>& function);

    void finishControllerCreation(
        ICoreWebView2Controller* controller,
        CreateState* state);

    HRESULT installHandlers();
    HRESULT installBridgeScript(CreateState* state);

    void destroyOnUi();
    void navigateOnUi(const std::string& source);
    void postBridgeMessageOnUi(const Any& message);

    void notifyLoadStarted(const std::wstring& source);
    void notifyLoadFinished();

    bool pumpUntil(CreateState& state, DWORD timeoutMs);

    static LRESULT CALLBACK dispatchWindowProc(
        HWND window,
        UINT message,
        WPARAM wParam,
        LPARAM lParam);

    static std::wstring utf8ToWide(const std::string& value);
    static std::string wideToUtf8(const wchar_t* value);

    BrowserBackendListener* listener_;
    HWND parent_;
    HWND dispatchWindow_;
    DWORD uiThreadId_;
    bool comInitialized_;
    std::atomic<bool> created_;
    std::atomic<bool> closing_;
    std::string source_;

    Microsoft::WRL::ComPtr<ICoreWebView2Environment> environment_;
    Microsoft::WRL::ComPtr<ICoreWebView2Controller> controller_;
    Microsoft::WRL::ComPtr<ICoreWebView2> webview_;

    EventRegistrationToken webMessageToken_;
    EventRegistrationToken navigationStartingToken_;
    EventRegistrationToken navigationCompletedToken_;
    bool webMessageRegistered_;
    bool navigationStartingRegistered_;
    bool navigationCompletedRegistered_;
};

void registerWebView2BackendFactory();

} // namespace detail
} // namespace nativeweb

#endif
