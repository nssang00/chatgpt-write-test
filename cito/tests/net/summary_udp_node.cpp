#include <cito/data_packet.hpp>
#include <cito/demand_control.hpp>
#include <cito/demand_summary.hpp>
#include <cito/interest.hpp>

#include <arpa/inet.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace {

using Clock = std::chrono::steady_clock;

int make_udp() {
    const int fd = ::socket(AF_INET, SOCK_DGRAM, 0);
    if (fd < 0) {
        perror("socket");
        std::exit(20);
    }
    return fd;
}

sockaddr_in any_address(std::uint16_t port) {
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_ANY);
    address.sin_port = htons(port);
    return address;
}

bool bind_udp(int fd, std::uint16_t port) {
    auto address = any_address(port);
    return ::bind(
        fd,
        reinterpret_cast<sockaddr*>(&address),
        sizeof(address)) == 0;
}

std::vector<std::uint8_t> receive_bytes(
    int fd,
    sockaddr_in* from = nullptr) {
    std::vector<std::uint8_t> bytes(65535);
    sockaddr_in temporary{};
    socklen_t size = sizeof(temporary);

    const auto received = ::recvfrom(
        fd,
        bytes.data(),
        bytes.size(),
        0,
        reinterpret_cast<sockaddr*>(
            from ? from : &temporary),
        &size);

    if (received < 0) return {};

    bytes.resize(
        static_cast<std::size_t>(received));
    return bytes;
}

bool send_bytes(
    int fd,
    const std::vector<std::uint8_t>& bytes,
    const sockaddr_in& to) {
    return ::sendto(
        fd,
        bytes.data(),
        bytes.size(),
        0,
        reinterpret_cast<const sockaddr*>(&to),
        sizeof(to)) ==
        static_cast<ssize_t>(bytes.size());
}

sockaddr_in address_of(
    const std::string& ip,
    std::uint16_t port) {
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_port = htons(port);

    if (::inet_pton(
            AF_INET,
            ip.c_str(),
            &address.sin_addr) != 1) {
        throw std::runtime_error("bad ip");
    }

    return address;
}

struct PendingSnapshot {
    cito::DemandSummaryStamp stamp{};
    std::vector<cito::InterestKey> keys;
    std::uint32_t next_offset{};
};

