#include <cito/cito.hpp>
#include <cito/detail/linux_request_runtime_driver.hpp>

#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <exception>
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

struct Detached {
    struct promise_type {
        Detached get_return_object() {
            return {};
        }

        std::suspend_never
        initial_suspend()
            const noexcept {
            return {};
        }

        std::suspend_never
        final_suspend()
            const noexcept {
            return {};
        }

        void return_void()
            const noexcept {}

        void unhandled_exception() {
            std::terminate();
        }
    };
};

Detached await_and_stop(
    cito::Context& ctx,
    cito::Request<NetPong> request,
    bool& done,
    bool& ok,
    std::uint32_t& value,
    cito::RequestStatus& status) {
    auto result =
        co_await request;

    status =
        result.status();

    if (result) {
        ok = true;
        value =
            result.value().value;
    }

    done = true;
    ctx.stop();
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

    LinuxRequestRuntimeOptions
        options;

    options.coordinator = 50;
    options.incarnation = 5001;
    options.destination = 77;
    options.control_port =
        control_port;
    options.quic_port =
        quic_port;
    options.lease_ms = 700;
    options.announce_interval_ms =
        100;
    options.announcement_targets
        .push_back(
            UdpEndpoint{
                parse_ipv4(
                    announce_ip),
                announce_port});
    options.certificate_file =
        cert;
    options.private_key_file =
        key;
    options.quic.registration_name =
        "cito-public-server";

    auto driver =
        install_linux_request_runtime(
            *runtime,
            std::move(options));

    cito::Context provider(
        "acme");

    std::atomic<int>
        handler_calls{0};

    provider.handle<NetPing>(
        "robot_1",
        [&](const NetPing& ping) {
            handler_calls.fetch_add(
                1,
                std::memory_order_relaxed);

            return NetPong{
                ping.value + 1};
        });

    std::atomic<bool>
        completed{false};

    std::thread stopper(
        [&] {
            const auto deadline =
                std::chrono::
                    steady_clock::now() +
                std::chrono::
                    seconds(10);

            while (
                std::chrono::
                    steady_clock::now() <
                    deadline) {
                if (
                    handler_calls.load(
                        std::memory_order_relaxed) ==
                        1 &&
                    driver->
                        completed_send_count() >=
                        1 &&
                    driver->peer_count() ==
                        0) {
                    completed.store(
                        true,
                        std::memory_order_release);
                    provider.stop();
                    return;
                }

                std::this_thread::
                    sleep_for(
                        std::chrono::
                            milliseconds(1));
            }

            provider.stop();
        });

    provider.run();
    stopper.join();

    const auto stats =
        driver->control_stats();

    const bool ok =
        completed.load(
            std::memory_order_acquire) &&
        handler_calls.load(
            std::memory_order_relaxed) ==
            1 &&
        stats.datagrams_received >=
            2 &&
        stats.datagrams_sent >= 2;

    (void)runtime->clear_driver(
        driver.get());
    driver.reset();

    if (!ok) {
        return 10;
    }

    std::cout
        << "quic_public_request_server handler=1 reply=1 discovery=udp run=context"
        << std::endl;

    return 0;
}

int run_client(
    std::uint16_t control_port) {
    using namespace cito::detail;

    auto runtime =
        acquire_embedded_host_runtime();

    LinuxRequestRuntimeOptions
        options;

    options.coordinator = 20;
    options.incarnation = 2001;
    options.control_port =
        control_port;
    options.quic.registration_name =
        "cito-public-client";
    options.quic
        .skip_server_certificate_validation =
        true;

    auto driver =
        install_linux_request_runtime(
            *runtime,
            std::move(options));

    cito::Context requester(
        "acme");

    cito::StaticCodec<
        NetPing>::encodes = 0;

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
            .waiting_count() != 1) {
        return 20;
    }

    bool done = false;
    bool ok = false;
    std::uint32_t value = 0;
    auto status =
        cito::RequestStatus::
            Internal;

    await_and_stop(
        requester,
        request,
        done,
        ok,
        value,
        status);

    requester.run();

    if (
        !done ||
        !ok ||
        status !=
            cito::RequestStatus::Ok ||
        value != 42 ||
        cito::StaticCodec<
            NetPing>::encodes != 1 ||
        driver->session_count() !=
            1) {
        return 21;
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
        return 22;
    }

    bool timeout_done = false;
    bool timeout_ok = false;
    std::uint32_t timeout_value =
        0;
    auto timeout_status =
        cito::RequestStatus::
            Internal;

    await_and_stop(
        requester,
        timed_out,
        timeout_done,
        timeout_ok,
        timeout_value,
        timeout_status);

    requester.run();

    const auto stats =
        driver->control_stats();

    const bool final_ok =
        timeout_done &&
        !timeout_ok &&
        timeout_status ==
            cito::RequestStatus::
                DeadlineExceeded &&
        cito::StaticCodec<
            NetPing>::encodes ==
            before_timeout &&
        stats.datagrams_received >=
            3 &&
        stats.datagrams_sent >= 2 &&
        runtime->request_network()
            .waiting_count() == 0 &&
        runtime->request_network()
            .transport()
            .outbound_count() == 0 &&
        runtime->requests()
            .pending_count() == 0;

    (void)runtime->clear_driver(
        driver.get());
    driver.reset();

    if (!final_ok) {
        return 23;
    }

    std::cout
        << "quic_public_request_client result=42 lazy=1 deadline=1 discovery=udp run=context"
        << std::endl;

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
