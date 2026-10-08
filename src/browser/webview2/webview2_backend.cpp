#include "browser/webview2/webview2_backend.hpp"

#include "browser/common/backend_registry.hpp"
#include "browser/webview2/webview2_bridge_script.hpp"
#include "core/json_codec.hpp"
#include "nativeweb/error.hpp"

#include <memory>
#include <sstream>
#include <stdexcept>

#include <wrl/event.h>

namespace nativeweb {
namespace detail {

namespace {

const wchar_t* kDispatchWindowClass =
    L"NativeWeb.WebView2.Dispatch";

const UINT kDispatchTaskMessage =
    WM_APP + 0x4e57;

void checkHresult(
    HRESULT result,
    const char* operation)
{
    if (SUCCEEDED(result))
        return;

    std::ostringstream message;
    message
        << operation
        << " failed (HRESULT=0x"
        << std::hex
        << static_cast<unsigned long>(result)
        << ")";

    throw Error(
        "webview2_error",
        message.str());
}

} // namespace

WebView2Backend::WebView2Backend()
    : listener_(0),
      parent_(0),
      dispatchWindow_(0),
      uiThreadId_(0),
      comInitialized_(false),
      created_(false),
      closing_(false),
      webMessageRegistered_(false),
      navigationStartingRegistered_(false),
      navigationCompletedRegistered_(false)
{
    webMessageToken_.value = 0;
    navigationStartingToken_.value = 0;
    navigationCompletedToken_.value = 0;
}

WebView2Backend::~WebView2Backend()
{
    if (
        uiThreadId_ != 0 &&
        GetCurrentThreadId() == uiThreadId_)
    {
        destroyOnUi();
        destroyDispatchWindow();

        if (comInitialized_)
        {
            CoUninitialize();
            comInitialized_ = false;
        }
    }
}

const char* WebView2Backend::engineName() const
{
    return "webview2";
}

Engine WebView2Backend::engine() const
{
    return Engine::WebView2;
}

Capabilities WebView2Backend::capabilities() const
{
    return Capabilities(
        static_cast<std::uint64_t>(
            Capability::Binary) |
        static_cast<std::uint64_t>(
            Capability::Events) |
        static_cast<std::uint64_t>(
            Capability::AsyncJavaScript));
}

void WebView2Backend::setListener(
    BrowserBackendListener* listener)
{
    listener_ = listener;
}

void WebView2Backend::requireUiThread() const
{
    if (
        uiThreadId_ != 0 &&
        GetCurrentThreadId() != uiThreadId_)
    {
        throw Error(
            "webview2_wrong_thread",
            "WebView2 operation must run on its UI thread");
    }
}

void WebView2Backend::create(
    const BrowserCreateParams& params)
{
    if (created_.load())
    {
        throw Error(
            "webview_already_created",
            "NativeWeb WebView2 backend is already created");
    }

    if (
        !params.parent ||
        !IsWindow(
            reinterpret_cast<HWND>(
                params.parent)))
    {
        throw Error(
            "invalid_parent_window",
            "WebView2 requires a valid Win32 parent HWND");
    }

    uiThreadId_ = GetCurrentThreadId();
    parent_ =
        reinterpret_cast<HWND>(
            params.parent);
    source_ = params.source;
    closing_.store(false);

    const HRESULT comResult =
        CoInitializeEx(
            0,
            COINIT_APARTMENTTHREADED);

    if (comResult == RPC_E_CHANGED_MODE)
    {
        throw Error(
            "webview2_com_apartment",
            "WebView2 UI thread must use an STA COM apartment");
    }

    checkHresult(
        comResult,
        "CoInitializeEx");

    comInitialized_ = true;
    createDispatchWindow();

    CreateState state;

    const HRESULT createResult =
        CreateCoreWebView2EnvironmentWithOptions(
            0,
            0,
            0,
            Microsoft::WRL::Callback<
                ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
                [this, &state](
                    HRESULT result,
                    ICoreWebView2Environment* environment)
                    -> HRESULT
                {
                    if (FAILED(result) || !environment)
                    {
                        state.result =
                            FAILED(result)
                                ? result
                                : E_FAIL;
                        state.done = true;
                        return S_OK;
                    }

                    environment_ = environment;

                    const HRESULT controllerResult =
                        environment_->CreateCoreWebView2Controller(
                            parent_,
                            Microsoft::WRL::Callback<
                                ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                                [this, &state](
                                    HRESULT result,
                                    ICoreWebView2Controller* controller)
                                    -> HRESULT
                                {
                                    if (FAILED(result) || !controller)
                                    {
                                        state.result =
                                            FAILED(result)
                                                ? result
                                                : E_FAIL;
                                        state.done = true;
                                        return S_OK;
                                    }

                                    try
                                    {
                                        finishControllerCreation(
                                            controller,
                                            &state);
                                    }
                                    catch (...)
                                    {
                                        state.result = E_FAIL;
                                        state.done = true;
                                    }

                                    return S_OK;
                                }).Get());

                    if (FAILED(controllerResult))
                    {
                        state.result = controllerResult;
                        state.done = true;
                    }

                    return S_OK;
                }).Get());

