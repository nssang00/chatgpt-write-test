"""Minimal ROS 2 Jazzy message bridge, NOT an RMW implementation."""
from __future__ import annotations

import rclpy
from rclpy.node import Node
from std_msgs.msg import String

from cito import Context

# Bridge-local wire identity; native rmw_cito/type support is a separate goal.
STRING_TYPE_ID = 0xC1702001


class CitoRosBridge(Node):
    """Forward /cito/input -> Cito -> /cito/output with a stable C ABI."""

    def __init__(self):
        super().__init__("cito_ros_bridge")
        self._context = Context("ros2.bridge")
        self._ros_publisher = self.create_publisher(String, "/cito/output", 10)
        self._ros_subscription = self.create_subscription(
            String, "/cito/input", self._to_cito, 10)
        self._context.subscribe_raw(
            STRING_TYPE_ID, self._to_ros, "roundtrip")

    def _to_cito(self, message: String) -> None:
        self._context.publish_raw(
            STRING_TYPE_ID, message.data.encode("utf-8"), "roundtrip")

    def _to_ros(self, payload: bytes) -> None:
        message = String()
        message.data = payload.decode("utf-8")
        self._ros_publisher.publish(message)

    def destroy_node(self) -> bool:
        self._context.close()
        return super().destroy_node()


def main(args=None):
    rclpy.init(args=args)
    bridge = CitoRosBridge()
    try:
        rclpy.spin(bridge)
    finally:
        bridge.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
