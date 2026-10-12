#pragma once

#include <cito/detail/host_runtime_core.hpp>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <span>
#include <stdexcept>
#include <unordered_map>
#include <utility>
#include <vector>

namespace cito::detail {

using RequestId = std::uint64_t;
using HandlerToken = std::uint64_t;

struct RequestKey {
    ScopeId scope{};
    ResourceId resource{};
    TypeId request_type{};

    bool operator==(const RequestKey&) const noexcept = default;
};

struct RequestKeyHash {
    std::size_t operator()(const RequestKey& key) const noexcept {
        return InterestKeyHash{}(
            InterestKey{
                key.scope,
                key.resource,
                key.request_type});
    }
};

enum class RequestStatus : std::uint8_t {
    Ok = 0,
    Cancelled = 1,
    Unavailable = 2,
    InvalidArgument = 3,
    DeadlineExceeded = 4,
    Internal = 5
};

struct RequestStart {
    RequestId id{};
    AppId handler_app{};
    bool dispatched{false};
};

class RequestReplyCore {
public:
    using Completion =
        std::function<void(
            RequestStatus,
            std::span<const std::uint8_t>)>;

    using Reply =
        std::function<bool(
            RequestStatus,
            std::span<const std::uint8_t>)>;

    using Handler =
        std::function<void(
            RequestId,
            AppId,
            std::span<const std::uint8_t>,
            Reply)>;

private:
    struct HandlerEntry {
        HandlerToken token{};
        AppId app{};
        Handler handler;
    };

    struct HandlerLocator {
        RequestKey key{};
        AppId app{};
    };

    struct Pending {
        AppId requester_app{};
        AppId handler_app{};
        Completion completion;
    };

public:
    HandlerToken register_handler(
        AppId app,
        const RequestKey& key,
        Handler handler) {
        if (app == 0) {
            throw std::invalid_argument(
                "Cito request handler app id is zero");
        }

        if (!handler) {
            throw std::invalid_argument(
                "Cito request handler is empty");
        }

        const auto token =
            next_handler_token_++;

        handlers_[key].push_back(
            HandlerEntry{
                token,
                app,
                std::move(handler)});

        handler_locators_.emplace(
            token,
            HandlerLocator{
                key,
                app});

        return token;
    }

    bool unregister_handler(
        HandlerToken token) {
        const auto locator_it =
            handler_locators_.find(token);

        if (locator_it ==
            handler_locators_.end()) {
            return false;
        }

        const auto locator =
            locator_it->second;

        auto bucket_it =
            handlers_.find(
                locator.key);

        if (bucket_it != handlers_.end()) {
            auto& bucket =
                bucket_it->second;

            bucket.erase(
                std::remove_if(
                    bucket.begin(),
                    bucket.end(),
                    [token](
                        const HandlerEntry&
                            entry) {
                        return
                            entry.token ==
                            token;
                    }),
                bucket.end());

            if (bucket.empty()) {
                handlers_.erase(
                    bucket_it);
            }
        }

        handler_locators_.erase(
            locator_it);

        return true;
    }

    std::size_t unregister_app(
        AppId app) {
        std::vector<HandlerToken>
            tokens;

        for (const auto& [token, locator] :
             handler_locators_) {
            if (locator.app == app) {
                tokens.push_back(token);
            }
        }

        for (const auto token : tokens) {
            unregister_handler(token);
        }

        std::vector<RequestId>
            requester_pending;
        std::vector<RequestId>
            handler_pending;

        for (const auto& [id, pending] :
             pending_) {
            if (pending.requester_app == app) {
                requester_pending.push_back(
                    id);
            } else if (
                pending.handler_app == app) {
                handler_pending.push_back(
                    id);
            }
        }

        for (const auto id :
             requester_pending) {
            pending_.erase(id);
        }

        for (const auto id :
             handler_pending) {
            complete(
                id,
                RequestStatus::Unavailable,
                {});
        }

        return tokens.size();
    }

    bool has_handler(
        const RequestKey& key) const noexcept {
        const auto it =
            handlers_.find(key);

        return
            it != handlers_.end() &&
            !it->second.empty();
    }

    std::size_t handler_count(
        const RequestKey& key) const noexcept {
        const auto it =
            handlers_.find(key);

        return
            it == handlers_.end()
                ? 0
                : it->second.size();
    }

    RequestStart start(
        AppId requester_app,
        const RequestKey& key,
        std::span<const std::uint8_t>
            payload,
        Completion completion) {
        if (requester_app == 0) {
            throw std::invalid_argument(
                "Cito requester app id is zero");
        }

        if (!completion) {
            throw std::invalid_argument(
                "Cito request completion is empty");
        }

        const auto bucket_it =
            handlers_.find(key);

        if (
            bucket_it ==
                handlers_.end() ||
            bucket_it->second.empty()) {
            completion(
                RequestStatus::Unavailable,
                {});

            return {};
        }

        // v1 deterministic rule: first registered active handler wins.
        // Later load-balancing policy can replace selection without changing
        // Request/Reply correlation semantics.
        const auto selected =
            bucket_it->second.front();

        const auto id =
            next_request_id_++;

        pending_.emplace(
            id,
            Pending{
                requester_app,
                selected.app,
                std::move(completion)});

        auto handler =
            selected.handler;

        Reply reply =
            [this, id](
                RequestStatus status,
                std::span<
                    const std::uint8_t>
                    response) {
                return complete(
                    id,
                    status,
                    response);
            };

        try {
            handler(
                id,
                requester_app,
                payload,
                std::move(reply));
        } catch (...) {
            complete(
                id,
                RequestStatus::Internal,
                {});
        }

        return {
            id,
            selected.app,
            true};
    }

    bool complete(
        RequestId id,
        RequestStatus status,
        std::span<const std::uint8_t>
            payload) {
        const auto it =
            pending_.find(id);

        if (it == pending_.end()) {
            return false;
        }

        auto completion =
            std::move(
                it->second.completion);

        pending_.erase(it);

        completion(
            status,
            payload);

        return true;
    }

    bool cancel(
        RequestId id) {
        return complete(
            id,
            RequestStatus::Cancelled,
            {});
    }

    std::size_t pending_count()
        const noexcept {
        return pending_.size();
    }

    std::size_t handler_total()
        const noexcept {
        return handler_locators_.size();
    }

private:
    HandlerToken next_handler_token_{1};
    RequestId next_request_id_{1};

    std::unordered_map<
        RequestKey,
        std::vector<HandlerEntry>,
        RequestKeyHash> handlers_;

    std::unordered_map<
        HandlerToken,
        HandlerLocator>
        handler_locators_;

    std::unordered_map<
        RequestId,
        Pending> pending_;
};

} // namespace cito::detail
