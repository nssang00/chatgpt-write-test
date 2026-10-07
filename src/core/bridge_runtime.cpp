#include "core/bridge_runtime.hpp"

#include "nativeweb/error.hpp"

#include <exception>

namespace nativeweb {
namespace detail {

BridgeRuntime::BridgeRuntime()
{
}

void BridgeRuntime::bind(
    const std::string& method,
    const DynamicFunction& function)
{
    if (method.empty())
        throw Error("invalid_method", "NativeWeb method name cannot be empty");

    if (!function)
        throw Error("invalid_method", "NativeWeb method callback is empty");

    std::lock_guard<std::mutex> lock(methodMutex_);
    methods_[method] = function;
}

bool BridgeRuntime::unbind(const std::string& method)
{
    std::lock_guard<std::mutex> lock(methodMutex_);
    return methods_.erase(method) != 0;
}

bool BridgeRuntime::hasMethod(const std::string& method) const
{
    std::lock_guard<std::mutex> lock(methodMutex_);
    return methods_.find(method) != methods_.end();
}

DynamicFunction BridgeRuntime::findMethod(
    const std::string& method) const
{
    std::lock_guard<std::mutex> lock(methodMutex_);

    std::map<std::string, DynamicFunction>::const_iterator found =
        methods_.find(method);

    if (found == methods_.end())
        return DynamicFunction();

    return found->second;
}

OutboundCall BridgeRuntime::call(
    const std::string& method,
    const VariantList& args)
{
    PendingCall call = pending_.create();
    const Any message =
        makeRequestMessage(call.id, method, args);

    return OutboundCall(
        call.id,
        message,
        call.result);
}

EventSubscriptionId BridgeRuntime::subscribe(
    const std::string& eventName,
    const EventCallback& callback)
{
    return events_.subscribe(eventName, callback);
}

bool BridgeRuntime::unsubscribe(EventSubscriptionId id)
{
    return events_.unsubscribe(id);
}

Any BridgeRuntime::receive(const Any& message)
{
    const BridgeMessage parsed =
        parseBridgeMessage(message);

    if (parsed.type == BridgeMessageType::Response)
    {
        pending_.resolve(parsed.requestId, parsed.value);
        return Any();
    }

    if (parsed.type == BridgeMessageType::Error)
    {
        pending_.reject(
            parsed.requestId,
            Error(parsed.errorCode, parsed.errorMessage));
        return Any();
    }

    if (parsed.type == BridgeMessageType::Event)
    {
        events_.emit(parsed.eventName, parsed.value);
        return Any();
    }

    const DynamicFunction function =
        findMethod(parsed.method);

    if (!function)
    {
        return makeErrorMessage(
            parsed.requestId,
            Error(
                "method_not_found",
                "NativeWeb method not found: " + parsed.method));
    }

    try
    {
        return makeResponseMessage(
            parsed.requestId,
            function(parsed.args));
    }
    catch (const Error& error)
    {
        return makeErrorMessage(
            parsed.requestId,
            error);
    }
    catch (const std::exception& error)
    {
        return makeErrorMessage(
            parsed.requestId,
            Error("native_exception", error.what()));
    }
    catch (...)
    {
        return makeErrorMessage(
            parsed.requestId,
            Error(
                "native_exception",
                "Unknown native exception"));
    }
}

Any BridgeRuntime::eventMessage(
    const std::string& eventName,
    const Any& payload) const
{
    return makeEventMessage(eventName, payload);
}

void BridgeRuntime::shutdown()
{
    pending_.rejectAll(
        Error(
            "webview_destroyed",
            "WebView was destroyed before the call completed"));

    events_.clear();

    std::lock_guard<std::mutex> lock(methodMutex_);
    methods_.clear();
}

std::size_t BridgeRuntime::pendingCount() const
{
    return pending_.size();
}

std::size_t BridgeRuntime::methodCount() const
{
    std::lock_guard<std::mutex> lock(methodMutex_);
    return methods_.size();
}

} // namespace detail
} // namespace nativeweb
