#pragma once

#include <algorithm>
#include <cstddef>
#include <functional>
#include <memory>
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

        std::size_t operator()(
            std::string_view value) const noexcept {
            return std::hash<std::string_view>{}(
                value);
        }

        std::size_t operator()(
            const std::string& value) const noexcept {
            return (*this)(
                std::string_view(value));
        }
    };

    struct Handler {
        std::size_t id{};
        bool active{true};
        std::function<void(const void*)> invoke;
    };

    using Bucket = std::vector<Handler>;
    using ResourceMap = std::unordered_map<
        std::string,
        Bucket,
        TransparentStringHash,
        std::equal_to<>>;

    struct Locator {
        std::type_index type{typeid(void)};
        std::string resource;
    };

    struct State {
        template <class T, class F>
        std::size_t add(
            std::string resource,
            F&& handler) {
            const auto id = next_id++;
            const auto type =
                std::type_index(typeid(T));

            auto& bucket =
                handlers[type][resource];

            bucket.push_back(
                Handler{
                    id,
                    true,
                    [fn =
                         std::function<void(const T&)>(
                             std::forward<F>(
                                 handler))](
                        const void* value) {
                        fn(
                            *static_cast<const T*>(
                                value));
                    }});

            locators.emplace(
                id,
                Locator{
                    type,
                    std::move(resource)});

            return id;
        }

        void remove(std::size_t id) {
            const auto locator =
                locators.find(id);

            if (locator == locators.end()) {
                return;
            }

            if (dispatch_depth == 0) {
                remove_now(id);
                return;
            }

            auto* handler =
                find_handler(
                    locator->second,
                    id);

            if (handler && handler->active) {
                handler->active = false;
                pending_removals.push_back(id);
            }
        }

        template <class T>
        std::size_t publish(
            std::string_view resource,
            const T& value) {
            const auto type =
                std::type_index(typeid(T));

            auto type_it =
                handlers.find(type);

            if (type_it == handlers.end()) {
                return 0;
            }

            auto resource_it =
                type_it->second.find(resource);

            if (resource_it ==
                type_it->second.end()) {
                return 0;
            }

            auto& bucket =
                resource_it->second;
            const auto initial_size =
                bucket.size();

            std::size_t delivered = 0;
            ++dispatch_depth;

            try {
                for (
                    std::size_t i = 0;
                    i < initial_size;
                    ++i) {
                    if (!bucket[i].active) {
                        continue;
                    }

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

        Handler* find_handler(
            const Locator& locator,
            std::size_t id) {
            auto type_it =
                handlers.find(locator.type);

            if (type_it == handlers.end()) {
                return nullptr;
            }

            auto resource_it =
                type_it->second.find(
                    locator.resource);

            if (resource_it ==
                type_it->second.end()) {
                return nullptr;
            }

            for (auto& handler :
                 resource_it->second) {
                if (handler.id == id) {
                    return &handler;
                }
            }

            return nullptr;
        }

        void remove_now(std::size_t id) {
            auto locator_it =
                locators.find(id);

            if (locator_it ==
                locators.end()) {
                return;
            }

            const auto locator =
                locator_it->second;

            auto type_it =
                handlers.find(locator.type);

            if (type_it != handlers.end()) {
                auto resource_it =
                    type_it->second.find(
                        locator.resource);

                if (resource_it !=
                    type_it->second.end()) {
                    auto& bucket =
                        resource_it->second;

                    bucket.erase(
                        std::remove_if(
                            bucket.begin(),
                            bucket.end(),
                            [id](
                                const Handler&
                                    handler) {
                                return
                                    handler.id ==
                                    id;
                            }),
                        bucket.end());

                    if (bucket.empty()) {
                        type_it->second.erase(
                            resource_it);
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

            if (dispatch_depth != 0) {
                return;
            }

            auto removals =
                std::move(pending_removals);
            pending_removals.clear();

            for (const auto id : removals) {
                remove_now(id);
            }
        }

        std::size_t next_id{1};
        std::size_t dispatch_depth{0};

        std::unordered_map<
            std::type_index,
            ResourceMap> handlers;

        std::unordered_map<
            std::size_t,
            Locator> locators;

        std::vector<std::size_t>
            pending_removals;
    };

public:
    Context()
        : state_(std::make_shared<State>()) {}

    explicit Context(std::string scope)
        : scope_(std::move(scope)),
          state_(std::make_shared<State>()) {}

    Context(const Context&) = delete;
    Context& operator=(const Context&) = delete;

    Context(Context&&) noexcept = default;
    Context& operator=(Context&&) noexcept =
        default;

    const std::string& scope() const noexcept {
        return scope_;
    }

    template <class T, class F>
    Subscription on(F&& handler) {
        return on<T>(
            "",
            std::forward<F>(handler));
    }

    template <class T, class F>
    Subscription on(
        std::string resource,
        F&& handler) {
        const auto id =
            state_->add<T>(
                std::move(resource),
                std::forward<F>(handler));

        std::weak_ptr<State> weak = state_;

        return Subscription(
            [weak = std::move(weak), id] {
                if (const auto state =
                        weak.lock()) {
                    state->remove(id);
                }
            });
    }

    template <class T>
    std::size_t publish(const T& value) {
        return publish("", value);
    }

    template <class T>
    std::size_t publish(
        std::string_view resource,
        const T& value) {
        return state_->publish(
            resource,
            value);
    }

    void run() noexcept {}

private:
    std::string scope_;
    std::shared_ptr<State> state_;
};

} // namespace cito
