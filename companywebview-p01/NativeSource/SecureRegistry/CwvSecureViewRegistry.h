#pragma once
// CompanyWebView: isolated, platform-independent policy/queue core intended for
// a future native WebView2 adapter. NOT the native WebView2 implementation.
// Never derive observedSource or frameKind from JS packet contents: these MUST
// be obtained from browser-native message event metadata.
#include <cstddef>
#include <cstdint>
#include <deque>
#include <limits>
#include <mutex>
#include <string>
#include <unordered_map>
#include <utility>

namespace companywebview {

enum class FrameKind { Unknown, Main, Subframe };
enum class RegistryResult {
    Ok, UnknownHandle, Closed, NavigationSuspended, SourceMismatch,
    FrameNotAuthenticated, StaleGeneration, PayloadTooLarge, QueueFull, QueueEmpty,
    InvalidSource, HandleExhausted
};
struct RegistryMessage {
    std::uint64_t handle = 0;
    std::uint64_t generation = 0;
    std::string payload;
};

class SecureViewRegistry final {
public:
    explicit SecureViewRegistry(std::size_t maxQueue = 256,
                                std::size_t maxBytes = 65536)
        : maxQueue_(maxQueue), maxBytes_(maxBytes) {}
    SecureViewRegistry(const SecureViewRegistry&) = delete;
    SecureViewRegistry& operator=(const SecureViewRegistry&) = delete;

    // Returns 0 rather than reusing a handle when the counter is exhausted.
    // expectedSource is established by trusted native controller creation code.
    std::uint64_t Create(const std::string& expectedSource) {
        if (!IsValidSource(expectedSource)) return 0;
        std::lock_guard<std::mutex> lock(gate_);
        if (next_ == std::numeric_limits<std::uint64_t>::max()) return 0;
        const std::uint64_t id = ++next_;
        View view;
        view.expectedSource = expectedSource;
        views_.emplace(id, std::move(view));
        return id;
    }
    RegistryResult Admit(std::uint64_t handle, const std::string& observedSource,
                         FrameKind frame, std::uint64_t generation,
                         const std::string& payload) {
        std::lock_guard<std::mutex> lock(gate_);
        auto it = views_.find(handle);
        if (it == views_.end()) return RegistryResult::UnknownHandle;
        View& view = it->second;
        if (view.suspended) return RegistryResult::NavigationSuspended;
        if (generation != view.generation) return RegistryResult::StaleGeneration;
        if (frame != FrameKind::Main) return RegistryResult::FrameNotAuthenticated;
        if (observedSource != view.expectedSource) return RegistryResult::SourceMismatch;
        if (payload.size() > maxBytes_) return RegistryResult::PayloadTooLarge;
        if (view.queue.size() >= maxQueue_) return RegistryResult::QueueFull;
        view.queue.push_back({handle, generation, payload});
        return RegistryResult::Ok;
    }
    RegistryResult NavigationStarted(std::uint64_t handle) {
        std::lock_guard<std::mutex> lock(gate_);
        auto it = views_.find(handle);
        if (it == views_.end()) return RegistryResult::UnknownHandle;
        View& view = it->second;
        if (view.generation == std::numeric_limits<std::uint64_t>::max()) {
            views_.erase(it); return RegistryResult::Closed;
        }
        ++view.generation;
        view.suspended = true;
        view.queue.clear(); // prevents old document messages reaching the next page
        return RegistryResult::Ok;
    }
    // Only the controller's trusted main-frame navigation-completed handler may
    // call this. WebMessageReceived itself must not lift the suspension.
    RegistryResult NavigationCommitted(std::uint64_t handle,
                                       const std::string& observedSource,
                                       FrameKind frame) {
        std::lock_guard<std::mutex> lock(gate_);
        auto it = views_.find(handle);
        if (it == views_.end()) return RegistryResult::UnknownHandle;
        if (frame != FrameKind::Main) return RegistryResult::FrameNotAuthenticated;
        if (observedSource != it->second.expectedSource) return RegistryResult::SourceMismatch;
        it->second.suspended = false;
        return RegistryResult::Ok;
    }
    RegistryResult Pop(std::uint64_t handle, RegistryMessage& output) {
        std::lock_guard<std::mutex> lock(gate_);
        auto it = views_.find(handle);
        if (it == views_.end()) return RegistryResult::UnknownHandle;
        if (it->second.suspended) return RegistryResult::NavigationSuspended;
        if (it->second.queue.empty()) return RegistryResult::QueueEmpty;
        output = std::move(it->second.queue.front());
        it->second.queue.pop_front();
        return RegistryResult::Ok;
    }
    bool Close(std::uint64_t handle) {
        std::lock_guard<std::mutex> lock(gate_);
        return views_.erase(handle) == 1;
    }
    std::size_t Count() const {
        std::lock_guard<std::mutex> lock(gate_);
        return views_.size();
    }
    std::uint64_t Generation(std::uint64_t handle) const {
        std::lock_guard<std::mutex> lock(gate_);
        auto it = views_.find(handle);
        return it == views_.end() ? 0 : it->second.generation;
    }
private:
    static bool IsValidSource(const std::string& src) {
        // A native adapter establishes a canonical main-frame URL using the
        // tokenized C# local-asset server. Reject mixed/ambiguous host syntax,
        // invalid ports and URL control characters rather than normalizing.
        const std::string prefix = "http://127.0.0.1:";
        if (src.compare(0, prefix.size(), prefix) != 0) return false;
        if (src.find_first_of("\\#\r\n\t \0", 0, 6) != std::string::npos) return false;
        std::size_t p = prefix.size();
        const std::size_t slash = src.find('/', p);
        if (slash == std::string::npos || slash == p || slash - p > 5) return false;
        if (src[p] == '0') return false;
        unsigned port = 0;
        for (std::size_t i = p; i < slash; ++i) {
            if (src[i] < '0' || src[i] > '9') return false;
            port = port * 10 + static_cast<unsigned>(src[i] - '0');
        }
        if (port == 0 || port > 65535) return false;
        const std::size_t token = slash + 1;
        if (token + 48 >= src.size() || src[token + 48] != '/') return false;
        for (std::size_t i = token; i < token + 48; ++i) {
            const char c = src[i];
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
        }
        return true;
    }
    struct View {
        std::string expectedSource;
        std::uint64_t generation = 1;
        bool suspended = false;
        std::deque<RegistryMessage> queue;
    };
    mutable std::mutex gate_;
    std::unordered_map<std::uint64_t, View> views_;
    std::uint64_t next_ = 0;
    const std::size_t maxQueue_;
    const std::size_t maxBytes_;
};
} // namespace companywebview
