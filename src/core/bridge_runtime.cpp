#include "core/bridge_runtime.hpp"

#include "nativeweb/error.hpp"
#include "core/worker_pool.hpp"

#include <exception>

namespace nativeweb {
namespace detail {

namespace {

Any invokeBoundRequest(
    RequestId requestId,
    const std::string& method,
    const VariantList& args,
    const Callable& function)
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
            function.invoke(args));
    }
    catch (const Error& error)
    {
        return makeErrorMessage(
            requestId,
            error);
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
    bindings_.bind(
        method,
        Callable(function));
}

void BridgeRuntime::bind(
    const std::string& method,
    const Callable& callable)
{
    bindings_.bind(
        method,
        callable);
}

RegistrationToken BridgeRuntime::registerBinding(
    const std::string& method,
    const Callable& callable)
{
    return bindings_.registerBinding(
        method,
        callable);
}

bool BridgeRuntime::unbind(const std::string& method)
{
    return bindings_.unbind(method);
}

bool BridgeRuntime::hasMethod(const std::string& method) const
{
    return bindings_.has(method);
}

bool BridgeRuntime::methodSignature(
    const std::string& method,
    CallableSignature* signature) const
{
    return bindings_.signature(
        method,
        signature);
}

Callable BridgeRuntime::findMethod(
    const std::string& method) const
{
    return bindings_.find(method);
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

    const Callable function =
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

    bindings_.clear();
}

std::size_t BridgeRuntime::pendingCount() const
{
    return pending_.size();
}

std::size_t BridgeRuntime::methodCount() const
{
    return bindings_.size();
}

} // namespace detail
} // namespace nativeweb
