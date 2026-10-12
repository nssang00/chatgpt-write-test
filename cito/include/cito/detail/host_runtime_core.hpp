#pragma once

#include <cito/coordinator_lifecycle.hpp>
#include <cito/data_packet.hpp>
#include <cito/demand_summary.hpp>
#include <cito/interest.hpp>
#include <cito/remote_routes.hpp>

#include <cstddef>
#include <cstdint>
#include <functional>
#include <optional>
#include <span>
#include <stdexcept>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace cito::detail {

using AppId = std::uint64_t;

struct LocalInterestChange {
    bool changed{false};
    bool summary_changed{false};
};

struct HostPublishResult {
    std::size_t local_delivered{0};
    std::size_t remote_sent{0};
    std::size_t packet_encodes{0};

    std::size_t delivered() const noexcept {
        return
            local_delivered +
            remote_sent;
    }
};

class HostRuntimeCore {
public:
    using Deliver =
        std::function<std::size_t(
            TypeId,
            std::string_view,
            std::span<const std::uint8_t>)>;

private:
    struct AppState {
        Deliver deliver;
        std::unordered_map<
            InterestKey,
            std::size_t,
            InterestKeyHash> interests;
    };

public:
    bool register_app(
        AppId app,
        Deliver deliver) {
        if (!deliver) {
            throw std::invalid_argument(
                "Cito host runtime app delivery callback is empty");
        }

        return apps_.emplace(
            app,
            AppState{
                std::move(deliver),
                {}}).second;
    }

    bool unregister_app(
        AppId app) {
        const auto it =
            apps_.find(app);

        if (it == apps_.end()) {
            return false;
        }

        for (const auto& [key, count] :
             it->second.interests) {
            local_apps_.remove(
                key,
                app);

            for (std::size_t i = 0;
                 i < count;
                 ++i) {
                host_interests_.remove(
                    key);
            }
        }

        apps_.erase(it);
        return true;
    }

    LocalInterestChange add_interest(
        AppId app,
        const InterestKey& key) {
        auto it = apps_.find(app);

        if (it == apps_.end()) {
            return {};
        }

        auto& count =
            it->second.interests[key];

        ++count;

        if (count == 1) {
            local_apps_.add(
                key,
                app);
        }

        return {
            true,
            host_interests_.add(key)};
    }

    LocalInterestChange remove_interest(
        AppId app,
        const InterestKey& key) {
        auto app_it =
            apps_.find(app);

        if (app_it == apps_.end()) {
            return {};
        }

        auto interest_it =
            app_it->second.interests.find(
                key);

        if (interest_it ==
            app_it->second.interests.end()) {
            return {};
        }

        const auto summary_changed =
            host_interests_.remove(
                key);

        if (--interest_it->second == 0) {
            app_it->second.interests.erase(
                interest_it);
            local_apps_.remove(
                key,
                app);
        }

        return {
            true,
            summary_changed};
    }

    bool has_local_demand(
        const InterestKey& key) const noexcept {
        return !local_apps_.lookup(
            key).empty();
    }

    bool has_remote_demand(
        const InterestKey& key) const noexcept {
        return !remote_routes_.lookup(
            key).empty();
    }

    bool has_demand(
        const InterestKey& key) const noexcept {
        return
            has_local_demand(key) ||
            has_remote_demand(key);
    }

    DemandSummaryStamp local_stamp(
        std::uint64_t incarnation) const {
        return host_interests_.stamp(
            incarnation);
    }

    std::vector<InterestKey>
    local_snapshot() const {
        return host_interests_.snapshot();
    }

    std::uint64_t
    local_summary_version() const noexcept {
        return host_interests_.version();
    }

    CoordinatorLeaseObservation
    observe_coordinator(
        CoordinatorId coordinator,
        std::uint64_t incarnation,
        std::uint32_t lease_ms,
        std::uint64_t now_ms) {
        const auto observation =
            leases_.observe(
                coordinator,
                incarnation,
                lease_ms,
                now_ms);

        if (
            observation ==
            CoordinatorLeaseObservation::
                Restarted) {
            cleanup_remote(
                coordinator);
        }

        return observation;
    }

    bool needs_remote_snapshot(
        CoordinatorId coordinator,
        const DemandSummaryStamp& stamp)
        const {
        return summary_tracker_
            .needs_snapshot(
                coordinator,
                stamp);
    }

