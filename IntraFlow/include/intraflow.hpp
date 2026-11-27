#pragma once
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <stdexcept>
#include <nlohmann/json.hpp>

namespace intraflow {
using Json = nlohmann::json;
using SubscriptionId = std::uint64_t;
template<class T> struct Traits;
struct Message {
    std::int64_t sequence;
    std::int64_t timestamp;
    std::string topic, sender, type, hash;
    Json payload;
};
struct Options {
    std::string database = "intraflow.db";
    unsigned poll_ms = 10;
    unsigned busy_ms = 5000;
    bool full_sync = false; // opt into SQLite FULL power-loss durability
    unsigned retention_sec = 60; // zero disables age limit
    unsigned max_messages = 100000; // zero disables sequence-window limit
    unsigned cleanup_interval_ms = 1000; // during publication, not idle
    bool filter_topics = false; // experimental, per-Session
    bool serialize_writers = false; // experimental opt-in; same setting for every Session on DB
#ifdef INTRAFLOW_DIAGNOSTICS
    int diagnostic_checkpoint = -1;
    bool diagnostic_hooks = false;
    bool diagnostic_short_retry = false;
    unsigned diagnostic_maintenance_ms = 0; // only designated peer
    std::uint32_t diagnostic_retry_seed = 1;
#endif
};
class Session {
public:
    explicit Session(const std::string& name, const Options& options = Options());
    ~Session();
    Session(Session&&) noexcept;
    Session& operator=(Session&&) noexcept;
    Session(const Session&) = delete;
    Session& operator=(const Session&) = delete;

    template<class T>
    std::int64_t publish(const std::string& topic, const T& value) {
        return publishRaw(topic, Traits<T>::name(), Traits<T>::hash(), Traits<T>::schema(), Json(value));
    }
    template<class T>
    SubscriptionId subscribe(const std::string& topic, std::function<void(const T&)> callback) {
        if (!callback) throw std::invalid_argument("empty callback");
        return subscribeRaw(topic, Traits<T>::name(), Traits<T>::hash(), Traits<T>::schema(),
            [callback](const Message& m) { const T value = m.payload.get<T>(); callback(value); });
    }
    SubscriptionId subscribeAll(std::function<void(const Message&)> callback);
    void unsubscribe(SubscriptionId id);
    void close();
    // Global sequence gaps observed by this Session, not per-topic losses.
    // Available after close; does not count gaps before connect.
    std::uint64_t skippedSequences() const noexcept;
#ifdef INTRAFLOW_DIAGNOSTICS
    Json diagnostics() const; // after close and all publishers stop
    Json writerActivity() const; // live atomic stage snapshot; diagnostic build only
#endif

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
    Impl& checked();
    std::int64_t publishRaw(const std::string&, const std::string&, const std::string&, const std::string&, const Json&);
    SubscriptionId subscribeRaw(const std::string&, const std::string&, const std::string&, const std::string&, std::function<void(const Message&)>);
};
inline Session connect(const std::string& name, const Options& options = Options()) {
    return Session(name, options);
}
}
