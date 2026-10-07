#include "browser/cef/cef_backend.hpp"

#include "browser/cef/cef_value_converter.hpp"
#include "browser/common/backend_registry.hpp"
#include "core/bridge_message.hpp"
#include "include/cef_process_message.h"
#include "include/cef_render_handler.h"

#include <cstdint>
#include <sstream>
#include <stdexcept>

namespace nativeweb {
namespace detail {

namespace {

std::string idToString(RequestId id)
{
    std::ostringstream stream;
    stream << id;
    return stream.str();
}

RequestId stringToId(const std::string& value)
{
    std::istringstream stream(value);
    RequestId id = 0;
    stream >> id;

    if (!stream || !stream.eof())
        throw std::runtime_error("Invalid CEF NativeWeb request id");

    return id;
}

} // namespace

class CefBackend::Client :
    public CefClient,
    public CefLifeSpanHandler,
    public CefLoadHandler,
    public CefRenderHandler
{
public:
    explicit Client(CefBackend* owner)
        : owner_(owner)
    {
    }

    CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override
    {
        return this;
    }

    CefRefPtr<CefLoadHandler> GetLoadHandler() override
    {
        return this;
    }

    CefRefPtr<CefRenderHandler> GetRenderHandler() override
    {
        return this;
    }

    void OnAfterCreated(
        CefRefPtr<CefBrowser> browser) override
    {
        owner_->onAfterCreated(browser);
    }

    void OnBeforeClose(
        CefRefPtr<CefBrowser> browser) override
    {
        owner_->onBeforeClose(browser);
    }

    void OnLoadStart(
        CefRefPtr<CefBrowser> browser,
        CefRefPtr<CefFrame> frame,
        TransitionType transitionType) override
    {
        owner_->onLoadStart(frame);
    }

    void OnLoadEnd(
        CefRefPtr<CefBrowser> browser,
        CefRefPtr<CefFrame> frame,
        int httpStatusCode) override
    {
        owner_->onLoadEnd(frame);
    }

    bool OnProcessMessageReceived(
        CefRefPtr<CefBrowser> browser,
        CefRefPtr<CefFrame> frame,
        CefProcessId sourceProcess,
        CefRefPtr<CefProcessMessage> message) override
    {
        if (sourceProcess != PID_RENDERER)
            return false;

        return owner_->onProcessMessage(frame, message);
    }

    void GetViewRect(
        CefRefPtr<CefBrowser> browser,
        CefRect& rect) override
    {
        rect = CefRect(0, 0, 800, 600);
    }

    void OnPaint(
        CefRefPtr<CefBrowser> browser,
        PaintElementType type,
        const RectList& dirtyRects,
        const void* buffer,
        int width,
        int height) override
    {
    }

private:
    CefBackend* owner_;

    IMPLEMENT_REFCOUNTING(Client);
};

CefBackend::CefBackend()
    : listener_(0),
      client_(new Client(this))
{
}

CefBackend::~CefBackend()
{
}

const char* CefBackend::engineName() const
{
    return "cef";
}

Engine CefBackend::engine() const
{
    return Engine::Cef;
}

Capabilities CefBackend::capabilities() const
{
    return Capabilities(
        static_cast<std::uint64_t>(Capability::Binary) |
        static_cast<std::uint64_t>(Capability::Events) |
        static_cast<std::uint64_t>(Capability::AsyncJavaScript) |
        static_cast<std::uint64_t>(Capability::Windowless));
}

void CefBackend::setListener(
    BrowserBackendListener* listener)
{
    listener_ = listener;
}

void CefBackend::create(
    const BrowserCreateParams& params)
{
    if (browser_)
        throw std::runtime_error("CEF browser is already created");

    CefWindowInfo windowInfo;

    if (!params.parent)
    {
        windowInfo.SetAsWindowless(0);
    }
    else
    {
#if defined(OS_LINUX)
        const std::uintptr_t nativeValue =
            reinterpret_cast<std::uintptr_t>(params.parent);

        windowInfo.SetAsChild(
            static_cast<cef_window_handle_t>(nativeValue),
            CefRect(0, 0, 800, 600));
#else
        windowInfo.SetAsChild(
            reinterpret_cast<cef_window_handle_t>(params.parent),
            CefRect(0, 0, 800, 600));
#endif
    }

    CefBrowserSettings settings;

    const bool started =
        CefBrowserHost::CreateBrowser(
            windowInfo,
            client_,
            params.source,
            settings,
            nullptr,
            nullptr);

    if (!started)
        throw std::runtime_error("CefBrowserHost::CreateBrowser failed");
}

void CefBackend::destroy()
{
    if (browser_)
        browser_->GetHost()->CloseBrowser(true);
}

bool CefBackend::isCreated() const
{
    return browser_ != 0;
}

void CefBackend::load(const std::string& source)
{
    if (!browser_)
        throw std::runtime_error("CEF browser is not created");

    browser_->GetMainFrame()->LoadURL(source);
}

void CefBackend::reload()
{
    if (!browser_)
        throw std::runtime_error("CEF browser is not created");

    browser_->Reload();
}

void CefBackend::onAfterCreated(
    CefRefPtr<CefBrowser> browser)
{
    browser_ = browser;

    if (listener_)
        listener_->onBrowserCreated();
}

void CefBackend::onBeforeClose(
    CefRefPtr<CefBrowser> browser)
{
    browser_ = nullptr;

    if (listener_)
        listener_->onBrowserClosed();
}

void CefBackend::onLoadStart(
    CefRefPtr<CefFrame> frame)
{
    if (listener_ && frame && frame->IsMain())
        listener_->onLoadStarted(frame->GetURL().ToString());
}

void CefBackend::onLoadEnd(
    CefRefPtr<CefFrame> frame)
{
    if (listener_ && frame && frame->IsMain())
        listener_->onLoadFinished(frame->GetURL().ToString());
}

bool CefBackend::onProcessMessage(
    CefRefPtr<CefFrame> frame,
    CefRefPtr<CefProcessMessage> message)
{
    const CefString messageName =
        message->GetName();

    CefRefPtr<CefListValue> list =
        message->GetArgumentList();

    if (messageName == "nativeweb.call.response")
    {
        const RequestId requestId =
            stringToId(list->GetString(0).ToString());

        if (listener_)
        {
            if (list->GetBool(1))
            {
                listener_->onBridgeMessage(
                    makeResponseMessage(
                        requestId,
                        cefValueToAny(
                            list->GetValue(2))));
            }
            else
            {
                listener_->onBridgeMessage(
                    makeErrorMessage(
                        requestId,
                        Error(
                            list->GetString(2).ToString(),
                            list->GetString(3).ToString())));
            }
        }

        return true;
    }

    if (messageName != "nativeweb.request")
        return false;

    const RequestId requestId =
        stringToId(list->GetString(0).ToString());

    const std::string method =
        list->GetString(1).ToString();

    VariantList args;
    CefRefPtr<CefListValue> cefArgs =
        list->GetList(2);

    const std::size_t count =
        cefArgs ? cefArgs->GetSize() : 0;

    args.reserve(count);

    for (std::size_t i = 0; i < count; ++i)
        args.push_back(
            cefValueToAny(cefArgs->GetValue(i)));

    if (listener_)
    {
        listener_->onBridgeMessage(
            makeRequestMessage(
                requestId,
                method,
                args));
    }

    return true;
}

void CefBackend::postBridgeMessage(const Any& message)
{
    if (!browser_)
        return;

    const BridgeMessage parsed =
        parseBridgeMessage(message);

    if (parsed.type == BridgeMessageType::Request)
    {
        CefRefPtr<CefProcessMessage> callMessage =
            CefProcessMessage::Create("nativeweb.call");

        CefRefPtr<CefListValue> callArgs =
            callMessage->GetArgumentList();

        callArgs->SetString(
            0,
            idToString(parsed.requestId));

        callArgs->SetString(1, parsed.method);

        CefRefPtr<CefListValue> cefArguments =
            CefListValue::Create();

        cefArguments->SetSize(parsed.args.size());

        for (std::size_t i = 0;
             i < parsed.args.size();
             ++i)
        {
            cefArguments->SetValue(
                i,
                anyToCefValue(parsed.args[i]));
        }

        callArgs->SetList(2, cefArguments);

        browser_->GetMainFrame()->SendProcessMessage(
            PID_RENDERER,
            callMessage);

        return;
    }

    if (parsed.type == BridgeMessageType::Event)
    {
        CefRefPtr<CefProcessMessage> eventMessage =
            CefProcessMessage::Create("nativeweb.event");

        CefRefPtr<CefListValue> eventArgs =
            eventMessage->GetArgumentList();

        eventArgs->SetString(0, parsed.eventName);
        eventArgs->SetValue(1, anyToCefValue(parsed.value));

        browser_->GetMainFrame()->SendProcessMessage(
            PID_RENDERER,
            eventMessage);

        return;
    }

    if (parsed.type != BridgeMessageType::Response &&
        parsed.type != BridgeMessageType::Error)
    {
        return;
    }

    CefRefPtr<CefProcessMessage> cefMessage =
        CefProcessMessage::Create("nativeweb.response");

    CefRefPtr<CefListValue> args =
        cefMessage->GetArgumentList();

    args->SetString(0, idToString(parsed.requestId));

    if (parsed.type == BridgeMessageType::Response)
    {
        args->SetBool(1, true);
        args->SetValue(2, anyToCefValue(parsed.value));
    }
    else
    {
        args->SetBool(1, false);
        args->SetString(2, parsed.errorCode);
        args->SetString(3, parsed.errorMessage);
    }

    browser_->GetMainFrame()->SendProcessMessage(
        PID_RENDERER,
        cefMessage);
}

void registerCefBackendFactory()
{
    registerBrowserBackendFactory(
        Engine::Cef,
        []() -> std::unique_ptr<BrowserBackend>
        {
            return std::unique_ptr<BrowserBackend>(
                new CefBackend());
        });
}

} // namespace detail
} // namespace nativeweb
