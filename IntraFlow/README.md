# IntraFlow — lightweight local inter-process messaging

Independent C++11 prototype, no broker or network sockets. All participants use the same local SQLite database path (not a network filesystem).

```cpp
#include <intraflow.hpp>
#include "Messages.hpp"

auto app = intraflow::connect("ControlApp");
app.subscribe<Status>("system.status", [](const Status& value) {
    // Runs on this session's receive thread.
});
Command cmd{};
cmd.code = 7;
app.publish("system.command", cmd);
```

API: connect, publish (returns committed sequence or throws), subscribe (returns ID), unsubscribe, subscribeAll, close. One receive/dispatch thread per session; publish uses caller thread and may block. Callbacks are sequential, run without internal locks, and may publish. Keep captured objects alive until close; do not move/destroy/close a session in its callback. Unsubscribe stops future dispatch snapshots but an already selected callback may still run. Concurrent close/move with API calls is not supported. Subscription begins at registration's DB high-water mark; own messages are delivered. No delivery acknowledgement, durable cursor, replay or exactly-once claim. Database is trusted local data, with no authentication. Use a read-only viewer; retention and DB growth management are not implemented yet.

The build-time Python generator supports a deliberately limited subset: top-level struct, primitive members, unbounded and bounded string/sequence, fixed and multidimensional arrays, previously defined nested struct. It does not support modules, enums, unions, preprocessing or complete OMG IDL mapping yet. JSON is the transport representation, with strict topic name/type/schema identity. The generator is not a full IDL compiler; fixed array lengths and bounded string/sequence lengths are checked on encode and decode; strict primitive numeric validation and special numeric representations remain future work.

Build: CMake + SQLite3 + nlohmann-json + Python3. On Ubuntu install libsqlite3-dev and nlohmann-json3-dev; on Windows use vcpkg toolchain. Run ctest --test-dir build -C Release --output-on-failure.

CI: five role processes (sensor, control, device, display, monitor) plus 32 symmetric peer processes. The peer test checks unique sender fan-out (including self) and message history; it is a smoke test, not a throughput benchmark or a certified maximum. No NativeWeb integration or main branch changes are intended.

## Scale and performance tests

The benchmark launches 32, 64, 128 and 256 independent OS processes, each
publishing and subscribing to one topic. Every case commits 256 messages
(8, 4, 2, 1 messages per process respectively), with an exact sender/index
matrix and a 64-byte string checked by every receiver. Self-delivery is
included. Each test fails on a missing, duplicate, invalid or extra message,
unexpected history, timeout or process error. This is a concurrent burst
benchmark; it is not a sustained-rate or maximum-capacity certification.

Run `ctest --test-dir build -C Release -LE benchmark --output-on-failure`
for functional tests and `ctest --test-dir build -C Release -L benchmark -V`
for scale tests. JSON reports are written to `build/benchmarks/`.
GitHub Actions uploads them per operating system even if a later test fails.
Optional Python psutil (installed by CI) samples aggregate process RSS and
thread count; RSS includes shared pages and sampled peaks are not exact.
Publish call duration uses a monotonic clock. End-to-end latency uses the
same host's UTC system clock, from before publish to listener entry (includes
write-lock wait). Negative latency fails the test as a clock anomaly.
Throughput includes the start barrier, publish, delivery, and completion
reporting overhead, not setup. Results depend on the host and workload.

## Large payloads and SQLite inspection

See examples/Messages.idl DeviceData. Fixed arrays map to std::array,
dynamic sequences to std::vector, strings to std::string. Bounded strings
count UTF-8 bytes (an IntraFlow convention); bounds are enforced on encode
and decode. The total serialized JSON message limit remains 1 MiB, including
escaping and structural overhead. Receive batches stop at 256 messages or
after reaching approximately 4 MiB of raw JSON text (one message may cross
the threshold; parsed JSON can use more memory).

The large_payload_sqlite CTest launches two separate processes, verifies
a full structured payload containing 512 KiB document + 256 KiB bounded
text, nested arrays and strings, tests invalid bounds and oversized
messages, and reads the actual DB using Python sqlite3. It retains a
checkpointed sample at build/examples/intraflow-large.db; CI uploads it.
Inspect with DB Browser for SQLite or Python sqlite3:
```sql
SELECT seq, topic, sender, timestamp, length(CAST(payload AS BLOB)) AS bytes
FROM messages ORDER BY seq;
SELECT name, type, hash, schema FROM topics;
```
The actual payload is stored as SQLite TEXT JSON, one row per message,
not one column per field. Open a live database read-only. Do not copy just
the main file while a writer is active; use SQLite backup or checkpoint
after all sessions close. The sample contains only synthetic test data.
