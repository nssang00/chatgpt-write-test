#include <cito/detail/reliability.hpp>

#include <array>
#include <cassert>
#include <cstdint>

int main() {
    using namespace cito::detail::reliable;

    SenderHistory sender(
        8,
        32);

    std::array<
        std::array<std::uint8_t, 1>,
        5> payloads{};

    for (std::size_t i = 0;
         i < payloads.size();
         ++i) {
        payloads[i][0] =
            static_cast<std::uint8_t>(
                i + 1);
        assert(
            sender.publish(
                payloads[i]) ==
            i + 1);
    }

    // Simulate one middle loss. Healthy DATA carries no ACK.
    ReceiverWindow receiver(64);
    receiver.on_data(1);
    receiver.on_data(2);
    receiver.on_data(4);
    receiver.on_data(5);

    const auto nack =
        receiver.make_nack();

    assert(nack);
    assert(
        nack->base == 3);
    assert(
        nack->bitmap == 0x1);

    const auto plan =
        sender.plan_recovery(
            *nack);

    assert(
        plan.actions.size() ==
        1);
    assert(
        plan.actions[0].kind ==
        RecoveryKind::Retransmit);
    assert(
        plan.actions[0].first ==
        3);
    assert(sender.payload(3));

    receiver.on_data(3);

    assert(
        receiver.next_expected() ==
        6);
    assert(!receiver.make_nack());

    // Tail loss is found by heartbeat rather than per-message ACK.
    ReceiverWindow tail_receiver(64);

    for (SequenceNumber sequence = 1;
         sequence <= 4;
         ++sequence) {
        tail_receiver.on_data(
            sequence);
    }

    tail_receiver.on_heartbeat(
        sender.heartbeat());

    const auto tail_nack =
        tail_receiver.make_nack();

    assert(tail_nack);
    assert(
        tail_nack->base ==
        5);
    assert(
        tail_nack->bitmap ==
        0x1);

    const auto tail_plan =
        sender.plan_recovery(
            *tail_nack);

    assert(
        tail_plan.actions.size() ==
        1);
    assert(
        tail_plan.actions[0].kind ==
        RecoveryKind::Retransmit);
    tail_receiver.on_data(5);
    assert(!tail_receiver.make_nack());

    // KEEP_LAST history cannot recover old data, so it emits GAP and
    // recovery continues without growing history or blocking the writer.
    SenderHistory short_history(
        2,
        32);

    for (std::size_t i = 0;
         i < 4;
         ++i) {
        short_history.publish(
            payloads[i]);
    }

    ReceiverWindow late_receiver(64);
    late_receiver.on_heartbeat(
        short_history.heartbeat());

    const auto late_nack =
        late_receiver.make_nack();

    assert(late_nack);

    const auto late_plan =
        short_history.plan_recovery(
            *late_nack);

    assert(
        late_plan.actions.size() ==
        3);
    assert(
        late_plan.actions[0].kind ==
        RecoveryKind::Gap);
    assert(
        late_plan.actions[0].first ==
        1);
    assert(
        late_plan.actions[0].last ==
        2);

    assert(
        late_receiver.on_gap(
            Gap{1, 2}));

    late_receiver.on_data(3);
    late_receiver.on_data(4);

    assert(
        late_receiver.next_expected() ==
        5);
    assert(!late_receiver.make_nack());

    return 0;
}
