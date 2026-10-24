# Cito ROS 2 Jazzy bridge (experimental)

This is an **intermediate G5 integration prototype**, **not** a ROS 2 RMW backend
and not a claim of `rmw_cito` compatibility. It forwards
`/cito/input` (std_msgs/String) -> a Cito C ABI subscription/publisher
in the same process -> `/cito/output` (std_msgs/String).

The ROS2 Jazzy CI verifies one real `rclpy` topic round-trip. The bridge
currently uses a process-local Cito Context, so it does not demonstrate
inter-host ROS2 integration, QoS compatibility, ROS2 service support,
type support, ROS graph discovery or a native RMW.

`rmw_cito` remains to be implemented and conformantly tested before G5
can be marked complete.
