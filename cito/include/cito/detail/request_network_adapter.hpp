#pragma once

#include <cito/detail/request_transport.hpp>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <optional>
#include <span>
#include <stdexcept>
#include <unordered_map>
#include <utility>

namespace cito::detail {

struct RequestNetworkStart {
    RequestId request_id{};
    DestinationId destination{};
    bool sent{false};
};

class RequestNetworkAdapter {
public:
    using SessionSend =
        std::function<bool(
            std::span<const std::uint8_t>)>;

    using SendReply =
        RequestTransportCore::SendReply;

    RequestNetworkAdapter(
        HostRuntimeCore& host,
        RequestReplyCore& requests)
        : host_(host),
          transport_(
              host,
              requests) {}

    bool attach_session(
        DestinationId destination,
        SessionSend send) {
        if (
            destination == 0 ||
            !send) {
            throw std::invalid_argument(
                "Cito request network: invalid session");
        }

        const auto [it, inserted] =
            sessions_.insert_or_assign(
                destination,
                std::move(send));

        (void)it;
        return inserted;
    }

    bool detach_session(
        DestinationId destination,
        RequestStatus pending_status =
            RequestStatus::Unavailable) {
        const auto removed =
            sessions_.erase(
                destination) != 0;

        transport_.fail_destination(
            destination,
            pending_status);

        return removed;
    }

    bool has_session(
        DestinationId destination)
        const noexcept {
        return
            sessions_.contains(
                destination);
    }

    std::optional<DestinationId>
    ready_destination(
        const RequestKey& key)
        const noexcept {
        const auto capability =
            request_handler_interest_key(
                key);

        const auto& destinations =
            host_.remote_destinations(
                capability);

        std::optional<DestinationId>
            selected;

        for (const auto destination :
             destinations) {
            if (!sessions_.contains(
                    destination)) {
                continue;
            }

            if (
                !selected ||
                destination <
                    *selected) {
                selected =
                    destination;
            }
        }

        return selected;
    }

    bool can_send(
        const RequestKey& key)
        const noexcept {
        return
            ready_destination(
                key)
                .has_value();
    }

    RequestNetworkStart start(
        AppId requester_app,
        const RequestKey& key,
        std::span<const std::uint8_t>
            payload,
        RequestReplyCore::Completion
            completion) {
        const auto destination =
            ready_destination(
                key);

        if (!destination) {
            if (!completion) {
                throw std::invalid_argument(
                    "Cito request network: completion is empty");
            }

            completion(
                RequestStatus::
                    Unavailable,
                {});
            return {};
        }

        auto packet =
            transport_.start_to(
                requester_app,
                key,
                *destination,
                payload,
                std::move(
                    completion));

        if (!packet) {
            return {};
        }

        const auto request_id =
            packet->request_id;

        const auto session_it =
            sessions_.find(
                *destination);

        if (
            session_it ==
            sessions_.end()) {
            transport_.fail_request(
                request_id);
            return {
                request_id,
                *destination,
                false};
        }

        auto send =
            session_it->second;

        bool sent = false;

        try {
            sent =
                send(packet->bytes);
        } catch (...) {
            sent = false;
        }

        if (!sent) {
            transport_.fail_request(
                request_id);
        }

        return {
            request_id,
            *destination,
            sent};
    }

    std::size_t cancel_requests(
        AppId requester_app) {
        auto packets =
            transport_.cancel_requests(
                requester_app);

        for (auto& packet : packets) {
            const auto session_it =
                sessions_.find(
                    packet.destination);

            if (
                session_it ==
                sessions_.end()) {
                continue;
            }

            auto send =
                session_it->second;

            try {
                (void)send(
                    packet.bytes);
            } catch (...) {
                // Local correlation is already cancelled. Transport cleanup
                // is best effort during app teardown.
            }
        }

        return packets.size();
    }

    std::size_t drop_requests(
        AppId requester_app) {
        auto packets =
            transport_.drop_requests(
                requester_app);

        for (auto& packet : packets) {
            const auto session_it =
                sessions_.find(
                    packet.destination);

            if (
                session_it ==
                sessions_.end()) {
                continue;
            }

            auto send =
                session_it->second;

            try {
                (void)send(
                    packet.bytes);
            } catch (...) {
                // Requester state is already abandoned. Teardown transport
                // cancellation is best effort.
            }
        }

        return packets.size();
    }

    bool cancel(
        RequestId request_id) {
        auto packet =
            transport_.cancel(
                request_id);

        if (!packet) {
            return false;
        }

        const auto session_it =
            sessions_.find(
                packet->destination);

        if (
            session_it ==
            sessions_.end()) {
            return false;
        }

        auto send =
            session_it->second;

        try {
            return send(
                packet->bytes);
        } catch (...) {
            return false;
        }
    }

    bool receive(
        RequestPeerId peer,
        std::span<const std::uint8_t>
            bytes,
        SendReply send_reply = {}) {
        const auto frame =
            decode_request_transport_frame(
                bytes);

        switch (frame.kind) {
            case RequestTransportKind::
                Request:
                return transport_.
                    on_request(
                        peer,
                        bytes,
                        std::move(
                            send_reply));

            case RequestTransportKind::
                Reply:
                return transport_.
                    on_reply(
                        static_cast<
                            DestinationId>(
                            peer),
                        bytes);

            case RequestTransportKind::
                Cancel:
                return transport_.
                    on_cancel(
                        peer,
                        bytes);
        }

        return false;
    }

    std::size_t drop_peer(
        RequestPeerId peer) {
        return transport_.drop_peer(
            peer);
    }

    std::size_t session_count()
        const noexcept {
        return sessions_.size();
    }

    RequestTransportCore& transport()
        noexcept {
        return transport_;
    }

    const RequestTransportCore&
    transport() const noexcept {
        return transport_;
    }

private:
    HostRuntimeCore& host_;
    RequestTransportCore transport_;

    std::unordered_map<
        DestinationId,
        SessionSend> sessions_;
};

} // namespace cito::detail
