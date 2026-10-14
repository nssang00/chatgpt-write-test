#pragma once

#include <cito/detail/embedded_host_runtime.hpp>
#include <cito/detail/request_session_lifecycle.hpp>

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>

namespace cito::detail {

struct MsQuicRequestSessionOptions {
    std::string registration_name{
        "cito-request"};
    bool skip_server_certificate_validation{
        false};
};

class MsQuicRequestSessionManager {
public:
    MsQuicRequestSessionManager(
        EmbeddedHostRuntime& runtime,
        RequestSessionLifecycleCore* lifecycle,
        MsQuicRequestSessionOptions options = {});

    ~MsQuicRequestSessionManager();

    MsQuicRequestSessionManager(
        const MsQuicRequestSessionManager&) =
        delete;
    MsQuicRequestSessionManager& operator=(
        const MsQuicRequestSessionManager&) =
        delete;

    MsQuicRequestSessionManager(
        MsQuicRequestSessionManager&&) noexcept;
    MsQuicRequestSessionManager& operator=(
        MsQuicRequestSessionManager&&) noexcept;

    bool start_listener(
        std::uint16_t port,
        const std::string& certificate_file,
        const std::string& private_key_file);

    void stop_listener();

    // Loop-owner entrypoint. Executes queued MsQuic completions and mutates
    // Cito request/discovery state only on the caller's thread.
    std::size_t poll(
        std::size_t max_events = 0);

    // Convert RequestSessionLifecycleCore actions into concrete MsQuic
    // connect/disconnect operations. Call from the same loop owner as poll().
    std::size_t reconcile();

    bool has_session(
        DestinationId destination)
        const noexcept;

    std::size_t session_count()
        const noexcept;

    std::size_t peer_count()
        const noexcept;

    std::size_t outstanding_send_count()
        const noexcept;

    std::size_t completed_send_count()
        const noexcept;

    std::uint16_t listen_port()
        const noexcept;

    void shutdown();

private:
    class Impl;
    std::unique_ptr<Impl> impl_;
};

} // namespace cito::detail
