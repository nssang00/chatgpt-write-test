#ifndef NATIVEWEB_BRIDGE_RUNTIME_HPP_INCLUDED
#define NATIVEWEB_BRIDGE_RUNTIME_HPP_INCLUDED

#include "core/bridge_message.hpp"
#include "core/event_dispatcher.hpp"
#include "core/pending_call_registry.hpp"
#include "nativeweb/detail/bind.hpp"

#include <future>
#include <map>
#include <mutex>
#include <string>

namespace nativeweb {
namespace detail {

class OutboundCall
{
public:
    OutboundCall(
        RequestId valueId,
        const Any& valueMessage,
        std::future<Any>& future)
        : id(valueId),
          message(valueMessage),
          result(std::move(future))
    {
    }

    OutboundCall(OutboundCall&& other)
        : id(other.id),
          message(other.message),
          result(std::move(other.result))
    {
        other.id = 0;
    }

    OutboundCall& operator=(OutboundCall&& other)
    {
        if (this != &other)
        {
            id = other.id;
            message = other.message;
            result = std::move(other.result);
            other.id = 0;
        }
        return *this;
    }

    OutboundCall(const OutboundCall&) = delete;
    OutboundCall& operator=(const OutboundCall&) = delete;

    RequestId id;
    Any message;
    std::future<Any> result;
};

class BridgeRuntime
{
public:
    BridgeRuntime();

    void bind(
        const std::string& method,
        const DynamicFunction& function);

    bool unbind(const std::string& method);
    bool hasMethod(const std::string& method) const;

    OutboundCall call(
        const std::string& method,
        const VariantList& args);

    EventSubscriptionId subscribe(
        const std::string& eventName,
        const EventCallback& callback);

    bool unsubscribe(EventSubscriptionId id);

    // Processes an incoming structured bridge envelope.
    // Request -> returns response/error envelope.
    // Response/Error/Event -> consumes it and returns empty Any.
    Any receive(const Any& message);

    Any eventMessage(
        const std::string& eventName,
        const Any& payload) const;

    void shutdown();

    std::size_t pendingCount() const;
    std::size_t methodCount() const;

private:
    DynamicFunction findMethod(const std::string& method) const;

    mutable std::mutex methodMutex_;
    std::map<std::string, DynamicFunction> methods_;

    PendingCallRegistry pending_;
    EventDispatcher events_;
};

} // namespace detail
} // namespace nativeweb

#endif
