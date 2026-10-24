#!/usr/bin/env python3
"""ROS 2 Jazzy acceptance: ROS input -> Cito C ABI -> ROS output."""
import time

import rclpy
from rclpy.executors import SingleThreadedExecutor
from rclpy.node import Node
from std_msgs.msg import String

from cito_bridge.bridge import CitoRosBridge


def main():
    rclpy.init()
    bridge = CitoRosBridge()
    probe = Node("cito_ros_bridge_probe")
    incoming = []
    subscription = probe.create_subscription(
        String, "/cito/output", lambda msg: incoming.append(msg.data), 10)
    publisher = probe.create_publisher(String, "/cito/input", 10)
    executor = SingleThreadedExecutor()
    executor.add_node(bridge)
    executor.add_node(probe)
    target = "Cito ROS2 Jazzy roundtrip"
    try:
        deadline = time.monotonic() + 10
        last_publish = 0.0
        while time.monotonic() < deadline and target not in incoming:
            now = time.monotonic()
            if now - last_publish >= 0.1:
                msg = String()
                msg.data = target
                publisher.publish(msg)
                last_publish = now
            executor.spin_once(timeout_sec=0.03)
        if target not in incoming:
            raise RuntimeError("ROS2_CITO_LOCAL_BRIDGE_FAILED")
        print("ROS2_CITO_LOCAL_BRIDGE_PASS", flush=True)
    finally:
        executor.shutdown()
        probe.destroy_subscription(subscription)
        probe.destroy_publisher(publisher)
        probe.destroy_node()
        bridge.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
