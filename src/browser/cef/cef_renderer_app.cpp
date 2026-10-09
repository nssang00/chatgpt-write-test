#include "browser/cef/cef_renderer_app.hpp"

#include "browser/cef/cef_value_converter.hpp"
#include "include/cef_process_message.h"

#include <iostream>
#include <sstream>
#include <vector>

namespace nativeweb {
namespace detail {

namespace {

bool resolveDottedFunction(
    CefRefPtr<CefV8Context> context,
    const std::string& method,
    CefRefPtr<CefV8Value>& receiver,
    CefRefPtr<CefV8Value>& function)
{
    if (!context || method.empty())
        return false;

    CefRefPtr<CefV8Value> current = context->GetGlobal();
    std::size_t start = 0;

    while (start < method.size())
    {
        const std::size_t dot = method.find('.', start);
        const std::string part =
            method.substr(
                start,
                dot == std::string::npos
                    ? std::string::npos
                    : dot - start);

        if (part.empty() || !current || !current->IsObject())
            return false;

        CefRefPtr<CefV8Value> next =
            current->GetValue(part);

        if (dot == std::string::npos)
        {
            if (!next || !next->IsFunction())
                return false;

            receiver = current;
            function = next;
            return true;
        }

        current = next;
        start = dot + 1;
    }

    return false;
}

void sendCallError(
    CefRefPtr<CefFrame> frame,
    const std::string& id,
    const std::string& code,
    const std::string& message)
{
    CefRefPtr<CefProcessMessage> response =
        CefProcessMessage::Create("nativeweb.call.response");

    CefRefPtr<CefListValue> args =
        response->GetArgumentList();

    args->SetString(0, id);
    args->SetBool(1, false);
    args->SetString(2, code);
    args->SetString(3, message);

    frame->SendProcessMessage(PID_BROWSER, response);
}

void sendCallSuccess(
    CefRefPtr<CefFrame> frame,
    const std::string& id,
    CefRefPtr<CefValue> value)
{
    CefRefPtr<CefProcessMessage> response =
        CefProcessMessage::Create("nativeweb.call.response");

    CefRefPtr<CefListValue> args =
        response->GetArgumentList();

    args->SetString(0, id);
    args->SetBool(1, true);
    args->SetValue(2, value);

    frame->SendProcessMessage(PID_BROWSER, response);
}

std::string promiseRejectionMessage(
    CefRefPtr<CefV8Value> value)
{
    if (!value)
        return "JavaScript Promise rejected";

    if (value->IsString())
        return value->GetStringValue().ToString();

    if (value->IsObject() && value->HasValue("message"))
    {
        CefRefPtr<CefV8Value> message =
            value->GetValue("message");

        if (message && message->IsString())
            return message->GetStringValue().ToString();
    }

    return "JavaScript Promise rejected";
}

class CallPromiseHandler : public CefV8Handler
{
public:
    CallPromiseHandler(
        CefRefPtr<CefFrame> frame,
        const std::string& id,
        bool success)
        : frame_(frame),
          id_(id),
          success_(success)
    {
    }

    bool Execute(
        const CefString& name,
        CefRefPtr<CefV8Value> object,
        const CefV8ValueList& arguments,
        CefRefPtr<CefV8Value>& retval,
        CefString& exception) override
    {
        if (success_)
        {
            CefRefPtr<CefV8Value> value =
                arguments.empty()
                    ? CefV8Value::CreateNull()
                    : arguments[0];

            sendCallSuccess(
                frame_,
                id_,
                v8ToCefValue(value));
        }
        else
        {
            sendCallError(
                frame_,
                id_,
                "js_promise_rejected",
                promiseRejectionMessage(
                    arguments.empty()
                        ? nullptr
                        : arguments[0]));
        }

        retval = CefV8Value::CreateUndefined();
        return true;
    }

private:
    CefRefPtr<CefFrame> frame_;
    std::string id_;
    bool success_;

    IMPLEMENT_REFCOUNTING(CallPromiseHandler);
};

} // namespace

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

