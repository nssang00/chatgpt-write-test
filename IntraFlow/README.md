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

The build-time Python generator supports a deliberately limited subset: top-level struct, primitive members, unbounded string/sequence, previously defined nested struct. It does not support modules, enums, bounded types, arrays, unions, preprocessing or complete OMG IDL mapping yet. JSON is the transport representation, with strict topic name/type/schema identity. The generator is not a full IDL compiler; field validation and special numeric representations are future work.

Build: CMake + SQLite3 + nlohmann-json + Python3. On Ubuntu install libsqlite3-dev and nlohmann-json3-dev; on Windows use vcpkg toolchain. Run ctest --test-dir build -C Release --output-on-failure.

CI: five role processes (sensor, control, device, display, monitor) plus 32 symmetric peer processes. The peer test checks unique sender fan-out (including self) and message history; it is a smoke test, not a throughput benchmark or a certified maximum. No NativeWeb integration or main branch changes are intended.
