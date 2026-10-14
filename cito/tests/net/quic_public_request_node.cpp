#include <cito/cito.hpp>
#include <cito/detail/msquic_request_session_manager.hpp>
#include <cito/detail/request_session_lifecycle.hpp>
#include <cito/detail/udp_runtime_adapter.hpp>

#include <array>
#include <cassert>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <functional>
#include <iostream>
#include <span>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

struct NetPing {
    std::uint32_t value{};
};

struct NetPong {
    std::uint32_t value{};
};

namespace cito {

template <>
struct StaticType<NetPing> {
    static Type type() {
        return TypeBuilder(
            "tests.NetPing")
            .member<std::uint32_t>(
                1,
                "value")
            .build();
    }
};

template <>
struct StaticType<NetPong> {
    static Type type() {
        return TypeBuilder(
            "tests.NetPong")
            .member<std::uint32_t>(
                1,
                "value")
            .build();
    }
};

template <>
struct ReplyType<NetPing> {
    using type = NetPong;
};

template <>
struct StaticCodec<NetPing> {
    static constexpr bool direct = true;

    static std::vector<std::uint8_t>
    encode(const NetPing& value) {
        return {
            static_cast<std::uint8_t>(
                value.value & 0xffu),
            static_cast<std::uint8_t>(
                (value.value >> 8) &
                0xffu),
            static_cast<std::uint8_t>(
                (value.value >> 16) &
                0xffu),
            static_cast<std::uint8_t>(
                (value.value >> 24) &
                0xffu)};
    }

    static NetPing decode(
        std::span<const std::uint8_t>
            bytes) {
        if (bytes.size() != 4) {
            throw std::invalid_argument(
                "bad NetPing");
        }

        return NetPing{
            static_cast<std::uint32_t>(
                bytes[0]) |
            (static_cast<std::uint32_t>(
                 bytes[1]) << 8) |
            (static_cast<std::uint32_t>(
                 bytes[2]) << 16) |
            (static_cast<std::uint32_t>(
                 bytes[3]) << 24)};
    }
};

template <>
struct StaticCodec<NetPong> {
    static constexpr bool direct = true;

    static std::vector<std::uint8_t>
    encode(const NetPong& value) {
        return {
            static_cast<std::uint8_t>(
                value.value & 0xffu),
            static_cast<std::uint8_t>(
                (value.value >> 8) &
                0xffu),
            static_cast<std::uint8_t>(
                (value.value >> 16) &
                0xffu),
            static_cast<std::uint8_t>(
                (value.value >> 24) &
                0xffu)};
    }

    static NetPong decode(
        std::span<const std::uint8_t>
            bytes) {
        if (bytes.size() != 4) {
            throw std::invalid_argument(
                "bad NetPong");
        }

        return NetPong{
            static_cast<std::uint32_t>(
                bytes[0]) |
            (static_cast<std::uint32_t>(
                 bytes[1]) << 8) |
            (static_cast<std::uint32_t>(
                 bytes[2]) << 16) |
            (static_cast<std::uint32_t>(
                 bytes[3]) << 24)};
    }
};

} // namespace cito

