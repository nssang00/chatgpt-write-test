#pragma once

#include <cito/detail/host_runtime_core.hpp>

#include <atomic>
#include <memory>
#include <mutex>

namespace cito::detail {

class EmbeddedHostRuntime {
public:
    AppId allocate_app_id() noexcept {
        return next_app_id_.fetch_add(
            1,
            std::memory_order_relaxed);
    }

    HostRuntimeCore& host() noexcept {
        return host_;
    }

    const HostRuntimeCore& host()
        const noexcept {
        return host_;
    }

private:
    std::atomic<AppId> next_app_id_{1};
    HostRuntimeCore host_;
};

inline std::shared_ptr<
    EmbeddedHostRuntime>
acquire_embedded_host_runtime() {
    static std::mutex registry_mutex;
    static std::weak_ptr<
        EmbeddedHostRuntime> weak;

    std::lock_guard<std::mutex>
        lock(registry_mutex);

    auto runtime = weak.lock();

    if (!runtime) {
        runtime =
            std::make_shared<
                EmbeddedHostRuntime>();
        weak = runtime;
    }

    return runtime;
}

} // namespace cito::detail
