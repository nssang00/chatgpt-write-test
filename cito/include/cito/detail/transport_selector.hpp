#pragma once

#include <cstdint>

namespace cito::detail {

enum class Locality : std::uint8_t {
    SameProcess,
    SameHost,
    Remote,
};

enum class TransportKind : std::uint8_t {
    InProcess,
    SharedMemory,
    Udp,
};

constexpr TransportKind select_transport(
    Locality locality) noexcept {
    switch (locality) {
        case Locality::SameProcess:
            return TransportKind::InProcess;
        case Locality::SameHost:
            return TransportKind::SharedMemory;
        case Locality::Remote:
            return TransportKind::Udp;
    }

    return TransportKind::Udp;
}

} // namespace cito::detail