    if (FAILED(createResult))
    {
        state.result = createResult;
        state.done = true;
    }

    if (!pumpUntil(state, 30000))
    {
        destroyOnUi();
        throw Error(
            "webview2_timeout",
            "Timed out creating WebView2");
    }

    if (FAILED(state.result))
    {
        const HRESULT failure =
            state.result;

        destroyOnUi();

        checkHresult(
            failure,
            "CreateCoreWebView2EnvironmentWithOptions");
    }
}

void WebView2Backend::finishControllerCreation(
    ICoreWebView2Controller* controller,
    CreateState* state)
{
    controller_ = controller;

    checkHresult(
        controller_->get_CoreWebView2(
            &webview_),
        "ICoreWebView2Controller::get_CoreWebView2");

    RECT bounds;
    GetClientRect(parent_, &bounds);

    checkHresult(
        controller_->put_Bounds(bounds),
        "ICoreWebView2Controller::put_Bounds");

    Microsoft::WRL::ComPtr<
        ICoreWebView2Settings> settings;

    checkHresult(
        webview_->get_Settings(&settings),
        "ICoreWebView2::get_Settings");

    if (settings)
    {
        checkHresult(
            settings->put_IsWebMessageEnabled(TRUE),
            "ICoreWebView2Settings::put_IsWebMessageEnabled");
    }

    checkHresult(
        installHandlers(),
        "install WebView2 handlers");

    checkHresult(
        installBridgeScript(state),
        "ICoreWebView2::AddScriptToExecuteOnDocumentCreated");
}

HRESULT WebView2Backend::installHandlers()
{
    HRESULT result =
        webview_->add_WebMessageReceived(
            Microsoft::WRL::Callback<
                ICoreWebView2WebMessageReceivedEventHandler>(
                [this](
                    ICoreWebView2*,
                    ICoreWebView2WebMessageReceivedEventArgs* args)
                    -> HRESULT
                {
                    if (!args || !listener_)
                        return S_OK;

                    LPWSTR json = 0;

                    const HRESULT jsonResult =
                        args->get_WebMessageAsJson(
                            &json);

                    if (FAILED(jsonResult) || !json)
                        return S_OK;

                    try
                    {
                        const std::string utf8 =
                            wideToUtf8(json);

                        CoTaskMemFree(json);
                        json = 0;

                        listener_->onBridgeMessage(
                            jsonToAny(utf8));
                    }
                    catch (...)
                    {
                        if (json)
                            CoTaskMemFree(json);
                    }

                    return S_OK;
                }).Get(),
            &webMessageToken_);

    if (FAILED(result))
        return result;

    webMessageRegistered_ = true;

    result =
        webview_->add_NavigationStarting(
            Microsoft::WRL::Callback<
                ICoreWebView2NavigationStartingEventHandler>(
                [this](
                    ICoreWebView2*,
                    ICoreWebView2NavigationStartingEventArgs* args)
                    -> HRESULT
                {
                    if (!args)
                        return S_OK;

                    LPWSTR uri = 0;

                    if (
                        SUCCEEDED(
                            args->get_Uri(&uri)) &&
                        uri)
                    {
                        notifyLoadStarted(uri);
                        CoTaskMemFree(uri);
                    }

                    return S_OK;
                }).Get(),
            &navigationStartingToken_);

    if (FAILED(result))
        return result;

    navigationStartingRegistered_ = true;

    result =
        webview_->add_NavigationCompleted(
            Microsoft::WRL::Callback<
                ICoreWebView2NavigationCompletedEventHandler>(
                [this](
                    ICoreWebView2*,
                    ICoreWebView2NavigationCompletedEventArgs*)
                    -> HRESULT
                {
                    notifyLoadFinished();
                    return S_OK;
                }).Get(),
            &navigationCompletedToken_);

    if (FAILED(result))
        return result;

    navigationCompletedRegistered_ = true;
    return S_OK;
}