        if (name == "invoke" || name == "invokeRaw")
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

        if (name == "on" || name == "onRaw")
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

        if (name == "off" || name == "offRaw")
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

    CefRefPtr<CefV8Value> invokeRaw =
        CefV8Value::CreateFunction(
            "invokeRaw",
            handler);

    CefRefPtr<CefV8Value> onRaw =
        CefV8Value::CreateFunction(
            "onRaw",
            handler);

    CefRefPtr<CefV8Value> offRaw =
        CefV8Value::CreateFunction(
            "offRaw",
            handler);

    native->SetValue(
        "invokeRaw",
        invokeRaw,
        V8_PROPERTY_ATTRIBUTE_READONLY);

    native->SetValue(
        "onRaw",
        onRaw,
        V8_PROPERTY_ATTRIBUTE_READONLY);

    native->SetValue(
        "offRaw",
        offRaw,
        V8_PROPERTY_ATTRIBUTE_READONLY);

    global->SetValue(
        "native",
        native,
        V8_PROPERTY_ATTRIBUTE_READONLY);

    static const char kWrapperScript[] =
        "(function(native,global){"
        "const transportInvoke=native.invokeRaw;"
        "const invokeRaw=(...args)=>transportInvoke(...args).then((value)=>{"
        "if(value&&typeof value==='object'&&value.__nativeweb_error===true){"
        "const error=new Error(String(value.code||'native_error')+': '+"
        "String(value.message||'Native call failed'));"
        "error.code=String(value.code||'native_error');"
        "throw error;"
        "}"
        "return value;"
        "});"
        "const wrap=(value)=>{"
        "if(!value||typeof value!=='object')return value;"
        "if(value instanceof ArrayBuffer)return value;"
        "if(value.__nativeweb_object===true){"
        "const target={"
        "__nativeweb_object:true,"
        "id:String(value.id),"
        "type:String(value.type||'')"
        "};"
        "return new Proxy(target,{get(t,p){"
        "if(p==='then')return undefined;"
        "if(p==='__nativewebObjectId')return t.id;"
        "if(p==='__nativewebType')return t.type;"
        "if(p==='dispose')return ()=>"
        "invokeRaw('__native_object.release',t.id,t.type);"
        "if(p in t)return t[p];"
        "if(typeof p!=='string')return undefined;"
        "return (...args)=>invokeRaw("
        "'__native_object.call',t.id,t.type,p,...args"
        ").then(wrap);"
        "}});"
        "}"
        "if(Array.isArray(value))return value.map(wrap);"
        "for(const key of Object.keys(value)){"
        "value[key]=wrap(value[key]);"
        "}"
        "return value;"
        "};"
        "const invoke=(method,...args)=>"
        "invokeRaw(method,...args).then(wrap);"
        "native.invoke=invoke;"
        "native.on=(name,callback)=>"
        "native.onRaw(name,(payload)=>callback(wrap(payload)));"
        "native.off=(id)=>native.offRaw(id);"
        "const namespace=(path)=>new Proxy(function(){},{"
        "get(_target,property){"
        "if(property==='then')return undefined;"
        "if(path===''&&property==='invoke')return invoke;"
        "if(path===''&&property==='on')return native.on;"
        "if(path===''&&property==='off')return native.off;"
        "if(typeof property!=='string')return undefined;"
        "const next=path?path+'.'+property:property;"
        "return namespace(next);"
        "},"
        "apply(_target,_this,args){"
        "if(!path)throw new TypeError('xytron root is not callable');"
        "return invoke(path,...args);"
        "}"
        "});"
        "Object.defineProperty(global,'xytron',{"
        "value:namespace(''),"
        "writable:false,"
        "configurable:false,"
        "enumerable:true"
        "});"
        "})(native,globalThis);";

    CefRefPtr<CefV8Value> wrapperResult;
    CefRefPtr<CefV8Exception> wrapperException;

    context->Eval(
        kWrapperScript,
        frame ? frame->GetURL() : CefString(),
        0,
        wrapperResult,
        wrapperException);
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