namespace {

using Clock =
    std::chrono::steady_clock;

cito::detail::RequestKey
request_key() {
    return {
        cito::stable_name_id(
            "acme"),
        cito::stable_name_id(
            "robot_1"),
        cito::static_type_ref<
            NetPing>()
            .type_id()};
}

std::uint32_t parse_ipv4(
    const std::string& text) {
    unsigned a = 0;
    unsigned b = 0;
    unsigned c = 0;
    unsigned d = 0;

    if (
        std::sscanf(
            text.c_str(),
            "%u.%u.%u.%u",
            &a,
            &b,
            &c,
            &d) != 4 ||
        a > 255 ||
        b > 255 ||
        c > 255 ||
        d > 255) {
        throw std::invalid_argument(
            "invalid IPv4 address");
    }

    return
        (a << 24) |
        (b << 16) |
        (c << 8) |
        d;
}

bool spin(
    cito::detail::
        MsQuicRequestSessionManager&
        manager,
    const std::function<bool()>& done,
    std::chrono::milliseconds timeout) {
    const auto deadline =
        Clock::now() + timeout;

    while (
        Clock::now() < deadline) {
        manager.poll();

        if (done()) {
            return true;
        }

        std::this_thread::sleep_for(
            std::chrono::
                milliseconds(1));
    }

    manager.poll();
    return done();
}

bool seed_remote_route(
    cito::detail::EmbeddedHostRuntime&
        runtime,
    cito::detail::UdpRuntimeAdapter&
        requester_udp,
    std::uint32_t provider_ipv4,
    std::uint16_t quic_port) {
    using namespace cito::detail;

    const auto key =
        request_key();
    const auto capability =
        request_handler_interest_key(
            key);

    HostRuntimeCore provider_host;

    if (!provider_host.register_app(
            1,
            [](auto, auto, auto) {
                return std::size_t{0};
            })) {
        return false;
    }

    provider_host.add_interest(
        1,
        capability);

    UdpRuntimeAdapter provider_udp(
        provider_host,
        50,
        5001);

    const std::array<
        cito::RouteEndpoint,
        1> endpoints{{
            {77, 0, quic_port}}};

    provider_udp
        .set_local_route_endpoints(
            endpoints);

    const UdpEndpoint
        provider_source{
            provider_ipv4,
            47010};

    const UdpEndpoint
        requester_source{
            0x0aca000bu,
            47020};

    auto sends =
        requester_udp
            .process_control(
                provider_udp
                    .announcement(
                        47010,
                        5000),
                provider_source,
                1000);

    if (sends.size() != 1) {
        return false;
    }

    auto replies =
        provider_udp.process_control(
            sends[0].bytes,
            requester_source,
            1000);

    if (replies.size() != 1) {
        return false;
    }

    sends =
        requester_udp
            .process_control(
                replies[0].bytes,
                provider_source,
                1000);

    if (!sends.empty()) {
        return false;
    }

    sends =
        requester_udp
            .ensure_routes(
                capability);

    if (sends.size() != 1) {
        return false;
    }

    replies =
        provider_udp.process_control(
            sends[0].bytes,
            requester_source,
            1000);

    if (replies.size() != 1) {
        return false;
    }

    sends =
        requester_udp
            .process_control(
                replies[0].bytes,
                provider_source,
                1000);

    if (!sends.empty()) {
        return false;
    }

    const auto* endpoint =
        requester_udp
            .quic_endpoint(
                77);

    return
        endpoint &&
        endpoint->ipv4 ==
            provider_ipv4 &&
        endpoint->port ==
            quic_port &&
        runtime.host()
            .remote_destinations(
                capability)
            .contains(77);
}

int run_server(
    std::uint16_t port,
    const std::string& cert,
    const std::string& key) {
    using namespace cito::detail;

    auto runtime =
        acquire_embedded_host_runtime();

    MsQuicRequestSessionManager
        manager(
            *runtime,
            nullptr);

    if (!manager.start_listener(
            port,
            cert,
            key)) {
        return 10;
    }

    cito::Context provider(
        "acme");

    int handler_calls = 0;

    provider.handle<NetPing>(
        "robot_1",
        [&](const NetPing& ping) {
            ++handler_calls;
            return NetPong{
                ping.value + 1};
        });

    const bool replied =
        spin(
            manager,
            [&] {
                return
                    handler_calls == 1 &&
                    manager
                        .completed_send_count() >=
                    1;
            },
            std::chrono::
                seconds(8));

    if (!replied) {
        return 11;
    }

    const bool peer_closed =
        spin(
            manager,
            [&] {
                return
                    manager.peer_count() ==
                    0;
            },
            std::chrono::
                seconds(4));

    if (!peer_closed) {
        return 12;
    }

    std::cout
        << "quic_public_request_server handler=1 reply=1"
        << std::endl;

    manager.shutdown();
    return 0;
}

int run_client(
    const std::string& host,
    std::uint16_t port) {
    using namespace cito::detail;

    auto runtime =
        acquire_embedded_host_runtime();

    UdpRuntimeAdapter routes(
        runtime->host(),
        20,
        2001);

    RequestSessionLifecycleCore
        lifecycle(
            runtime->host(),
            routes);

    MsQuicRequestSessionManager
        manager(
            *runtime,
            &lifecycle,
            MsQuicRequestSessionOptions{
                "cito-public-request-smoke",
                true});

    const auto key =
        request_key();

    if (!lifecycle.ensure(key)) {
        return 20;
    }

    if (!seed_remote_route(
            *runtime,
            routes,
            parse_ipv4(host),
            port)) {
        return 21;
    }

    if (manager.reconcile() == 0) {
        return 22;
    }

    const bool connected =
        spin(
            manager,
            [&] {
                return
                    manager.has_session(
                        77) &&
                    lifecycle.is_connected(
                        77);
            },
            std::chrono::
                seconds(6));

    if (!connected) {
        return 23;
    }

    cito::Context requester(
        "acme");

    auto request =
        requester.request(
            "robot_1",
            NetPing{41});

    if (request.ready()) {
        return 24;
    }

    const bool completed =
        spin(
            manager,
            [&] {
                return request.ready();
            },
            std::chrono::
                seconds(8));

    if (
        !completed ||
        !request.result() ||
        request.result()
            .value()
            .value != 42) {
        return 25;
    }

    if (
        runtime->request_network()
            .transport()
            .outbound_count() != 0 ||
        runtime->requests()
            .pending_count() != 0) {
        return 26;
    }

    std::cout
        << "quic_public_request_client result=42 session=1"
        << std::endl;

    manager.shutdown();
    return 0;
}

} // namespace

int main(
    int argc,
    char** argv) {
    if (
        argc >= 2 &&
        std::strcmp(
            argv[1],
            "server") == 0) {
        if (argc != 5) {
            return 2;
        }

        return run_server(
            static_cast<
                std::uint16_t>(
                std::stoul(
                    argv[2])),
            argv[3],
            argv[4]);
    }

    if (
        argc >= 2 &&
        std::strcmp(
            argv[1],
            "client") == 0) {
        if (argc != 4) {
            return 2;
        }

        return run_client(
            argv[2],
            static_cast<
                std::uint16_t>(
                std::stoul(
                    argv[3])));
    }

    return 2;
}
