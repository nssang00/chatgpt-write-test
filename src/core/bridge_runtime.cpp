#include "core/bridge_runtime.hpp"

#include "nativeweb/error.hpp"
#include "core/worker_pool.hpp"

#include <exception>
#include <iostream>

namespace nativeweb {
namespace detail {

namespace {

Any invokeBoundRequest(
    RequestId requestId,
    const std::string& method,
    const VariantList& args,
    const DynamicFunction& function)
{
    if (!function)
    {
        return makeErrorMessage(
            requestId,
            Error(
                "method_not_found",
                "NativeWeb method not found: " + method));
    }

    try
    {
        return makeResponseMessage(
            requestId,
            function(args));
    }
    catch (const Error& error)
    {
#if defined(_WIN32)
        std::cout
            << "checkpoint: bridge-caught-error code="
            << error.code()
            << std::endl;
#endif
        const Any response =
            makeErrorMessage(
                requestId,
                error);
#if defined(_WIN32)
        std::cout
            << "checkpoint: bridge-made-error-envelope"
            << std::endl;
#endif
        return response;
    }
    catch (const std::exception& error)
    {
        return makeErrorMessage(
            requestId,
            Error("native_exception", error.what()));
    }
    catch (...)
    {
        return makeErrorMessage(
            requestId,
            Error(
                "native_exception",
                "Unknown native exception"));
    }
}

} // namespace

BridgeRuntime::BridgeRuntime()
    : asyncState_(new AsyncDispatchState())
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
    PendingCall call =
        pending_.create();

    const Any message =
        makeRequestMessage(
            call.id,
            method,
            args);

    return OutboundCall(
        call.id,
        message,
        call.result);
}

OutboundRequest BridgeRuntime::callWithPending(
    const std::string& method,
    const VariantList& args,
    const std::shared_ptr<PendingResultBase>& result)
{
    const RequestId id =
        pending_.add(result);

    return OutboundRequest(
        id,
        makeRequestMessage(
            id,
            method,
            args));
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

    return invokeBoundRequest(
        parsed.requestId,
        parsed.method,
        parsed.args,
        findMethod(parsed.method));
}

void BridgeRuntime::receiveAsync(
    const Any& message,
    const BridgeResponseCallback& completion)
{
    const BridgeMessage parsed =
        parseBridgeMessage(message);

    if (parsed.type != BridgeMessageType::Request)
    {
        (void)receive(message);
        return;
    }

    const std::shared_ptr<AsyncDispatchState> state =
        asyncState_;

    if (!state || !state->active.load())
    {
        if (completion)
        {
            completion(
                makeErrorMessage(
                    parsed.requestId,
                    Error(
                        "runtime_stopped",
                        "NativeWeb runtime is shutting down")));
        }
        return;
    }

    const DynamicFunction function =
        findMethod(parsed.method);

    if (!function)
    {
        if (completion)
        {
            completion(
                makeErrorMessage(
                    parsed.requestId,
                    Error(
                        "method_not_found",
                        "NativeWeb method not found: " +
                            parsed.method)));
        }
        return;
    }

    const bool queued =
        defaultWorkerPool().post(
            [state,
             completion,
             function,
             parsed]() {
                if (!state->active.load())
                    return;

                const Any response =
                    invokeBoundRequest(
                        parsed.requestId,
                        parsed.method,
                        parsed.args,
                        function);

                if (state->active.load() &&
                    completion)
                {
                    completion(response);
                }
            });

    if (!queued && completion)
    {
        completion(
            makeErrorMessage(
                parsed.requestId,
                Error(
                    "queue_overloaded",
                    "NativeWeb worker queue is full or stopped")));
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
    if (asyncState_)
        asyncState_->active.store(false);

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