    CefRefPtr<CefBrowser> browser =
        context ? context->GetBrowser() : nullptr;

    subscription.browserId =
        browser ? browser->GetIdentifier() : -1;

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

    if (name == "nativeweb.call")
    {
        const std::string id =
            args->GetString(0).ToString();

        const std::string method =
            args->GetString(1).ToString();

        CefRefPtr<CefListValue> cefArguments =
            args->GetList(2);

        CefRefPtr<CefV8Context> context =
            frame ? frame->GetV8Context() : nullptr;

        if (!context || !context->Enter())
        {
            sendCallError(
                frame,
                id,
                "js_context_unavailable",
                "JavaScript context is unavailable");
            return true;
        }

        CefRefPtr<CefV8Value> receiver;
        CefRefPtr<CefV8Value> function;

        if (!resolveDottedFunction(
                context,
                method,
                receiver,
                function))
        {
            context->Exit();
            sendCallError(
                frame,
                id,
                "js_method_not_found",
                "JavaScript method not found: " + method);
            return true;
        }

        CefV8ValueList callArguments;
        const std::size_t count =
            cefArguments ? cefArguments->GetSize() : 0;
        callArguments.reserve(count);

        for (std::size_t i = 0; i < count; ++i)
        {
            callArguments.push_back(
                cefValueToV8(
                    cefArguments->GetValue(i)));
        }

        CefRefPtr<CefV8Value> result =
            function->ExecuteFunction(
                receiver,
                callArguments);

        if (!result)
        {
            context->Exit();
            sendCallError(
                frame,
                id,
                "js_exception",
                "JavaScript method execution failed: " + method);
            return true;
        }

        if (result->IsPromise())
        {
            CefRefPtr<CefV8Value> thenFunction =
                result->GetValue("then");

            if (!thenFunction ||
                !thenFunction->IsFunction())
            {
                context->Exit();
                sendCallError(
                    frame,
                    id,
                    "js_promise_invalid",
                    "JavaScript Promise has no callable then()");
                return true;
            }

            CefV8ValueList thenArguments;
            thenArguments.push_back(
                CefV8Value::CreateFunction(
                    "__nativewebResolve",
                    new CallPromiseHandler(
                        frame,
                        id,
                        true)));

            thenArguments.push_back(
                CefV8Value::CreateFunction(
                    "__nativewebReject",
                    new CallPromiseHandler(
                        frame,
                        id,
                        false)));

            CefRefPtr<CefV8Value> chained =
                thenFunction->ExecuteFunction(
                    result,
                    thenArguments);

            if (!chained)
            {
                context->Exit();
                sendCallError(
                    frame,
                    id,
                    "js_promise_attach_failed",
                    "Failed to attach NativeWeb Promise handlers");
                return true;
            }

            context->Exit();
            return true;
        }

        CefRefPtr<CefValue> cefResult =
            v8ToCefValue(result);

        context->Exit();

        sendCallSuccess(
            frame,
            id,
            cefResult);

        return true;
    }

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
            if (it->second.eventName == eventName &&
                browser &&
                it->second.browserId ==
                    browser->GetIdentifier())
            {
                callbacks.push_back(it->second);
            }
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

        CefRefPtr<CefV8Value> errorValue =
            CefV8Value::CreateObject(
                nullptr,
                nullptr);

        errorValue->SetValue(
            "__nativeweb_error",
            CefV8Value::CreateBool(true),
            V8_PROPERTY_ATTRIBUTE_READONLY);

        errorValue->SetValue(
            "code",
            CefV8Value::CreateString(code),
            V8_PROPERTY_ATTRIBUTE_READONLY);

        errorValue->SetValue(
            "message",
            CefV8Value::CreateString(errorMessage),
            V8_PROPERTY_ATTRIBUTE_READONLY);

        pending.promise->ResolvePromise(
            errorValue);
    }

    pending.context->Exit();
    return true;
}

} // namespace detail
} // namespace nativeweb
