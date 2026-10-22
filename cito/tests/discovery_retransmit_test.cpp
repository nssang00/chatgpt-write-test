#include <cito/detail/discovery_control_core.hpp>
#include <array>
#include <cassert>

int main() {
    const cito::InterestKey key{7,17,100};
    cito::detail::HostRuntimeCore sub;
    sub.register_app(1,[](auto,auto,auto){return std::size_t{1};});
    sub.add_interest(1,key);
    cito::detail::HostRuntimeCore pub;
    cito::detail::DiscoveryControlCore sc(sub,11,11001);
    cito::detail::DiscoveryControlCore pc(pub,20,20001);

    assert(pc.ensure_routes(key).empty());
    auto announcement=sc.announcement(47111,600);
    auto original=pc.on_summary(announcement,1000);
    assert(original.size()==1);

    // Drop first snapshot request (or its response); unchanged announcement
    // must provoke another request after a bounded interval.
    assert(pc.on_summary(announcement,1300).empty());
    auto retry=pc.on_summary(announcement,1600);
    assert(retry.size()==1);
    assert(pc.stats().snapshot_requests==2);
    auto batch=sc.on_snapshot_request(
        cito::decode_snapshot_request(retry[0].bytes));
    auto routes=pc.on_snapshot_batch(
        cito::decode_snapshot_batch(batch.bytes));
    assert(routes.size()==1);

    // Drop route request (or response). Same-stamp announcements must
    // re-request only if the destination route is still missing.
    auto route_retry=pc.on_summary(announcement,1700);
    assert(route_retry.size()==1);
    assert(pc.on_summary(announcement,1800).empty());
    auto another=pc.on_summary(announcement,2201);
    assert(another.size()==1);
    assert(pc.stats().route_requests==3);

    const std::array<cito::RouteEndpoint,1> endpoint{{{111,48111}}};
    auto response=sc.on_route_request(
        cito::decode_route_request(another[0].bytes),endpoint);
    assert(pc.on_route_batch(cito::decode_route_batch(response.bytes)));
    assert(pub.remote_destinations(key).contains(111));
    assert(pc.on_summary(announcement,2802).empty());
    return 0;
}