    bool apply_remote_snapshot(
        CoordinatorId coordinator,
        DemandSummaryStamp stamp,
        std::span<const InterestKey> keys) {
        if (!leases_.is_current(
                coordinator,
                stamp.incarnation)) {
            return false;
        }

        if (!summary_tracker_
                 .needs_snapshot(
                     coordinator,
                     stamp)) {
            return false;
        }

        const auto changed =
            remote_demands_
                .apply_snapshot(
                    coordinator,
                    stamp,
                    keys);

        if (changed) {
            summary_tracker_
                .mark_applied(
                    coordinator,
                    stamp);
        }

        return changed;
    }

    bool coordinator_is_current(
        CoordinatorId coordinator,
        std::uint64_t incarnation) const noexcept {
        return leases_.is_current(
            coordinator,
            incarnation);
    }

    std::optional<std::uint64_t>
    coordinator_incarnation(
        CoordinatorId coordinator) const noexcept {
        return leases_.current_incarnation(
            coordinator);
    }

    bool replace_remote_routes(
        CoordinatorId coordinator,
        std::uint64_t incarnation,
        const InterestKey& key,
        std::span<const DestinationId>
            destinations) {
        if (!leases_.is_current(
                coordinator,
                incarnation)) {
            return false;
        }

        return remote_routes_.replace(
            coordinator,
            key,
            destinations);
    }

    std::vector<CoordinatorId>
    expire_remote_coordinators(
        std::uint64_t now_ms) {
        auto expired =
            leases_.expire(now_ms);

        for (const auto coordinator :
             expired) {
            cleanup_remote(
                coordinator);
        }

        return expired;
    }

    std::size_t expire_remote(
        std::uint64_t now_ms) {
        return expire_remote_coordinators(
            now_ms).size();
    }

    const std::unordered_set<
        CoordinatorId>& candidate_hosts(
        const InterestKey& key) const noexcept {
        return remote_demands_
            .lookup_hosts(key);
    }

    const std::unordered_set<
        DestinationId>& remote_destinations(
        CoordinatorId coordinator,
        const InterestKey& key) const noexcept {
        return remote_routes_.lookup(
            coordinator,
            key);
    }

    const std::unordered_set<
        DestinationId>& remote_destinations(
        const InterestKey& key) const noexcept {
        return remote_routes_
            .lookup(key);
    }

    std::size_t deliver_local(
        const InterestKey& key,
        std::string_view resource,
        std::span<const std::uint8_t> payload) {
        const auto& local =
            local_apps_.lookup(key);

        if (local.empty()) {
            return 0;
        }

        std::vector<AppId> app_ids(
            local.begin(),
            local.end());

        std::size_t delivered = 0;

        for (const auto app :
             app_ids) {
            const auto it =
                apps_.find(app);

            if (it == apps_.end()) {
                continue;
            }

            delivered +=
                it->second.deliver(
                    key.type,
                    resource,
                    payload);
        }

        return delivered;
    }

    template <class RemoteSend>
    HostPublishResult publish(
        const InterestKey& key,
        std::string_view resource,
        std::span<const std::uint8_t> payload,
        RemoteSend&& remote_send) {
        HostPublishResult result;

        result.local_delivered =
            deliver_local(
                key,
                resource,
                payload);

        const auto& remote =
            remote_routes_.lookup(key);

        if (remote.empty()) {
            return result;
        }

        const auto packet =
            encode_data_packet(
                key,
                payload);

        result.packet_encodes = 1;

        for (const auto destination :
             remote) {
            if (std::invoke(
                    remote_send,
                    destination,
                    std::span<
                        const std::uint8_t>(
                        packet.data(),
                        packet.size()))) {
                ++result.remote_sent;
            }
        }

        return result;
    }

    std::size_t app_count() const noexcept {
        return apps_.size();
    }

    std::size_t remote_route_edges()
        const noexcept {
        return remote_routes_
            .edge_count();
    }

private:
    void cleanup_remote(
        CoordinatorId coordinator) {
        remote_demands_.remove_host(
            coordinator);
        summary_tracker_.forget(
            coordinator);
        remote_routes_
            .remove_coordinator(
                coordinator);
    }

    std::unordered_map<
        AppId,
        AppState> apps_;

    HostInterests host_interests_;
    InterestIndex local_apps_;

    CoordinatorLeaseTable leases_;
    RemoteSummaryTracker summary_tracker_;
    RemoteDemandIndex remote_demands_;
    RemoteRouteIndex remote_routes_;
};

} // namespace cito::detail
