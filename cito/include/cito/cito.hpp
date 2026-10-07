#pragma once

#include <algorithm>
#include <cstddef>
#include <functional>
#include <string>
#include <typeindex>
#include <utility>
#include <vector>

namespace cito {

class Subscription {
public:
    Subscription() = default;
    explicit Subscription(std::function<void()> close) : close_(std::move(close)) {}
    Subscription(const Subscription&) = delete;
    Subscription& operator=(const Subscription&) = delete;
    Subscription(Subscription&& other) noexcept : close_(std::move(other.close_)) {}
    Subscription& operator=(Subscription&& other) noexcept {
        if (this != &other) {
            close();
            close_ = std::move(other.close_);
        }
        return *this;
    }
    ~Subscription() { close(); }

    void close() {
        if (close_) {
            auto fn = std::move(close_);
            fn();
        }
    }

private:
    std::function<void()> close_;
};

class Context {
public:
    Context() = default;
    explicit Context(std::string scope) : scope_(std::move(scope)) {}

    const std::string& scope() const noexcept { return scope_; }

    template <class T, class F>
    Subscription on(F&& handler) {
        return on<T>("", std::forward<F>(handler));
    }

    template <class T, class F>
    Subscription on(std::string resource, F&& handler) {
        const auto id = next_id_++;
        Handler entry;
        entry.id = id;
        entry.type = std::type_index(typeid(T));
        entry.resource = std::move(resource);
        entry.invoke = [fn = std::function<void(const T&)>(std::forward<F>(handler))](const void* value) {
            fn(*static_cast<const T*>(value));
        };
        handlers_.push_back(std::move(entry));
        return Subscription([this, id] { remove(id); });
    }

    template <class T>
    std::size_t publish(const T& value) {
        return publish("", value);
    }

    template <class T>
    std::size_t publish(const std::string& resource, const T& value) {
        const auto type = std::type_index(typeid(T));
        std::size_t delivered = 0;
        std::vector<std::size_t> matches;
        matches.reserve(handlers_.size());

        for (const auto& handler : handlers_) {
            if (handler.type == type && handler.resource == resource) {
                matches.push_back(handler.id);
            }
        }

        for (const auto id : matches) {
            auto it = std::find_if(
                handlers_.begin(),
                handlers_.end(),
                [id](const Handler& h) { return h.id == id; });

            if (it != handlers_.end()) {
                it->invoke(&value);
                ++delivered;
            }
        }

        return delivered;
    }

    void run() noexcept {}

private:
    struct Handler {
        std::size_t id{};
        std::type_index type{typeid(void)};
        std::string resource;
        std::function<void(const void*)> invoke;
    };

    void remove(std::size_t id) {
        handlers_.erase(
            std::remove_if(
                handlers_.begin(),
                handlers_.end(),
                [id](const Handler& h) { return h.id == id; }),
            handlers_.end());
    }

    std::string scope_;
    std::size_t next_id_{1};
    std::vector<Handler> handlers_;
};

} // namespace cito