int subscriber(int argc, char** argv) {
    if (argc != 9) {
        std::cerr << "subscriber args\n";
        return 2;
    }

    const auto node = std::stoull(argv[2]);
    const auto type = std::stoull(argv[3]);
    const auto data_port =
        static_cast<std::uint16_t>(
            std::stoul(argv[4]));
    const auto control_port =
        static_cast<std::uint16_t>(
            std::stoul(argv[5]));
    const auto announce_port =
        static_cast<std::uint16_t>(
            std::stoul(argv[6]));
    const std::string announce_ip = argv[7];
    const bool expect_data =
        std::stoi(argv[8]) != 0;

    const cito::InterestKey key{
        7,
        17,
        type};

    cito::HostInterests local;
    local.add(key);
    const auto stamp =
        local.stamp(node * 1000 + 1);
    const auto snapshot =
        local.snapshot();

    const int data_fd = make_udp();
    if (!bind_udp(data_fd, data_port)) {
        perror("bind data");
        return 21;
    }

    const int control_fd = make_udp();
    if (!bind_udp(control_fd, control_port)) {
        perror("bind control");
        return 22;
    }

    int yes = 1;
    if (::setsockopt(
            control_fd,
            SOL_SOCKET,
            SO_BROADCAST,
            &yes,
            sizeof(yes)) != 0) {
        perror("SO_BROADCAST");
        return 23;
    }

    const auto announce_to =
        address_of(
            announce_ip,
            announce_port);

    const cito::DemandSummaryAnnouncement announcement{
        node,
        control_port,
        stamp};
    const auto announce_bytes =
        cito::encode_summary_announcement(
            announcement);

    const auto start = Clock::now();
    auto next_announce = start;
    std::size_t snapshot_requests = 0;
    std::size_t route_requests = 0;

    while (
        Clock::now() - start <
        std::chrono::milliseconds(3500)) {
        const auto now = Clock::now();

        if (now >= next_announce) {
            if (!send_bytes(
                    control_fd,
                    announce_bytes,
                    announce_to)) {
                perror("send announce");
                return 24;
            }

            next_announce =
                now +
                std::chrono::milliseconds(150);
        }

        pollfd fds[2]{
            {control_fd, POLLIN, 0},
            {data_fd, POLLIN, 0}};

        const int result =
            ::poll(fds, 2, 50);

        if (result < 0) {
            perror("poll");
            return 25;
        }

        if (fds[0].revents & POLLIN) {
            sockaddr_in from{};
            const auto bytes =
                receive_bytes(
                    control_fd,
                    &from);

            if (bytes.size() < 4) {
                continue;
            }

            try {
                if (
                    bytes[0] == 'C' &&
                    bytes[1] == 'T' &&
                    bytes[2] == 'Q' &&
                    bytes[3] == '1') {
                    const auto request =
                        cito::decode_snapshot_request(
                            bytes);

                    if (request.coordinator != node) {
                        continue;
                    }

                    ++snapshot_requests;

                    if (
                        request.incarnation !=
                            stamp.incarnation ||
                        request.version !=
                            stamp.version) {
                        continue;
                    }

                    const auto batch =
                        cito::make_snapshot_batch(
                            node,
                            stamp,
                            snapshot,
                            request.offset,
                            request.limit);

                    if (!send_bytes(
                            control_fd,
                            cito::encode_snapshot_batch(
                                batch),
                            from)) {
                        return 26;
                    }
                } else if (
                    bytes[0] == 'C' &&
                    bytes[1] == 'T' &&
                    bytes[2] == 'R' &&
                    bytes[3] == '1') {
                    const auto request =
                        cito::decode_route_request(
                            bytes);

                    if (request.coordinator != node) {
                        continue;
                    }

                    ++route_requests;

                    if (request.key == key) {
                        const cito::RouteBatch routes{
                            node,
                            key,
                            {{node, data_port}}};

                        if (!send_bytes(
                                control_fd,
                                cito::encode_route_batch(
                                    routes),
                                from)) {
                            return 27;
                        }
                    }
                }
            } catch (const std::exception& error) {
                std::cerr
                    << error.what()
                    << "\n";
                return 28;
            }
        }

        if (fds[1].revents & POLLIN) {
            const auto bytes =
                receive_bytes(data_fd);

            if (bytes.empty()) {
                continue;
            }

            try {
                const auto data =
                    cito::decode_data_packet_view(
                        bytes);
                constexpr std::string_view expected =
                    "hello";

                if (
                    data.key == key &&
                    data.payload.size() ==
                        expected.size() &&
                    std::equal(
                        data.payload.begin(),
                        data.payload.end(),
                        expected.begin())) {
                    if (!expect_data) {
                        std::cerr
                            << "received unrelated data\n";
                        return 29;
                    }

                    std::cout
                        << "received expected data "
                        << "snapshot_requests="
                        << snapshot_requests
                        << " route_requests="
                        << route_requests
                        << "\n";
                    return 0;
                }
            } catch (const std::exception& error) {
                std::cerr
                    << error.what()
                    << "\n";
                return 30;
            }
        }
    }

    if (expect_data) {
        std::cerr
            << "timed out waiting for data\n";
        return 31;
    }

    if (route_requests != 0) {
        std::cerr
            << "unrelated host received route request\n";
        return 32;
    }

    std::cout
        << "no unrelated data "
        << "route_requests=0 "
        << "snapshot_requests="
        << snapshot_requests
        << "\n";
    return 0;
}

