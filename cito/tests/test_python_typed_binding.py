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

    with cito.Context(
        "acme") as ctx:
        sub = ctx.on(
            position.Position,
            received.append,
            "drone_17")

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

        assert (
            ctx.publish(
                value,
                "drone_17") ==
            0)


if __name__ == "__main__":
    main()
