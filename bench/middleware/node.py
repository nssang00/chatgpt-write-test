#!/usr/bin/env python3
"""One-process ROS2 DDS / Zenoh / gRPC-Protobuf benchmark worker."""
import argparse
import json
import queue
import threading
import time
from concurrent import futures
from pathlib import Path

def now():
    return time.monotonic_ns()

def write_json(path, value):
    Path(path).write_text(json.dumps(value), encoding="utf-8")

def make_payload(n, marker):
    assert n >= 13
    return marker.encode("ascii") + (b"0" * 12) + (b"x" * (n - 13))

def ros_setup(args, receiving, on_payload):
    import rclpy
    from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy
    from std_msgs.msg import String
    rclpy.init()
    node = rclpy.create_node("mw_bench_" + args.role + str(args.id))
    qos = QoSProfile(depth=64, reliability=ReliabilityPolicy.RELIABLE,
                     history=HistoryPolicy.KEEP_LAST)
    if receiving:
        sub = node.create_subscription(String, args.topic, lambda m: on_payload(m.data.encode("ascii")), qos)
        return (node, sub, lambda: None, lambda: (node.destroy_node(), rclpy.shutdown()))
    pub = node.create_publisher(String, args.topic, qos)
    message = String()
    def send(b):
        message.data = b.decode("ascii")
        pub.publish(message)
    return (node, pub, send, lambda: (node.destroy_node(), rclpy.shutdown()))

def zenoh_setup(args, receiving, on_payload):
    import zenoh
    session = zenoh.open(zenoh.Config())
    if receiving:
        sub = session.declare_subscriber(args.topic, lambda s: on_payload(s.payload.to_bytes()))
        return (None, sub, lambda: None, lambda: session.close())
    pub = session.declare_publisher(args.topic)
    return (None, pub, lambda b: pub.put(b), lambda: session.close())

class GrpcHub:
    def __init__(self, args):
        import grpc
        from google.protobuf.empty_pb2 import Empty
        from google.protobuf.wrappers_pb2 import BytesValue
        self.lock = threading.Lock()
        self.queues = []
        self.dropped = 0
        self.done = False
        self.grpc = grpc
        self.BytesValue = BytesValue
        self.server = grpc.server(futures.ThreadPoolExecutor(max_workers=40),
                                  options=[("grpc.max_send_message_length", 4 * 1024 * 1024)])
        def subscribe(req, context):
            q = queue.Queue(maxsize=128)
            with self.lock:
                self.queues.append(q)
            try:
                while context.is_active():
                    try:
                        msg = q.get(timeout=0.2)
                        yield BytesValue(value=msg)
                    except queue.Empty:
                        if self.done:
                            break
            finally:
                with self.lock:
                    if q in self.queues:
                        self.queues.remove(q)
        handler = grpc.method_handlers_generic_handler(
            "bench.Streamer", {
                "Subscribe": grpc.unary_stream_rpc_method_handler(
                    subscribe,
                    request_deserializer=Empty.FromString,
                    response_serializer=BytesValue.SerializeToString)
            })
        self.server.add_generic_rpc_handlers([handler])
        bound = self.server.add_insecure_port("127.0.0.1:" + str(args.port))
        if not bound:
            raise RuntimeError("gRPC port binding failed")
        self.server.start()

    def send(self, b):
        with self.lock:
            clients = list(self.queues)
        for q in clients:
            try:
                q.put_nowait(b)
            except queue.Full:
                self.dropped += 1

    def close(self):
        self.done = True
        self.server.stop(grace=1).wait(timeout=3)

def grpc_subscribe(args, on_payload):
    import grpc
    from google.protobuf.empty_pb2 import Empty
    from google.protobuf.wrappers_pb2 import BytesValue
    channel = grpc.insecure_channel("127.0.0.1:" + str(args.port),
             options=[("grpc.max_receive_message_length", 4 * 1024 * 1024)])
    rpc = channel.unary_stream(
        "/bench.Streamer/Subscribe",
        request_serializer=Empty.SerializeToString,
        response_deserializer=BytesValue.FromString)
    try:
        for response in rpc(Empty(), timeout=25):
            on_payload(response.value)
    finally:
        channel.close()

def publisher(args):
    root = Path(args.directory)
    heartbeat = make_payload(args.bytes, "H")
    data = make_payload(args.bytes, "D")
    hub = None
    state = None
    if args.impl.startswith("dds-"):
        state = ros_setup(args, False, None)
        send = state[2]
    elif args.impl == "zenoh":
        state = zenoh_setup(args, False, None)
        send = state[2]
    else:
        hub = GrpcHub(args)
        send = hub.send
    (root / "publisher_ready").write_text(str(now()))
    deadline = time.monotonic() + 12
    while not (root / "GO").exists() and time.monotonic() < deadline:
        send(heartbeat)
        time.sleep(0.05)
    if not (root / "GO").exists():
        raise RuntimeError("GO timeout")
    period = 1.0 / args.rate
    stop = time.monotonic() + args.seconds
    next_due = time.monotonic()
    sent = 0
    started = now()
    while time.monotonic() < stop:
        current = time.monotonic()
        if current < next_due:
            time.sleep(next_due - current)
        send(data)
        sent += 1
        next_due += period
        if time.monotonic() - next_due > 0.05:
            next_due = time.monotonic()
    ended = now()
    write_json(root / "publisher.json", {
        "sent": sent, "send_seconds": (ended-started)/1e9,
        "app_bytes": args.bytes, "grpc_queue_drops": hub.dropped if hub else None
    })
    time.sleep(0.8)
    if hub:
        hub.close()
    elif state:
        state[3]()

def subscriber(args):
    root = Path(args.directory)
    first = None
    count = 0
    go_ns = None
    def on_payload(b):
        nonlocal first, count
        if not b:
            return
        if first is None:
            first = now()
            (root / ("first_" + str(args.id))).write_text(str(first))
        if b[:1] == b"D":
            count += 1
    state = None
    if args.impl.startswith("dds-"):
        import rclpy
        state = ros_setup(args, True, on_payload)
    elif args.impl == "zenoh":
        state = zenoh_setup(args, True, on_payload)
    (root / ("ready_" + str(args.id))).write_text(str(now()))
    if args.impl == "grpc":
        # Service discovery is gRPC channel connection and stream subscription.
        grpc_subscribe(args, on_payload)
    else:
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            if go_ns is None and (root / "GO").exists():
                go_ns = int((root / "GO").read_text())
            if go_ns is not None and now() > go_ns + int((args.seconds + 1.5) * 1e9):
                break
            if args.impl.startswith("dds-"):
                rclpy.spin_once(state[0], timeout_sec=0.005)
            else:
                time.sleep(0.005)
        state[3]()
    write_json(root / ("subscriber_" + str(args.id) + ".json"), {
        "received": count, "first_ns": first, "id": args.id
    })

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    for opt in ["role", "impl", "directory", "topic"]:
        p.add_argument("--" + opt, required=True)
    for opt in ["bytes", "port", "id", "rate"]:
        p.add_argument("--" + opt, type=int, required=True)
    p.add_argument("--seconds", type=float, default=2.5)
    a = p.parse_args()
    try:
        if a.role == "pub":
            publisher(a)
        else:
            subscriber(a)
    except Exception:
        import traceback
        traceback.print_exc()
        raise
