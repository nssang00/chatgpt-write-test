#pragma once

#include <cito/detail/embedded_host_runtime.hpp>
#include <cito/identity.hpp>
#include <cito/static.hpp>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>
#include <typeindex>
#include <unordered_map>
#include <utility>
#include <vector>

namespace cito {

class Subscription {
public:
    Subscription() = default;

    explicit Subscription(
        std::function<void()> close)
        : close_(std::move(close)) {}

    Subscription(const Subscription&) = delete;
    Subscription& operator=(
        const Subscription&) = delete;

    Subscription(
        Subscription&& other) noexcept
        : close_(std::move(other.close_)) {}

    Subscription& operator=(
        Subscription&& other) noexcept {
        if (this != &other) {
            close();
            close_ = std::move(other.close_);
        }
        return *this;
    }

    ~Subscription() {
        close();
    }

    void close() {
        if (!close_) return;
        auto fn = std::move(close_);
        fn();
    }

private:
    std::function<void()> close_;
};

class Context {
private:
    struct TransparentStringHash {
        using is_transparent = void;
        std::size_t operator()(std::string_view value) const noexcept {
            return std::hash<std::string_view>{}(value);
        }
        std::size_t operator()(const std::string& value) const noexcept {
            return (*this)(std::string_view(value));
        }
    };

    struct Handler {
        std::size_t id{};
        bool active{true};
        std::function<void(const void*)> invoke;
    };

    using Bucket = std::vector<Handler>;
    using ResourceMap = std::unordered_map<
        std::string, Bucket, TransparentStringHash, std::equal_to<>>;

    struct WireRoute {
        std::size_t count{0};
        std::function<std::size_t(std::span<const std::uint8_t>)> deliver;
    };

    using WireResourceMap = std::unordered_map<
        std::string, WireRoute, TransparentStringHash, std::equal_to<>>;

    struct Locator {
        std::type_index type{typeid(void)};
        std::string resource;
        bool wire_enabled{false};
        TypeId wire_type{};
        InterestKey wire_key{};
    };

    struct State {
        static std::shared_ptr<State> create(std::string_view scope) {
            auto state = std::shared_ptr<State>(new State(scope));
            std::weak_ptr<State> weak = state;

            const auto registered = state->runtime_->host().register_app(
                state->app_id_,
                [weak](
                    TypeId type_id,
                    std::string_view resource,
                    std::span<const std::uint8_t> payload) {
                    if (const auto locked = weak.lock()) {
                        return locked->deliver_wire(type_id, resource, payload);
                    }
                    return std::size_t{0};
                });

            if (!registered) {
                throw std::logic_error("Cito Context app registration failed");
            }

            state->registered_ = true;
            return state;
        }

        ~State() {
            if (registered_) {
                runtime_->host().unregister_app(app_id_);
            }
        }

        template <class T, class F>
        std::size_t add(std::string resource, F&& handler) {
            const auto id = next_id++;
            const auto type = std::type_index(typeid(T));
            auto& bucket = handlers[type][resource];

            bucket.push_back(Handler{
                id,
                true,
                [fn = std::function<void(const T&)>(
                    std::forward<F>(handler))](const void* value) {
                    fn(*static_cast<const T*>(value));
                }});

            locators.emplace(id, Locator{
                type, std::move(resource), false, 0, {}});

            if constexpr (StaticCodec<T>::direct) {
                try {
                    enable_wire<T>(id);
                } catch (...) {
                    remove_now(id);
                    throw;
                }
            }

            return id;
        }

        void remove(std::size_t id) {
            const auto locator = locators.find(id);
            if (locator == locators.end()) return;

            disable_wire(locator->second);

            if (dispatch_depth == 0) {
                remove_now(id);
                return;
            }

            auto* handler = find_handler(locator->second, id);
            if (handler && handler->active) {
                handler->active = false;
                pending_removals.push_back(id);
            }
        }

