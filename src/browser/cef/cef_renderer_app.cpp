#include "browser/cef/cef_renderer_app.hpp"

#include "browser/cef/cef_value_converter.hpp"
#include "include/cef_process_message.h"

#include <sstream>

namespace nativeweb {
namespace detail {

class CefRendererApp::InvokeHandler : public CefV8Handler
{
public:
    explicit InvokeHandler(CefRendererApp* app)
        : app_(app)
    {
    }

    bool Execute(
        const CefString& name,
        CefRefPtr<CefV8Value> object,
        const CefV8ValueList& arguments,
        CefRefPtr<CefV8Value>& retval,
        CefString& exception) override
    {
        if (name != "invoke")
            return false;

        if (arguments.empty() || !arguments[0]->IsString())
        {
            exception =
                "native.invoke(method, ...args) requires a method string";
            return true;
        }

        CefRefPtr<CefV8Context> context =
            CefV8Context::GetCurrentContext();

        if (!context)
        {
            exception = "NativeWeb V8 context is unavailable";
            return true;
        }

        CefRefPtr<CefFrame> frame = context->GetFrame();
        CefRefPtr<CefV8Value> promise =
            CefV8Value::CreatePromise();

        if (!promise)
        {
            exception = "Failed to create NativeWeb Promise";
            return true;
        }

        CefV8ValueList callArguments;
        for (std::size_t i = 1; i < arguments.size(); ++i)
            callArguments.push_back(arguments[i]);

        app_->beginInvoke(
            frame,
            context,
            promise,
            arguments[0]->GetStringValue(),
            callArguments);

        retval = promise;
        return true;
    }

private:
    CefRendererApp* app_;

    IMPLEMENT_REFCOUNTING(InvokeHandler);
};

CefRendererApp::CefRendererApp()
    : nextRequestId_(1)
{
}

void CefRendererApp::setBrowserReadyCallback(
    const std::function<void()>& callback)
{
    browserReadyCallback_ = callback;
}

void CefRendererApp::OnContextInitialized()
{
    if (browserReadyCallback_)
        browserReadyCallback_();
}

void CefRendererApp::OnContextCreated(
    CefRefPtr<CefBrowser> browser,
    CefRefPtr<CefFrame> frame,
    CefRefPtr<CefV8Context> context)
{
    CefRefPtr<CefV8Value> global = context->GetGlobal();
    CefRefPtr<CefV8Value> native =
        CefV8Value::CreateObject(0, 0);

    CefRefPtr<CefV8Value> invoke =
        CefV8Value::CreateFunction(
            "invoke",
            new InvokeHandler(this));

    native->SetValue(
        "invoke",
        invoke,
        V8_PROPERTY_ATTRIBUTE_READONLY);

    global->SetValue(
        "native",
        native,
        V8_PROPERTY_ATTRIBUTE_READONLY);
}

void CefRendererApp::OnContextReleased(
    CefRefPtr<CefBrowser> browser,
    CefRefPtr<CefFrame> frame,
    CefRefPtr<CefV8Context> context)
{
    for (std::map<std::string, PendingPromise>::iterator it =
             pending_.begin();
         it != pending_.end();)
    {
        if (it->second.context.get() == context.get())
            pending_.erase(it++);
        else
            ++it;
    }
}

std::string CefRendererApp::beginInvoke(
    CefRefPtr<CefFrame> frame,
    CefRefPtr<CefV8Context> context,
    CefRefPtr<CefV8Value> promise,
    const CefString& method,
    const CefV8ValueList& arguments)
{
    std::ostringstream stream;
    stream << nextRequestId_++;
    const std::string id = stream.str();

    PendingPromise pending;
    pending.context = context;
    pending.promise = promise;
    pending_[id] = pending;

    CefRefPtr<CefProcessMessage> message =
        CefProcessMessage::Create("nativeweb.request");

    CefRefPtr<CefListValue> list =
        message->GetArgumentList();

    list->SetString(0, id);
    list->SetString(1, method);

    CefRefPtr<CefListValue> args =
        CefListValue::Create();
    args->SetSize(arguments.size());

    for (std::size_t i = 0; i < arguments.size(); ++i)
        args->SetValue(i, v8ToCefValue(arguments[i]));

    list->SetList(2, args);

    frame->SendProcessMessage(PID_BROWSER, message);
    return id;
}

bool CefRendererApp::OnProcessMessageReceived(
    CefRefPtr<CefBrowser> browser,
    CefRefPtr<CefFrame> frame,
    CefProcessId sourceProcess,
    CefRefPtr<CefProcessMessage> message)
{
    const CefString name = message->GetName();

    if (name != "nativeweb.response")
        return false;

    CefRefPtr<CefListValue> args =
        message->GetArgumentList();

    const std::string id =
        args->GetString(0).ToString();

    std::map<std::string, PendingPromise>::iterator found =
        pending_.find(id);

    if (found == pending_.end())
        return true;

    PendingPromise pending = found->second;
    pending_.erase(found);

    if (!pending.context || !pending.promise)
        return true;

    if (!pending.context->Enter())
        return true;

    const bool success = args->GetBool(1);

    if (success)
    {
        pending.promise->ResolvePromise(
            cefValueToV8(args->GetValue(2)));
    }
    else
    {
        const std::string code =
            args->GetString(2).ToString();
        const std::string errorMessage =
            args->GetString(3).ToString();

        pending.promise->RejectPromise(
            code + ": " + errorMessage);
    }

    pending.context->Exit();
    return true;
}

} // namespace detail
} // namespace nativeweb
