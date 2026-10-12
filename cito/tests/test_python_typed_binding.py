from __future__ import annotations

import cito
import position


def main() -> None:
    received: list[
        position.Position] = []

    value = position.Position(
        x=10.5,
        y=-4.25,
        frame="map",
        timestamp=42,
        frame_kind=position.FrameKind.Map,
    )

    class CountingMessage:
        TYPE_ID = 777

        def __init__(self) -> None:
            self.encodes = 0

        def encode(self) -> bytes:
            self.encodes += 1
            return b"counted"

    with cito.Context(
        "acme") as ctx:
        sub = ctx.on(
            position.Position,
            received.append,
            "drone_17")

        assert ctx.has_demand(
            position.Position,
            "drone_17")
        assert not ctx.has_demand(
            position.Position,
            "drone_18")

        counting = CountingMessage()
        assert (
            ctx.publish(
                counting,
                "nobody") ==
            0)
        assert counting.encodes == 0

        assert (
            ctx.publish(
                value,
                "drone_18") ==
            0)
        assert received == []

        assert (
            ctx.publish(
                value,
                "drone_17") ==
            1)

        assert received == [value]
        assert isinstance(
            received[0],
            position.Position)

        sub.close()
        assert not ctx.has_demand(
            position.Position,
            "drone_17")

        assert (
            ctx.publish(
                value,
                "drone_17") ==
            0)


if __name__ == "__main__":
    main()