        template <class T>
        std::size_t publish(std::string_view resource, const T& value) {
            auto delivered = publish_local(resource, value);

            if constexpr (StaticCodec<T>::direct) {
                const auto key = make_key(
                    static_type_ref<T>().type_id(), resource);
                auto& host = runtime_->host();

                if (!host.has_demand_except(app_id_, key)) {
                    return delivered;
                }

                const auto payload = StaticCodec<T>::encode(value);
                const auto result = host.publish_from(
                    app_id_,
                    key,
                    resource,
                    std::span<const std::uint8_t>(
                        payload.data(), payload.size()),
                    [](DestinationId, std::span<const std::uint8_t>) {
                        // Public Context transport attachment is a later step.
                        return false;
                    });

                delivered += result.delivered();
            }

            return delivered;
        }

    private:
        explicit State(std::string_view scope)
            : scope_id_(stable_name_id(scope)),
              runtime_(detail::acquire_embedded_host_runtime()),
              app_id_(runtime_->allocate_app_id()) {}

        InterestKey make_key(
            TypeId type_id,
            std::string_view resource) const noexcept {
            return {
                scope_id_,
                stable_name_id(resource),
                type_id};
        }

        template <class T>
        void enable_wire(std::size_t id) {
            auto locator_it = locators.find(id);
            if (locator_it == locators.end()) {
                throw std::logic_error("Cito subscription locator missing");
            }

            auto& locator = locator_it->second;
            const auto type_id = static_type_ref<T>().type_id();
            auto& resources = wire_routes[type_id];
            auto [route_it, inserted] =
                resources.try_emplace(locator.resource);
            auto& route = route_it->second;

            if (inserted) {
                const auto resource = locator.resource;
                route.deliver =
                    [this, resource](std::span<const std::uint8_t> payload) {
                        const auto value = StaticCodec<T>::decode(payload);
                        return publish_local(resource, value);
                    };
            }

            ++route.count;
            const auto key = make_key(type_id, locator.resource);

            try {
                const auto change =
                    runtime_->host().add_interest(app_id_, key);
                if (!change.changed) {
                    throw std::logic_error(
                        "Cito host interest registration failed");
                }
            } catch (...) {
                if (--route.count == 0) resources.erase(route_it);
                if (resources.empty()) wire_routes.erase(type_id);
                throw;
            }

            locator.wire_enabled = true;
            locator.wire_type = type_id;
            locator.wire_key = key;
        }

        void disable_wire(Locator& locator) {
            if (!locator.wire_enabled) return;

            runtime_->host().remove_interest(app_id_, locator.wire_key);

            auto type_it = wire_routes.find(locator.wire_type);
            if (type_it != wire_routes.end()) {
                auto resource_it =
                    type_it->second.find(locator.resource);

                if (resource_it != type_it->second.end()) {
                    if (
                        resource_it->second.count > 0 &&
                        --resource_it->second.count == 0) {
                        type_it->second.erase(resource_it);
                    }
                }

                if (type_it->second.empty()) {
                    wire_routes.erase(type_it);
                }
            }

            locator.wire_enabled = false;
        }

        std::size_t deliver_wire(
            TypeId type_id,
            std::string_view resource,
            std::span<const std::uint8_t> payload) {
            const auto type_it = wire_routes.find(type_id);
            if (type_it == wire_routes.end()) return 0;

            const auto resource_it = type_it->second.find(resource);
            if (
                resource_it == type_it->second.end() ||
                !resource_it->second.deliver) {
                return 0;
            }

            // Copy so a callback may close its final subscription safely.
            auto deliver = resource_it->second.deliver;
            return deliver(payload);
        }

        template <class T>
        std::size_t publish_local(
            std::string_view resource,
            const T& value) {
            const auto type = std::type_index(typeid(T));
            auto type_it = handlers.find(type);
            if (type_it == handlers.end()) return 0;

            auto resource_it = type_it->second.find(resource);
            if (resource_it == type_it->second.end()) return 0;

            auto& bucket = resource_it->second;
            const auto initial_size = bucket.size();

            std::size_t delivered = 0;
            ++dispatch_depth;

            try {
                for (std::size_t i = 0; i < initial_size; ++i) {
                    if (!bucket[i].active) continue;
                    bucket[i].invoke(&value);
                    ++delivered;
                }
            } catch (...) {
                finish_dispatch();
                throw;
            }

            finish_dispatch();
            return delivered;
        }

