# Controlled C++ ROS 2 RMW comparison

Compares **CycloneDDS**, **FastDDS**, and **Zenoh**, all through the **exact same rclcpp C++ binary**. Only RMW_IMPLEMENTATION changes:
- rmw_cyclonedds_cpp
- rmw_fastrtps_cpp
- rmw_zenoh_cpp

Zenoh uses an independent rmw_zenohd router process, restarted for each Zenoh scenario to isolate graph state (not part of timed publisher discovery). ROS 2 Jazzy, Ubuntu 24.04, C++17/O3.

## Workload
- Independent processes: 1 publisher and N-1 subscribers for N=2,4,8,16.
- std_msgs/msg/UInt8MultiArray, identical payload content (8-byte sequence ID + 8-byte steady-clock sending timestamp + filler).
- Baseline: 1024 B at target 4000 msg/s and 16384 B at target 1500 msg/s for nodes 2/4/8/16.
- Stress: 1024 B at target 16000 msg/s and 16384 B at target 4000 msg/s for nodes 2/16. The stress profile deliberately overloads fan-out to show queueing and throughput limits.
- Each case is 2.5 s, **two repeats**, stack order rotated between repeats. The CSV profile field distinguishes baseline from stress.
- QoS: RELIABLE, KEEP_LAST(depth 128), VOLATILE, all three middleware.
- Same host for all processes, **not a wireless / cross-network benchmark**.

## Measurements
- **Cold graph-ready time** (graph_discovery_ms): from calling rclcpp::init in the publisher process to count_subscribers(topic) detecting all N-1 endpoints. Includes middleware startup, node and publisher creation, and RMW graph convergence. It is NOT pure DDS discovery.
- **Ready-to-match time** (ready_to_graph_ms): from completion of publisher creation to count_subscribers detection. If subscribers are already matched when publisher construction returns, this can be near zero and is NOT the full discovery duration. Publisher execution waits for all subscriptions before GO.
- **Actual publisher rate**: sent / publish_seconds. This may be below requested rate due to synchronous publish/backpressure/CPU overload. Stress-case offered rates are not an exact measure of each implementation's maximum capacity.
- **Per-receiver goodput**: received * nominal payload bytes / publish_seconds in MiB/s; both mean and aggregate recorded.
- **Delivery ratio**: mean receiver message count divided by actual sent count. A high delivery ratio with sender throttling **does not** mean the target offered rate was achieved.
- **p50/p99 latency**: receive callback monotonic time minus publish-before-send monotonic time; same host/process-independent steady clock; includes scheduling and queueing, **not inter-machine clock sync**.
- **Sequence gaps/duplicates**, count of subscribers seen, per-process worker errors, raw logs.

Both results.csv and individual case diagnostics are uploaded as workflow artifacts, including on failure. The benchmark marks a case successful when all participants ran and exchanged data; the delivery percentage remains a separate metric.

## Limitations and interpretation
- RMW implementations have different default transports, fragmentation, discovery/router configurations, and backpressure. rclcpp is fixed, but **transport implementations are not identical** by design.
- Zenoh requires a router process which consumes separate resources. Native DDS discovery is decentralized.
- No measurements of physical NIC throughput, wireless loss, discovery network bytes, allocator profiles, per-core CPU or memory utilization.
- Run-to-run and runner CPU variation means these are **measurements for this environment only**, not historical proof of a regression/improvement.
- Each subscriber uses a blocking-when-idle C++ executor spin_once with a 1 ms maximum wait; there is **no artificial 1 ms delay after each received message**. The initial run had such a bug and must not be interpreted as a transport benchmark.
- Publish-time stamping slightly precedes actual transport send and timestamps are read at callback entry; the latency estimates incorporate publication API overhead.

## Validation note

The first 72-case stress run showed 71 normal executions and one Zenoh subscriber-creation timeout after a 10s interest DeclareFinal warning. To avoid accumulating router state across cases, the suite now creates a fresh router per Zenoh case, independently of the timed publisher. The original failed run remains available for audit and must not be presented as a fully successful trial.
