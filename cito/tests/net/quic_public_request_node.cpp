#include <cito/cito.hpp>
#include <cito/detail/msquic_request_session_manager.hpp>
#include <cito/detail/posix_udp_control_manager.hpp>
#include <cito/detail/request_session_lifecycle.hpp>
#include <cito/detail/udp_runtime_adapter.hpp>

#include <array>
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
    static inline std::size_t encodes = 0;

    static std::vector<std::uint8_t>
    encode(const NetPing& value) {
        ++encodes;
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

std::uint64_t now_ms() {
    return static_cast<
        std::uint64_t>(
        std::chrono::
            duration_cast<
                std::chrono::
                    milliseconds>(
                Clock::now()
                    .time_since_epoch())
            .count());
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
        PosixUdpControlManager&
        control,
    cito::detail::
        MsQuicRequestSessionManager&
        quic,
    const std::function<bool()>& done,
    std::chrono::milliseconds timeout) {
    const auto deadline =
        Clock::now() + timeout;

    while (
        Clock::now() < deadline) {
        control.poll(
            now_ms());
        quic.reconcile();
        quic.poll();

        if (done()) {
            return true;
        }

        std::this_thread::sleep_for(
            std::chrono::
                milliseconds(1));
    }

    control.poll(
        now_ms());
    quic.reconcile();
    quic.poll();

    return done();
}

int run_server(
    std::uint16_t quic_port,
    std::uint16_t control_port,
    const std::string&
        announce_ip,
    std::uint16_t announce_port,
    const std::string& cert,
    const std::string& key) {
    using namespace cito::detail;

    auto runtime =
        acquire_embedded_host_runtime();

    UdpRuntimeAdapter routes(
        runtime->host(),
        50,
        5001);

    const std::array<
        cito::RouteEndpoint,
        1> endpoints{{
            {77, 0, quic_port}}};

    routes.set_local_route_endpoints(
        endpoints);

    PosixUdpControlManager control(
        routes);

    if (!control.bind(
            control_port)) {
        return 10;
    }

    control.add_announcement_target(
        UdpEndpoint{
            parse_ipv4(
                announce_ip),
            announce_port});

    control.set_announcement_policy(
        700,
        100);

    MsQuicRequestSessionManager
        manager(
            *runtime,
            nullptr);

    if (!manager.start_listener(
            quic_port,
            cert,
            key)) {
        return 11;
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
            control,
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
        return 12;
    }

    const bool peer_closed =
        spin(
            control,
            manager,
            [&] {
                return
                    manager.peer_count() ==
                    0;
            },
            std::chrono::
                seconds(4));

    if (!peer_closed) {
        return 13;
    }

    if (
        control.stats()
            .datagrams_received <
            2 ||
        control.stats()
            .datagrams_sent <
            2) {
        return 14;
    }

    std::cout
        << "quic_public_request_server handler=1 reply=1 discovery=udp"
        << std::endl;

    manager.shutdown();
    control.stop();
    return 0;
}

int run_client(
    std::uint16_t control_port) {
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

    PosixUdpControlManager control(
        routes,
        &lifecycle);

    if (!control.bind(
            control_port)) {
        return 20;
    }

    MsQuicRequestSessionManager
        manager(
            *runtime,
            &lifecycle,
            MsQuicRequestSessionOptions{
                "cito-public-request-smoke",
                true});

    cito::Context requester(
        "acme");

    cito::StaticCodec<
        NetPing>::encodes = 0;

    // The request is created before any remote coordinator, route, endpoint,
    // or QUIC session is known.
    auto request =
        requester.request(
            "robot_1",
            NetPing{41},
            cito::RequestOptions{
                std::chrono::
                    seconds(5)});

    if (
        request.ready() ||
        cito::StaticCodec<
            NetPing>::encodes != 0 ||
        runtime->request_network()
            .waiting_count() != 1 ||
        lifecycle.desired_count() != 1) {
        return 21;
    }

    const bool completed =
        spin(
            control,
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
            .value != 42 ||
        cito::StaticCodec<
            NetPing>::encodes != 1 ||
        !manager.has_session(77) ||
        !lifecycle.is_connected(77)) {
        return 22;
    }

    const auto before_timeout =
        cito::StaticCodec<
            NetPing>::encodes;

    auto timed_out =
        requester.request(
            "missing",
            NetPing{9},
            cito::RequestOptions{
                std::chrono::
                    milliseconds(20)});

    if (
        timed_out.ready() ||
        cito::StaticCodec<
            NetPing>::encodes !=
        before_timeout) {
        return 23;
    }

    const bool timeout_completed =
        spin(
            control,
            manager,
            [&] {
                return timed_out.ready();
            },
            std::chrono::
                seconds(2));

    if (
        !timeout_completed ||
        timed_out.result() ||
        timed_out.result()
            .status() !=
            cito::RequestStatus::
                DeadlineExceeded ||
        cito::StaticCodec<
            NetPing>::encodes !=
        before_timeout) {
        return 24;
    }

    if (
        control.stats()
            .datagrams_received <
            3 ||
        control.stats()
            .datagrams_sent <
            2 ||
        runtime->request_network()
            .waiting_count() != 0 ||
        runtime->request_network()
            .transport()
            .outbound_count() != 0 ||
        runtime->requests()
            .pending_count() != 0) {
        return 25;
    }

    std::cout
        << "quic_public_request_client result=42 lazy=1 deadline=1 discovery=udp"
        << std::endl;

    manager.shutdown();
    control.stop();
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
        if (argc != 8) {
            return 2;
        }

        return run_server(
            static_cast<
                std::uint16_t>(
                std::stoul(
                    argv[2])),
            static_cast<
                std::uint16_t>(
                std::stoul(
                    argv[3])),
            argv[4],
            static_cast<
                std::uint16_t>(
                std::stoul(
                    argv[5])),
            argv[6],
            argv[7]);
    }

    if (
        argc >= 2 &&
        std::strcmp(
            argv[1],
            "client") == 0) {
        if (argc != 3) {
            return 2;
        }

        return run_client(
            static_cast<
                std::uint16_t>(
                std::stoul(
                    argv[2])));
    }

    return 2;
}
