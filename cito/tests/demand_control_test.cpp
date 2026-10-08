#include <cito/demand_control.hpp>

#include <array>
#include <cassert>
#include <cstdint>
#include <stdexcept>

int main() {
    cito::DemandSummaryAnnouncement announcement{
        7,
        47000,
        750,
        {11, 9, 2}};

    const auto announcement_bytes =
        cito::encode_summary_announcement(
            announcement);
    const auto announcement_roundtrip =
        cito::decode_summary_announcement(
            announcement_bytes);

    assert(
        announcement_roundtrip.coordinator ==
        7);
    assert(
        announcement_roundtrip.control_port ==
        47000);
    assert(
        announcement_roundtrip.stamp ==
        announcement.stamp);
    assert(
        announcement_roundtrip.lease_ms ==
        750);

    cito::DemandSnapshotRequest request{
        7,
        11,
        9,
        0,
        32};

    const auto request_roundtrip =
        cito::decode_snapshot_request(
            cito::encode_snapshot_request(
                request));
    assert(request_roundtrip.coordinator == 7);
    assert(request_roundtrip.limit == 32);
    assert(request_roundtrip.version == 9);

    const std::array keys{
        cito::InterestKey{1, 2, 100},
        cito::InterestKey{1, 2, 200}};

    const auto batch =
        cito::make_snapshot_batch(
            7,
            announcement.stamp,
            keys,
            0);
    const auto batch_bytes =
        cito::encode_snapshot_batch(batch);
    const auto batch_roundtrip =
        cito::decode_snapshot_batch(
            batch_bytes);

    assert(
        batch_roundtrip.stamp ==
        announcement.stamp);
    assert(batch_roundtrip.keys.size() == 2);
    assert(
        batch_roundtrip.keys[0] ==
        keys[0]);

    // The bounded batch stays comfortably below a normal safe UDP payload.
    assert(batch_bytes.size() < 1200);

    const cito::RouteRequest route_request{
        7,
        11,
        keys[0]};

    const auto route_request_roundtrip =
        cito::decode_route_request(
            cito::encode_route_request(
                route_request));
    assert(
        route_request_roundtrip.key ==
        keys[0]);
    assert(
        route_request_roundtrip.incarnation ==
        11);

    const cito::RouteBatch routes{
        7,
        11,
        keys[0],
        {
            {91, 48001},
            {92, 48002}}};

    const auto route_roundtrip =
        cito::decode_route_batch(
            cito::encode_route_batch(
                routes));

    assert(
        route_roundtrip.incarnation ==
        11);
    assert(
        route_roundtrip.endpoints.size() ==
        2);
    assert(
        route_roundtrip.endpoints[1]
            .destination ==
        92);

    std::array<cito::InterestKey, 33> many{};
    const cito::DemandSummaryStamp stamp{
        1,
        1,
        33};

    const auto first =
        cito::make_snapshot_batch(
            1,
            stamp,
            many,
            0);
    const auto second =
        cito::make_snapshot_batch(
            1,
            stamp,
            many,
            32);

    assert(first.keys.size() == 32);
    assert(second.keys.size() == 1);

    bool invalid_limit = false;
    try {
        cito::DemandSnapshotRequest bad{
            1,
            1,
            1,
            0,
            33};
        (void)cito::encode_snapshot_request(
            bad);
    } catch (const std::invalid_argument&) {
        invalid_limit = true;
    }
    assert(invalid_limit);

    return 0;
}
