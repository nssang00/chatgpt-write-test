#pragma once

#include <cstddef>
#include <cstdint>
#include <unordered_map>
#include <unordered_set>

namespace cito {

using ScopeId = std::uint64_t;
using ResourceId = std::uint64_t;
using TypeId = std::uint64_t;
using DestinationId = std::uint64_t;

struct InterestKey {
    ScopeId scope{};
    ResourceId resource{};
    TypeId type{};

    friend bool operator==(const InterestKey&, const InterestKey&) = default;
};

struct InterestKeyHash {
    std::size_t operator()(const InterestKey& key) const noexcept {
        auto mix = [](std::uint64_t x) {
            x ^= x >> 33;
            x *= 0xff51afd7ed558ccdULL;
            x ^= x >> 33;
            x *= 0xc4ceb9fe1a85ec53ULL;
            x ^= x >> 33;
            return x;
        };
        auto h = mix(key.scope);
        h ^= mix(key.resource + 0x9e3779b97f4a7c15ULL + (h << 6) + (h >> 2));
        h ^= mix(key.type + 0x9e3779b97f4a7c15ULL + (h << 6) + (h >> 2));
        return static_cast<std::size_t>(h);
    }
};

class HostInterests {
public:
    bool add(const InterestKey& key) {
        auto& count = counts_[key];
        ++count;
        return count == 1;
    }

    bool remove(const InterestKey& key) {
        auto it = counts_.find(key);
        if (it == counts_.end()) return false;
        if (--it->second == 0) {
            counts_.erase(it);
            return true;
        }
        return false;
    }

    bool contains(const InterestKey& key) const {
        return counts_.contains(key);
    }

    std::size_t unique_interest_count() const noexcept {
        return counts_.size();
    }

private:
    std::unordered_map<InterestKey, std::size_t, InterestKeyHash> counts_;
};

class InterestIndex {
public:
    bool add(const InterestKey& key, DestinationId destination) {
        auto& destinations = table_[key];
        const auto [_, inserted] = destinations.insert(destination);
        if (inserted) ++edge_count_;
        return inserted;
    }

    bool remove(const InterestKey& key, DestinationId destination) {
        auto it = table_.find(key);
        if (it == table_.end()) return false;
        if (it->second.erase(destination) == 0) return false;
        --edge_count_;
        if (it->second.empty()) table_.erase(it);
        return true;
    }

    const std::unordered_set<DestinationId>& lookup(const InterestKey& key) const noexcept {
        auto it = table_.find(key);
        return it == table_.end() ? empty_ : it->second;
    }

    std::size_t key_count() const noexcept { return table_.size(); }
    std::size_t edge_count() const noexcept { return edge_count_; }

private:
    std::unordered_map<InterestKey, std::unordered_set<DestinationId>, InterestKeyHash> table_;
    std::unordered_set<DestinationId> empty_;
    std::size_t edge_count_{0};
};

} // namespace cito