HRESULT WebView2Backend::installBridgeScript(
    CreateState* state)
{
    return webview_->AddScriptToExecuteOnDocumentCreated(
        kWebView2BridgeScript,
        Microsoft::WRL::Callback<
            ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>(
            [this, state](
                HRESULT result,
                LPCWSTR)
                -> HRESULT
            {
                if (FAILED(result))
                {
                    state->result = result;
                    state->done = true;
                    return S_OK;
                }

                created_.store(true);

                if (listener_)
                    listener_->onBrowserCreated();

                const std::wstring url =
                    utf8ToWide(
                        source_.empty()
                            ? std::string("about:blank")
                            : source_);

                state->result =
                    webview_->Navigate(
                        url.c_str());

                state->done = true;
                return S_OK;
            }).Get());
}

bool WebView2Backend::pumpUntil(
    CreateState& state,
    DWORD timeoutMs)
{
    const ULONGLONG started =
        GetTickCount64();

    while (!state.done)
    {
        MSG message;

        while (
            PeekMessageW(
                &message,
                0,
                0,
                0,
                PM_REMOVE))
        {
            if (message.message == WM_QUIT)
            {
                PostQuitMessage(
                    static_cast<int>(
                        message.wParam));

                state.result = E_ABORT;
                state.done = true;
                break;
            }

            TranslateMessage(&message);
            DispatchMessageW(&message);
        }

        if (state.done)
            break;

        if (
            GetTickCount64() - started >=
            timeoutMs)
        {
            return false;
        }

        MsgWaitForMultipleObjectsEx(
            0,
            0,
            25,
            QS_ALLINPUT,
            MWMO_INPUTAVAILABLE);
    }

    return true;
}

void WebView2Backend::destroy()
{
    if (uiThreadId_ == 0)
        return;

    if (GetCurrentThreadId() == uiThreadId_)
    {
        destroyOnUi();
        return;
    }

    postToUi(
        [this]() {
            destroyOnUi();
        });
}

void WebView2Backend::destroyOnUi()
{
    if (closing_.exchange(true))
        return;

    const bool wasCreated =
        created_.exchange(false);

    if (webview_)
    {
        if (webMessageRegistered_)
        {
            webview_->remove_WebMessageReceived(
                webMessageToken_);
            webMessageRegistered_ = false;
        }

        if (navigationStartingRegistered_)
        {
            webview_->remove_NavigationStarting(
                navigationStartingToken_);
            navigationStartingRegistered_ = false;
        }

        if (navigationCompletedRegistered_)
        {
            webview_->remove_NavigationCompleted(
                navigationCompletedToken_);
            navigationCompletedRegistered_ = false;
        }
    }

    if (controller_)
        controller_->Close();

    webview_.Reset();
    controller_.Reset();
    environment_.Reset();

    if (wasCreated && listener_)
        listener_->onBrowserClosed();
}

bool WebView2Backend::isCreated() const
{
    return created_.load();
}

void WebView2Backend::load(
    const std::string& source)
{
    requireUiThread();

    if (!created_.load() || !webview_)
    {
        throw Error(
            "webview_not_created",
            "WebView2 is not created");
    }

    navigateOnUi(source);
}

void WebView2Backend::navigateOnUi(
    const std::string& source)
{
    source_ = source;

    const std::wstring wide =
        utf8ToWide(source);

    checkHresult(
        webview_->Navigate(
            wide.c_str()),
        "ICoreWebView2::Navigate");
}

void WebView2Backend::reload()
{
    requireUiThread();

    if (!created_.load() || !webview_)
    {
        throw Error(
            "webview_not_created",
            "WebView2 is not created");
    }

    checkHresult(
        webview_->Reload(),
        "ICoreWebView2::Reload");
}

void WebView2Backend::postBridgeMessage(
    const Any& message)
{
    if (!created_.load())
        return;

    if (GetCurrentThreadId() == uiThreadId_)
    {
        postBridgeMessageOnUi(message);
        return;
    }

    postToUi(
        [this, message]() {
            postBridgeMessageOnUi(message);
        });
}

void WebView2Backend::postBridgeMessageOnUi(
    const Any& message)
{
    if (!created_.load() || !webview_)
        return;

    const std::wstring json =
        utf8ToWide(
            anyToJson(message));

    checkHresult(
        webview_->PostWebMessageAsJson(
            json.c_str()),
        "ICoreWebView2::PostWebMessageAsJson");
}

void WebView2Backend::notifyLoadStarted(
    const std::wstring& source)
{
    if (listener_)
    {
        listener_->onLoadStarted(
            wideToUtf8(
                source.c_str()));
    }
}

void WebView2Backend::notifyLoadFinished()
{
    if (!listener_ || !webview_)
        return;

    LPWSTR source = 0;

    if (
        SUCCEEDED(
            webview_->get_Source(
                &source)) &&
        source)
    {
        listener_->onLoadFinished(
            wideToUtf8(source));

        CoTaskMemFree(source);
    }
}