int publisher(int argc, char** argv) {
    if (argc != 6) {
        std::cerr << "publisher args\n";
        return 2;
    }

    const auto target_type =
        std::stoull(argv[2]);
    const auto announce_port =
        static_cast<std::uint16_t>(
            std::stoul(argv[3]));
    const auto expected_destinations =
        std::stoull(argv[4]);
    const auto listen_ms =
        std::stoull(argv[5]);

    const cito::InterestKey target{
        7,
        17,
        target_type};

    const int fd = make_udp();

    int yes = 1;
    (void)::setsockopt(
        fd,
        SOL_SOCKET,
        SO_REUSEADDR,
        &yes,
        sizeof(yes));

    if (!bind_udp(fd, announce_port)) {
        perror("bind announce");
        return 40;
    }

    cito::RemoteSummaryTracker tracker;
    cito::RemoteDemandIndex hosts;
    cito::InterestIndex direct;

    std::unordered_map<
        cito::CoordinatorId,
        sockaddr_in> controls;
    std::unordered_map<
        cito::CoordinatorId,
        PendingSnapshot> pending;
    std::unordered_set<
        cito::CoordinatorId> route_requested;
    std::unordered_map<
        cito::DestinationId,
        sockaddr_in> endpoints;

    std::size_t snapshot_pulls = 0;
    std::size_t route_requests = 0;

    auto request_snapshot =
        [&](cito::CoordinatorId id,
            const cito::DemandSummaryStamp& stamp,
            std::uint32_t offset) {
            const auto it =
                controls.find(id);

            if (it == controls.end()) {
                return false;
            }

            const cito::DemandSnapshotRequest request{
                id,
                stamp.incarnation,
                stamp.version,
                offset,
                cito::kMaxDemandSnapshotBatch};

            ++snapshot_pulls;
            return send_bytes(
                fd,
                cito::encode_snapshot_request(
                    request),
                it->second);
        };

    auto request_route =
        [&](cito::CoordinatorId id) {
            if (!route_requested.insert(id).second) {
                return true;
            }

            const auto it =
                controls.find(id);

            if (it == controls.end()) {
                return false;
            }

            ++route_requests;
            return send_bytes(
                fd,
                cito::encode_route_request(
                    {id, target}),
                it->second);
        };

    const auto start = Clock::now();

    while (
        Clock::now() - start <
        std::chrono::milliseconds(listen_ms)) {
        pollfd descriptor{
            fd,
            POLLIN,
            0};

        const int result =
            ::poll(
                &descriptor,
                1,
                100);

        if (result < 0) {
            perror("poll");
            return 41;
        }

        if (!(descriptor.revents & POLLIN)) {
            continue;
        }

        sockaddr_in from{};
        const auto bytes =
            receive_bytes(
                fd,
                &from);

        if (bytes.size() < 4) {
            continue;
        }

        try {
            if (
                bytes[0] == 'C' &&
                bytes[1] == 'T' &&
                bytes[2] == 'S' &&
                bytes[3] == '1') {
                const auto announcement =
                    cito::decode_summary_announcement(
                        bytes);

                from.sin_port =
                    htons(
                        announcement.control_port);
                controls[
                    announcement.coordinator] =
                    from;

                if (
                    tracker.needs_snapshot(
                        announcement.coordinator,
                        announcement.stamp) &&
                    pending.find(
                        announcement.coordinator) ==
                        pending.end()) {
                    pending[
                        announcement.coordinator] =
                        PendingSnapshot{
                            announcement.stamp,
                            {},
                            0};

                    if (!request_snapshot(
                            announcement.coordinator,
                            announcement.stamp,
                            0)) {
                        return 42;
                    }
                }
            } else if (
                bytes[0] == 'C' &&
                bytes[1] == 'T' &&
                bytes[2] == 'B' &&
                bytes[3] == '1') {
                const auto batch =
                    cito::decode_snapshot_batch(
                        bytes);

                auto it =
                    pending.find(
                        batch.coordinator);

                if (it == pending.end()) {
                    continue;
                }

                auto& state = it->second;

                if (
                    batch.stamp != state.stamp ||
                    batch.offset !=
                        state.next_offset) {
                    continue;
                }

                state.keys.insert(
                    state.keys.end(),
                    batch.keys.begin(),
                    batch.keys.end());
                state.next_offset +=
                    static_cast<std::uint32_t>(
                        batch.keys.size());

                if (
                    state.next_offset <
                    state.stamp.key_count) {
                    if (!request_snapshot(
                            batch.coordinator,
                            state.stamp,
                            state.next_offset)) {
                        return 43;
                    }
                } else {
                    hosts.apply_snapshot(
                        batch.coordinator,
                        state.stamp,
                        state.keys);
                    tracker.mark_applied(
                        batch.coordinator,
                        state.stamp);
                    pending.erase(it);

                    if (
                        hosts.lookup_hosts(target)
                            .contains(
                                batch.coordinator)) {
                        if (!request_route(
                                batch.coordinator)) {
                            return 44;
                        }
                    }
                }
            } else if (
                bytes[0] == 'C' &&
                bytes[1] == 'T' &&
                bytes[2] == 'R' &&
                bytes[3] == '2') {
                const auto routes =
                    cito::decode_route_batch(
                        bytes);

                if (!(routes.key == target)) {
                    continue;
                }

                for (const auto& endpoint :
                     routes.endpoints) {
                    direct.add(
                        routes.key,
                        endpoint.destination);

                    auto address = from;
                    address.sin_port =
                        htons(endpoint.data_port);
                    endpoints[
                        endpoint.destination] =
                        address;
                }
            }
        } catch (const std::exception& error) {
            std::cerr
                << "bad control: "
                << error.what()
                << "\n";
            return 45;
        }
    }

    const auto& destinations =
        direct.lookup(target);

    if (
        destinations.size() !=
        expected_destinations) {
        std::cerr
            << "expected "
            << expected_destinations
            << " destinations got "
            << destinations.size()
            << "\n";
        return 46;
    }

    const cito::DataPacket packet{
        target,
        {'h', 'e', 'l', 'l', 'o'}};
    const auto payload =
        cito::encode_data_packet(packet);

    for (const auto id : destinations) {
        const auto it = endpoints.find(id);

        if (it == endpoints.end()) {
            return 47;
        }

        if (!send_bytes(
                fd,
                payload,
                it->second)) {
            return 48;
        }
    }

    std::cout
        << "summary_pulls="
        << snapshot_pulls
        << " route_requests="
        << route_requests
        << " discovered="
        << destinations.size()
        << " sent="
        << destinations.size()
        << "\n";
    return 0;
}

} // namespace

int main(int argc, char** argv) {
    if (argc < 2) return 2;

    if (std::strcmp(
            argv[1],
            "subscriber") == 0) {
        return subscriber(argc, argv);
    }

    if (std::strcmp(
            argv[1],
            "publisher") == 0) {
        return publisher(argc, argv);
    }

    return 2;
}
