#include <cito/detail/transport_selector.hpp>

#include <cassert>

int main() {
    using cito::detail::Locality;
    using cito::detail::TransportKind;

    static_assert(
        cito::detail::select_transport(
            Locality::SameProcess) ==
        TransportKind::InProcess);

    static_assert(
        cito::detail::select_transport(
            Locality::SameHost) ==
        TransportKind::SharedMemory);

    static_assert(
        cito::detail::select_transport(
            Locality::Remote) ==
        TransportKind::Udp);

    assert(
        cito::detail::select_transport(
            Locality::SameProcess) ==
        TransportKind::InProcess);

    return 0;
}
