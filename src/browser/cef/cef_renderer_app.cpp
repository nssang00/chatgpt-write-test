#include "browser/cef/cef_renderer_app.hpp"

#include "browser/cef/cef_value_converter.hpp"
#include "include/cef_process_message.h"

#include <sstream>
#include <vector>

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
        CefRefPtr<CefV8Context> context =
            CefV8Context::GetCurrentContext();

        if (!context)
        {
            exception = "NativeWeb V8 context is unavailable";
            return true;
        }

        if (name == "invoke")
        {
            if (arguments.empty() || !arguments[0]->IsString())
            {
                exception =
                    "native.invoke(method, ...args) requires a method string";
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

        if (name == "on")
        {
            if (arguments.size() != 2 ||
                !arguments[0]->IsString() ||
                !arguments[1]->IsFunction())
            {
                exception =
                    "native.on(eventName, callback) requires a string and function";
                return true;
            }

            const std::string id =
                app_->subscribeEvent(
                    context,
                    arguments[0]->GetStringValue(),
                    arguments[1]);

            retval = CefV8Value::CreateString(id);
            return true;
        }

        if (name == "off")
        {
            if (arguments.size() != 1 || !arguments[0]->IsString())
            {
                exception =
                    "native.off(subscriptionId) requires a subscription id string";
                return true;
            }

            retval = CefV8Value::CreateBool(
                app_->unsubscribeEvent(
                    arguments[0]->GetStringValue().ToString()));

            return true;
        }

        return false;
    }

private:
    CefRendererApp* app_;

    IMPLEMENT_REFCOUNTING(InvokeHandler);
};

CefRendererApp::CefRendererApp()
    : nextRequestId_(1),
      nextSubscriptionId_(1)
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
        CefV8Value::CreateObject(nullptr, nullptr);

    CefRefPtr<InvokeHandler> handler =
        new InvokeHandler(this);

    CefRefPtr<CefV8Value> invoke =
        CefV8Value::CreateFunction(
            "invoke",
            handler);

    CefRefPtr<CefV8Value> on =
        CefV8Value::CreateFunction(
            "on",
            handler);

    CefRefPtr<CefV8Value> off =
        CefV8Value::CreateFunction(
            "off",
            handler);

    native->SetValue(
        "invoke",
        invoke,
        V8_PROPERTY_ATTRIBUTE_READONLY);

    native->SetValue(
        "on",
        on,
        V8_PROPERTY_ATTRIBUTE_READONLY);

    native->SetValue(
        "off",
        off,
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

    for (std::map<std::string, EventSubscription>::iterator it =
             subscriptions_.begin();
         it != subscriptions_.end();)
    {
        if (it->second.context.get() == context.get())
            subscriptions_.erase(it++);
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

std::string CefRendererApp::subscribeEvent(
    CefRefPtr<CefV8Context> context,
    const CefString& eventName,
    CefRefPtr<CefV8Value> callback)
{
    std::ostringstream stream;
    stream << nextSubscriptionId_++;
    const std::string id = stream.str();

    EventSubscription subscription;
    subscription.context = context;
    subscription.callback = callback;
    subscription.eventName = eventName.ToString();

    subscriptions_[id] = subscription;
    return id;
}

bool CefRendererApp::unsubscribeEvent(
    const std::string& subscriptionId)
{
    return subscriptions_.erase(subscriptionId) != 0;
}

bool CefRendererApp::OnProcessMessageReceived(
    CefRefPtr<CefBrowser> browser,
    CefRefPtr<CefFrame> frame,
    CefProcessId sourceProcess,
    CefRefPtr<CefProcessMessage> message)
{
    const CefString name = message->GetName();

    CefRefPtr<CefListValue> args =
        message->GetArgumentList();

    if (name == "nativeweb.event")
    {
        const std::string eventName =
            args->GetString(0).ToString();

        CefRefPtr<CefValue> eventValue =
            args->GetValue(1);

        std::vector<EventSubscription> callbacks;

        for (std::map<std::string, EventSubscription>::const_iterator it =
                 subscriptions_.begin();
             it != subscriptions_.end();
             ++it)
        {
            if (it->second.eventName == eventName)
                callbacks.push_back(it->second);
        }

        for (std::size_t i = 0; i < callbacks.size(); ++i)
        {
            EventSubscription& subscription = callbacks[i];

            if (!subscription.context ||
                !subscription.callback ||
                !subscription.context->Enter())
            {
                continue;
            }

            CefV8ValueList callbackArgs;
            callbackArgs.push_back(
                cefValueToV8(eventValue));

            subscription.callback->ExecuteFunction(
                nullptr,
                callbackArgs);

            subscription.context->Exit();
        }

        return true;
    }

    if (name != "nativeweb.response")
        return false;

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
