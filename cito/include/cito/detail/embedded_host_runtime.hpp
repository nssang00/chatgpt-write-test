#pragma once

#include <cito/detail/host_runtime_core.hpp>

#include <atomic>
#include <memory>

#if defined(_WIN32)
#  if defined(CITO_CORE_BUILD)
#    define CITO_CORE_API __declspec(dllexport)
#  else
#    define CITO_CORE_API __declspec(dllimport)
#  endif
#else
#  define CITO_CORE_API __attribute__((visibility("default")))
#endif

namespace cito::detail {

class EmbeddedHostRuntime {
public:
    AppId allocate_app_id() noexcept {
        return next_app_id_.fetch_add(1, std::memory_order_relaxed);
    }

    HostRuntimeCore& host() noexcept { return host_; }
    const HostRuntimeCore& host() const noexcept { return host_; }

private:
    std::atomic<AppId> next_app_id_{1};
    HostRuntimeCore host_;
};

// Must be out-of-line so an executable and libcito share one registry.
CITO_CORE_API std::shared_ptr<EmbeddedHostRuntime>
acquire_embedded_host_runtime();

} // namespace cito::detail