        Handler* find_handler(const Locator& locator, std::size_t id) {
            auto type_it = handlers.find(locator.type);
            if (type_it == handlers.end()) return nullptr;

            auto resource_it =
                type_it->second.find(locator.resource);
            if (resource_it == type_it->second.end()) return nullptr;

            for (auto& handler : resource_it->second) {
                if (handler.id == id) return &handler;
            }
            return nullptr;
        }

        void remove_now(std::size_t id) {
            auto locator_it = locators.find(id);
            if (locator_it == locators.end()) return;

            disable_wire(locator_it->second);
            const auto locator = locator_it->second;

            auto type_it = handlers.find(locator.type);
            if (type_it != handlers.end()) {
                auto resource_it =
                    type_it->second.find(locator.resource);

                if (resource_it != type_it->second.end()) {
                    auto& bucket = resource_it->second;
                    bucket.erase(
                        std::remove_if(
                            bucket.begin(),
                            bucket.end(),
                            [id](const Handler& handler) {
                                return handler.id == id;
                            }),
                        bucket.end());

                    if (bucket.empty()) {
                        type_it->second.erase(resource_it);
                    }
                }

                if (type_it->second.empty()) {
                    handlers.erase(type_it);
                }
            }

            locators.erase(locator_it);
        }

        void finish_dispatch() {
            --dispatch_depth;
            if (dispatch_depth != 0) return;

            auto removals = std::move(pending_removals);
            pending_removals.clear();

            for (const auto id : removals) {
                remove_now(id);
            }
        }

        ScopeId scope_id_{};
        std::shared_ptr<detail::EmbeddedHostRuntime> runtime_;
        detail::AppId app_id_{};
        bool registered_{false};

        std::size_t next_id{1};
        std::size_t dispatch_depth{0};

        std::unordered_map<std::type_index, ResourceMap> handlers;
        std::unordered_map<TypeId, WireResourceMap> wire_routes;
        std::unordered_map<std::size_t, Locator> locators;
        std::vector<std::size_t> pending_removals;
    };

public:
    Context() : Context(std::string{}) {}

    explicit Context(std::string scope)
        : scope_(std::move(scope)),
          state_(State::create(scope_)) {}

    Context(const Context&) = delete;
    Context& operator=(const Context&) = delete;
    Context(Context&&) noexcept = default;
    Context& operator=(Context&&) noexcept = default;

    const std::string& scope() const noexcept {
        return scope_;
    }

    template <class T, class F>
    Subscription subscribe(F&& handler) {
        return subscribe<T>("", std::forward<F>(handler));
    }

    template <class T, class F>
    Subscription subscribe(std::string resource, F&& handler) {
        const auto id = state_->add<T>(
            std::move(resource), std::forward<F>(handler));
        std::weak_ptr<State> weak = state_;

        return Subscription(
            [weak = std::move(weak), id] {
                if (const auto state = weak.lock()) {
                    state->remove(id);
                }
            });
    }

    // Compatibility alias. New Cito code should use subscribe().
    template <class T, class F>
    Subscription on(F&& handler) {
        return subscribe<T>(std::forward<F>(handler));
    }

    // Compatibility alias. New Cito code should use subscribe().
    template <class T, class F>
    Subscription on(std::string resource, F&& handler) {
        return subscribe<T>(
            std::move(resource), std::forward<F>(handler));
    }

    template <class T>
    std::size_t publish(const T& value) {
        return publish("", value);
    }

    template <class T>
    std::size_t publish(
        std::string_view resource,
        const T& value) {
        return state_->publish(resource, value);
    }

    void run() noexcept {}

private:
    std::string scope_;
    std::shared_ptr<State> state_;
};

} // namespace cito