void WebView2Backend::createDispatchWindow()
{
    if (dispatchWindow_)
        return;

    WNDCLASSW windowClass;
    ZeroMemory(
        &windowClass,
        sizeof(windowClass));

    windowClass.lpfnWndProc =
        &WebView2Backend::dispatchWindowProc;
    windowClass.hInstance =
        GetModuleHandleW(0);
    windowClass.lpszClassName =
        kDispatchWindowClass;

    if (!RegisterClassW(&windowClass))
    {
        const DWORD error =
            GetLastError();

        if (error != ERROR_CLASS_ALREADY_EXISTS)
        {
            throw Error(
                "webview2_dispatch_window",
                "Failed to register WebView2 dispatch window");
        }
    }

    dispatchWindow_ =
        CreateWindowExW(
            0,
            kDispatchWindowClass,
            L"",
            0,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            0,
            GetModuleHandleW(0),
            this);

    if (!dispatchWindow_)
    {
        throw Error(
            "webview2_dispatch_window",
            "Failed to create WebView2 dispatch window");
    }
}

void WebView2Backend::destroyDispatchWindow()
{
    if (dispatchWindow_)
    {
        DestroyWindow(dispatchWindow_);
        dispatchWindow_ = 0;
    }
}

bool WebView2Backend::postToUi(
    const std::function<void()>& function)
{
    if (!function || !dispatchWindow_)
        return false;

    if (GetCurrentThreadId() == uiThreadId_)
    {
        function();
        return true;
    }

    std::unique_ptr<DispatchTask> task(
        new DispatchTask(function));

    if (!PostMessageW(
            dispatchWindow_,
            kDispatchTaskMessage,
            0,
            reinterpret_cast<LPARAM>(
                task.get())))
    {
        return false;
    }

    task.release();
    return true;
}

LRESULT CALLBACK WebView2Backend::dispatchWindowProc(
    HWND window,
    UINT message,
    WPARAM wParam,
    LPARAM lParam)
{
    WebView2Backend* backend =
        reinterpret_cast<WebView2Backend*>(
            GetWindowLongPtrW(
                window,
                GWLP_USERDATA));

    if (message == WM_NCCREATE)
    {
        CREATESTRUCTW* create =
            reinterpret_cast<CREATESTRUCTW*>(
                lParam);

        backend =
            static_cast<WebView2Backend*>(
                create->lpCreateParams);

        SetWindowLongPtrW(
            window,
            GWLP_USERDATA,
            reinterpret_cast<LONG_PTR>(
                backend));
    }

    if (message == kDispatchTaskMessage)
    {
        std::unique_ptr<DispatchTask> task(
            reinterpret_cast<DispatchTask*>(
                lParam));

        if (task && task->function)
            task->function();

        return 0;
    }

    return DefWindowProcW(
        window,
        message,
        wParam,
        lParam);
}

std::wstring WebView2Backend::utf8ToWide(
    const std::string& value)
{
    if (value.empty())
        return std::wstring();

    const int size =
        MultiByteToWideChar(
            CP_UTF8,
            MB_ERR_INVALID_CHARS,
            value.c_str(),
            static_cast<int>(
                value.size()),
            0,
            0);

    if (size <= 0)
    {
        throw Error(
            "utf8_conversion",
            "Failed to convert UTF-8 to UTF-16");
    }

    std::wstring output(
        static_cast<std::size_t>(size),
        L'\0');

    MultiByteToWideChar(
        CP_UTF8,
        MB_ERR_INVALID_CHARS,
        value.c_str(),
        static_cast<int>(
            value.size()),
        &output[0],
        size);

    return output;
}

std::string WebView2Backend::wideToUtf8(
    const wchar_t* value)
{
    if (!value || !*value)
        return std::string();

    const int length =
        static_cast<int>(
            lstrlenW(value));

    const int size =
        WideCharToMultiByte(
            CP_UTF8,
            WC_ERR_INVALID_CHARS,
            value,
            length,
            0,
            0,
            0,
            0);

    if (size <= 0)
    {
        throw Error(
            "utf8_conversion",
            "Failed to convert UTF-16 to UTF-8");
    }

    std::string output(
        static_cast<std::size_t>(size),
        '\0');

    WideCharToMultiByte(
        CP_UTF8,
        WC_ERR_INVALID_CHARS,
        value,
        length,
        &output[0],
        size,
        0,
        0);

    return output;
}

void registerWebView2BackendFactory()
{
    registerBrowserBackendFactory(
        Engine::WebView2,
        []()
            -> std::unique_ptr<BrowserBackend>
        {
            return std::unique_ptr<BrowserBackend>(
                new WebView2Backend());
        });
}

} // namespace detail
} // namespace nativeweb
