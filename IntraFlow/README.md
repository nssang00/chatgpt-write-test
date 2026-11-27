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

## Standalone applications

Build targets SensorApp, ControlApp, DeviceApp, DisplayApp, MonitorApp are
independent executables using the same Messages.idl. Pass a common absolute
database path as the first argument, or run from one directory with the
default intraflow.db. Start MonitorApp, DisplayApp, DeviceApp, ControlApp,
then SensorApp in separate terminals. Each prints READY after subscribing.
In SensorApp enter a numeric reading (e.g. 25.5); the control app publishes
a command, device app publishes status, display and monitor show results.
Enter q in SensorApp or press Enter in the other apps to stop. The samples
do not replay messages sent before subscription. The monitor logs JSON to
stdout and truncates the displayed payload to 512 bytes (the DB retains it).
The original app.cpp remains the automation-only multi-role test peer.

## Stability gates

CTest standalone_examples exercises all five actual executable targets
with independent processes, verifies their output and persisted topic
history, then stops and restarts the display process after forced termination.
CTest callback_concurrency_recovery verifies four concurrent writers on a
single session, per-publisher order and exact receive matrix, single callback
thread, mutable callback state, self-unsubscribe, callback exceptions,
late subscription, type mismatch, bounded SQLite lock failure and retry,
and successful reopening after a forced process exit during an uncommitted
SQLite transaction. These are focused regression tests, not a long-duration
soak or proof of all concurrency/lifetime behavior. No durable delivery or
offline replay is implied.

## Repeated 30-process mixed-topic traffic

`ctest --test-dir build -C Release -L multitopic -V` starts 30 independent
processes per profile. Six groups of five publish four typed topics each
(sensor, status, command, log); each process subscribes to all four topics
in its own group and the preceding group, for 24 topics and 240 typed
subscriptions. Five publishers and ten receivers per topic (including self).
The four payloads include fixed arrays, nested structures, bounded vectors
and a 4096-byte string. Every source/topic has an independent sequence.

Two independent 6-second target schedules run on Windows and Linux:
normal periods 20/40/100/200 ms, fast periods 10/20/50/100 ms.
Each process schedules against steady-clock deadlines, with a small
phase offset; if it falls behind it catches up without dropping sends.
This means the target window can extend under contention; the reports
include actual elapsed time, deadline lateness, actual per-topic send gaps,
publish-call and delivery latency, throughput, sampled RSS and threads.
These are requested periods, not hard real-time guarantees. The test fails
on missing, duplicate, out-of-order or invalid typed payloads, worker
failure, unexpected database history, or integrity check failure. A
cross-process barrier ensures all subscribers register before any send.
A second barrier ensures all writers finish before receivers close.
The JSON reports and checkpointed synthetic SQLite snapshots are uploaded
as `intraflow-traffic-<os>`. The workload keeps full history and does not
test retention or hour-long operation. No external network traffic.

## Small runtime, bounded latency trade-offs

The public messaging API and single receiver thread remain unchanged. The
runtime reuses two prepared statements per session, caches verified topic
identities, uses one autocommit INSERT per publish, and parses JSON only
for matched subscriptions after releasing the read transaction. Topic
registration is independently committed: a failed first publish can leave
an empty registered topic, just as a subscription can. Topic metadata must
not be externally modified while sessions are active.

WAL connections default to SQLite synchronous=NORMAL for IPC throughput.
A successful publish still means SQLite completed the transaction; it does
not mean a listener ran. With NORMAL, a power failure or OS crash can lose
recent commits even though application-process crashes are recoverable.
Set `Options::full_sync = true` for FULL durability at higher write cost.
The transport is not hard real-time; SQLite still permits only one writer
at a time. No extra server, queue, worker pool or batch API is introduced.

The same 30-process tests retain their periods and expected counts; there
is no lowered load or relaxed correctness gate to obtain a pass. Failed
worker logs and SQLite statement context help distinguish contention from
other errors.

## Lambda callback API regression

CTest `lambda_listener_api` exercises the existing C++11 subscription
API: captureless lambda, reference and value capture, mutable lambda,
free function, std::function, member function via [this], std::bind,
multiple listeners on one topic, raw subscribeAll, empty callback
rejection, unsubscribe before publication, self-unsubscribe, registration
and publication inside a callback, exception isolation, and single
receive-thread dispatch. A second Session publishes five inputs; the
test verifies the replies and nested subscription in SQLite. No new
runtime API, thread pool or async publish semantics are introduced.
Publish still returns the committed sequence or throws. Callbacks must
return promptly; copy data for asynchronous user work, and keep captures
alive until close. Move-only lambdas are not supported by std::function
in C++11.

## Rare slow listener work (no built-in worker pool)

Listeners execute sequentially on the session receive thread. Keep them
short. For infrequent independent long tasks, a user-owned thread is
sufficient; copy the message, handle all worker exceptions, and bound
concurrent work. For example, only when task lifetime is independent:

```cpp
app.subscribe<Command>("system.command", [](const Command& cmd) {
    std::thread([cmd] {
        try {
            heavyProcess(cmd);
        } catch (...) {
            // Report the failure to the application; do not let it escape.
        }
    }).detach();
});
```

Include <thread>. Detached work is NOT managed by Session::close(), must
not outlive any captured resources, and may be terminated by process exit.
If work uses the session or other application resources, prefer an owned
joinable thread, stop accepting new work and join it before destroying
those resources. For frequent tasks use a bounded application-owned queue
and persistent worker instead of a thread per message.

CTest `slow_listener_thread_offload` compares a deliberately blocked
direct listener with a detached lambda using a copied Command and shared
lifetime state. Each scenario sends 100 messages at a 10 ms target gap
while one rare slow task remains pending. An independent session must
receive all 100; the direct session receives zero before release and all
100 afterward, while the offloaded session must receive all 100 before
release. A promise completed at thread exit confirms detached work has
finished in the test. The Python harness verifies the exact SQLite rows.
This is a controlled blocking scenario, not a CPU saturation benchmark.
The runtime/API and thread count per Session are unchanged.

## Pilot deployment status

Suitable for evaluation in trusted local processes, built from source.
Before unrestricted production use: define and test bounded database
retention, run sustained-load tests on target hardware, and validate a
versioned installable SDK with its SQLite/JSON dependencies. Review
application shutdown and error handling and document supported IDL subset,
limits and the absence of durable delivery. Do not claim hard real-time
or guaranteed recovery of undelivered messages.

## Diagnostic-only SQLite PRAGMA comparison

Run `ctest --test-dir build -C Release -L pragma -V`. Six cases reuse
the same 30-process fast workload (32,400 commits, 324,000 callbacks,
six-second target), each with a fresh DB. Native autocheckpoint default
(-1), 1000, 4000, 8000 and 0 pages use the original SQLite busy handler.
A separate 1000-page hooks case replaces the busy handler with bounded
backoff and the WAL hook with a timed PASSIVE checkpoint; its timings
are diagnostic, not identical to the native retry algorithm. Hook
counters include topic registration. Reader busy handling remains native.
Zero is for short diagnostics only, not a production setting.

Actual writer/reader PRAGMAs and SQLite version are recorded before
hook replacement, with sampled peak WAL size, insert step time, actual
poll wait, query batch, JSON parsing, typed callback and the slowest
INSERT's busy and checkpoint time. Native cases cannot directly observe
busy-handler or checkpoint duration (zero counters mean uninstrumented,
not no contention). Aggregate time across processes is not wall time.
All original correctness gates remain. Normal library API and defaults
are unchanged. CI uploads JSON as intraflow-pragma-<os>. Do not deploy
the diagnostic build.

## Windows latency improvement experiment

`ctest --test-dir build -C Release -L winlatency -V` (Windows only)
compares four modes at the existing 1000-page native autocheckpoint:
native, process-scoped timeBeginPeriod(1), a 1–5 ms jittered writer
busy retry, and both. Each mode runs three times on the same CI runner
in rotated order with fresh DBs and identical 30-process fast traffic.
All modes retain native WAL checkpoint behavior; the older hooks mode
remains a separate diagnostic. The short retry uses an elapsed-time
deadline per busy episode and sqlite3_sleep, not spin waiting; actual
sleep may exceed the requested time. No strict per-publish latency
guarantee is implied. Timer requests are checked and paired with
timeEndPeriod(1) on exit. Only the test peer links winmm. Report peer
CPU seconds (sampled before go and after results), actual polling,
throughput, tail latency, WAL size and correctness. Native modes do not
measure busy wait directly; zero counters mean uninstrumented.
Do not compare timer effect solely across separate CI runners.
No production default changes, extra worker threads, or new user API.
CI uploads the 12 JSON reports as intraflow-winlatency. Select a
production change only after repeated results and target-host testing.

## Single-owner checkpoint experiment (diagnostic only)

CI #20 showed the 1 ms timer reduced actual waits, but one timer-only
run failed with database locked; jittered retry and combined runs had
unstable tails. The normal runtime stays unchanged. The 12 Windows
timer/retry experiments remain runnable with CTest -L winlatency and
in manual workflow dispatch; they are not part of the default push
workflow while investigating checkpoint ownership. Their #20 failure
is not waived or treated as a successful result.

CTest -L checkpoint runs three rotated repetitions of native 1000-page
autocheckpoint vs all writers autocheckpoint=0 with one designated
peer (App0) running PASSIVE every 100 or 250 ms, on both platforms.
Same 30 processes, 24 topics, fast profile, native timer and busy
handler. No extra process or thread: App0 uses a separate writable
connection on its existing receive loop after the SELECT is reset
and callbacks return. Checkpoint does not wait for reader/writer
locks, but can still perform disk I/O and delay that peer's listeners.
There is no FULL/RESTART/TRUNCATE during traffic; final cleanup and
integrity verification are unchanged. Record duration, BUSY/errors,
partial progress, WAL frames, sampled file size, CPU, all latency
metrics and owner vs other receivers. Require actual checkpoint
progress and the original exact delivery/database gates. Frame counts
are snapshots, and file size is not the same as pending frames.
A designated owner is a test fixture, not a server. Owner crash or
slow callback can prevent future checkpoints; no failover or WAL
hard cap is implemented. Do not deploy autocheckpoint=0 based on this
short experiment. Production would require a bounded maintenance
policy and sustained load/owner failure tests. No API/default changes.

## Load envelope and one-hour continuous test

CI #22 passed on both platforms, but the single-owner checkpoint
experiment did not reliably improve latency or WAL reuse. Keep native
SQLite autocheckpoint, default timers and busy handling. The checkpoint
comparison remains available manually; no owner election or production
runtime changes are introduced.

Run CTest -L load_sweep for 30, 300, 900, 1800, 2700 and 5400 publishes/s
(ten receivers per message). Each tier uses 30 processes, 24 topics,
36 seconds, fresh DB, SDK defaults (poll 10 ms, busy timeout 5000 ms).
30/s uses equal rates of the four types, other tiers retain the fast
profile's 10:5:2:1 ratio. Deterministic per-process/type phase offsets
spread scheduled starts; these are not the original burst stress tests
(5 ms/30 s test settings). No skipped sends; catch-up is included in
deadline lateness, actual gaps and measured throughput. Test success
means exact message counts and integrity, not a latency SLA. One run
per tier is exploratory, not a certified operating limit.

CTest -L '^endurance$' runs the same 300/s profile continuously for
one hour (1,080,000 publishes, 10,800,000 deliveries). Until actual user
traffic is known, 300/s is an illustrative moderate target, not a
requirement. Retain the same processes and DB; no restart between windows.
The harness samples resource sizes, peer CPU time, latency and deadline
metrics; reports resource samples about once per minute. It retains
all timing samples in memory for exact quantiles and validates the
whole DB after traffic, so RSS includes test instrumentation. No DB
snapshot artifact for load/endurance (avoid large uploads). No retention
yet; 4 GiB DB+WAL or <2 GiB free disk aborts the test visibly, not
silently reducing load. The real DB is deleted with the temporary test
directory after checks; only JSON results uploaded. CI runs the hour
test in separate PR/manual jobs (100 min timeout); future routine CI
may move endurance to manual after initial validation. It is not proof
of indefinite operation or durable offline delivery.

## Bounded message history (default on)

IntraFlow is a transient IPC buffer, not an archival log. Options defaults:
retention_sec=60, max_messages=100000, cleanup_interval_ms=1000.
Set both limits to zero for full history. Every Session sharing a DB
must use the same policy (including interval); first open persists it
in intraflow_retention and subsequent mismatches are rejected. Existing
DBs without this table adopt the first opener's policy; back up any
history that must be preserved and close older library versions before
upgrade. To change policy use a new DB after stopping all sessions.
Do not edit metadata or triggers externally.

A SQLite AFTER INSERT trigger prunes at most 256 oldest messages every
128 committed sequence numbers or after the configured wall-clock
interval, whichever occurs first. No new thread, connection, server,
owner election or competing cleanup transaction. The cleanup is part
of the successful publish transaction; its cost is included in publish
latency. Sequence-window cutoff uses AUTOINCREMENT, not COUNT(*).
Age pruning removes a prefix and can be delayed by clock changes,
backlog or inactivity. No cleanup during idle periods, no timer-driven
expiry guarantee. The limits are soft (up to 127 extra rows in a
steady contiguous stream, more during migration/backlog); not a byte
quota. A large message or long-lived WAL reader can still grow disk
usage. Freed database pages can be reused; SQLite file size does not
necessarily shrink, and VACUUM is not run during IPC.

Receive cursors and new subscription boundaries use sqlite_sequence
rather than MAX of retained rows. Session::skippedSequences() reports
global missing sequence numbers observed after connect, even after
close; this includes topics the Session did not subscribe to and is
not a count of lost callbacks. It is not a durable delivery guarantee.
An excessively slow listener can miss pruned messages. Tests retain
exact per-receiver correctness; history is verified as a contiguous
suffix including the last sequence and each publisher's last index.
Legacy 6-second diagnostic profiles explicitly disable retention for
full history; load sweep and 1-hour test now exercise the defaults and
report retained/pruned counts, age span, page counts and skipped
sequences. No Windows writer mutex change in this commit; isolate
retention behavior before addressing the existing lock failure.

## Experimental process writer serialization

Options::serialize_writers (default false) is an opt-in experiment.
All processes sharing a DB must use the same setting; persisted
intraflow_writer_policy rejects mixed modes. Use a new DB to change
mode; stop old SDK processes first. The Windows backend uses a named
kernel mutex based on the DB file identity, accepting WAIT_ABANDONED
as ownership. Linux uses flock on <canonical-db>.writer.lock with
nonblocking attempts and 1 ms sleeps up to busy_ms. Never remove this
sidecar while a process may use the DB. Use local files under one
trusted user, no hard-link aliases, replacement, forked inherited
sessions, or external writers. Cross-user ACLs are not configured.
The mutex is acquired before WAL/schema initialization, topic
registration and publish (including retention trigger and native
autocheckpoint). SQLite opens connections before the OS guard to
establish file identity; native recovery and final connection close
are still SQLite's responsibility. Read polling and callback dispatch
do not acquire the process lock. JSON serialization is before lock.
No extra worker thread or server. The timeout applies to each OS
lock acquisition, separately from SQLite busy timeout and local
mutex wait; no hard end-to-end deadline or FIFO guarantee. Linux
uses a small sleep, not a spin; this may affect fairness/throughput.

CTest writer_mutex_recovery holds the actual internal OS lock and an
uncommitted SQLite transaction in a child; an existing Session must
time out, then after forced child termination receive a committed
message, with exact SQLite sequence and rollback verification.
Two same-process Sessions also publish concurrently.
CTest -L writer_compare compares native and opt-in mode using the
same diagnostic build, retention on, 10 ms polling, 5 s busy timeout,
native autocheckpoint, 30 peers, 36 s, rates 300/900/2700/5400.
Report OS guard wait and SQLite INSERT separately (native guard is
a no-op); existing uninstrumented load sweep remains baseline.
Run comparison even if baseline load fails. One pair per rate is
exploratory; the one-hour test now opts into serialization at 300/s.
No production default change or SQL topic filtering in this commit.

## Experimental SQL topic filtering and operating load

Options::filter_topics defaults false; it is a per-Session choice,
independent of the shared writer policy. In filtered mode the receive
loop takes a short read snapshot under listeners_mu, reads the global
high-water and oldest retained seq, and selects only subscribed topics
with a cached bound IN query. subscribeAll or >64 distinct topics use
the raw query; no subscription skips payload reads. Snapshot completion
advances the cursor only when all matching rows have been fetched.
A new subscription takes its high-water after this snapshot (no lost
post-registration row); callbacks are outside both DB transaction and
locks. Pruned prefix gaps are counted; intentional topic skips are not.
This assumes library-managed prefix-only retention, not arbitrary
external deletes. Diagnostics measure raw rows/bytes transferred,
not SQLite internal scanned rows. The short read transaction and SQL
planning may themselves add overhead.

CI #28: serialized Windows 300/s improved mean 62.05 -> 22.01 ms
and WAL 46.28 -> 3.96 MiB, but one-hour test failed at 406.68 s
with OS lock timeouts. Do not enable either experiment by default.
Diagnostic-only atomic writer activity distinguishes OS wait,
topic/bind, SQLite step/commit/autocheckpoint (combined), and
reset/unlock. Test-only watchdog samples every 500 ms and logs
stalls >=500 ms; per-peer log tails are retained on failed runs.
A stall inside sqlite3_step does not identify the internal cause.
No production watchdog or additional SDK thread.

Operational candidate tiers: 30,100,300,900 aggregate publishes/s
with 30 processes and ten deliveries per publish. 100/s uses periods
600/1000/2000/6000 ms (not the fast mix), 30/s equal rates.
2700/5400 are stress tests, not expected production requirements.
All historical tests remain; new raw-vs-filter pairs keep the same
writer mutex, retention, timer and SQLite options. High stress
comparisons have a separate label but are still run and failures
remain visible. One-hour tests at 100 and 300/s on both platforms
use mutex+filter and diagnostics; 100/s is an exploratory lower
load, not a demonstrated safe operating range. A completed test
requires exact deliveries and DB suffix integrity; rate and latency
are separately assessed, not guaranteed by PASS.

## Windows stall investigation (diagnostics only)

CI #30 Windows 300/s failed at 42.44 s: peer 29 remained in
sqlite3_step/commit/autocheckpoint for at least 10583 ms, with other
peers timing out on the process writer mutex. This is not evidence
that the mutex itself is broken, or that checkpoint is definitively
responsible. The failure preceded the 60 s age limit and 100000-row
limit, so bulk retention deletion is not needed to reproduce it.

The rootcause tests use the same 30 peers, 300/s, 10 ms poll, 5 s
timeout, mutex+filter, retention and NORMAL durability. Four modes,
two fresh DB trials in rotated order, 180 s each:
root_native (native checkpoint and busy), root_checkpoint (timed
PASSIVE WAL hook only, native busy), root_hooks (timed WAL hook and
approximate instrumented busy handler), root_off (no autocheckpoint,
native busy). All four trace Win32 SQLite VFS syscalls, not the
application's own mutex. No checkpoint-disabled production setting.
The 4 GiB test disk limit still applies; final integrity check and
TRUNCATE checkpoint run after peers exit. No production changes.

Windows diagnostic peers use sqlite3_vfs xGetSystemCall/xSetSystemCall
at startup before receiver threads start, calling the original
Win32 functions with unchanged arguments, return values and LastError.
Only publishing-thread operations inside sqlite3_step are timed:
FlushFileBuffers, WriteFile, ReadFile, LockFileEx, UnlockFileEx,
and available LockFile/UnlockFile/SetEndOfFile/Sleep. Other operations
are uninstrumented. Atomic live snapshots show outer writer stage,
nested busy sleep or checkpoint, and active syscall; watchdog
samples every 100 ms in root mode and logs >=500 ms writer stages.
Aggregate completed-call timing, full failed-worker logs and per-peer
stall maxima are saved. The WAL hook replaces native autocheckpoint
and custom busy handler changes retry behavior, so compare native
and hook modes rather than treating them as identical. Instrumentation
may perturb timings; no reproduction is not proof of absence.
Runner storage/Defender context is recorded read-only; no antivirus
exclusions, no sync=OFF, no longer timeout, no production policy
changes. An observed slow syscall identifies where time is spent,
not the underlying disk/driver/security/VM cause. Unobserved stalls
require deeper ETW or a representative physical Windows machine.

## Explicit synchronous batch publishing

The Windows #32 root-cause experiment reproduced stalls inside
FlushFileBuffers during PASSIVE checkpoint (at least 9342 ms).
Native checkpoint 1/2 passed, timed checkpoint 2/2, timed checkpoint
plus busy hook 1/2, checkpoint disabled 2/2 in 180 s trials. This
locates the immediate I/O stall, not the underlying Windows storage
driver/VM issue. Disabling checkpoint is not a production solution.

Batch is a caller-owned, non-thread-safe staging object. Example:

    intraflow::Batch batch;
    batch.add("position", position);
    batch.add("command", command);
    auto sequences = app.publishBatch(batch);
    batch.clear();

The existing publish() remains synchronous and unchanged.
publishBatch() returns sequences in insertion order only after the
message transaction commits. Empty batch is a no-op; one message
uses autocommit, multiple messages use BEGIN IMMEDIATE/COMMIT and
reused prepared INSERT. On failure rollback all message rows (as
usual ambiguous storage/commit failures cannot promise exactly-once
retry); independently registered topic metadata may remain.
At most 32 messages, 1 MiB per serialized payload, 4 MiB total
payload; metadata is not included in that byte limit. No background
thread, automatic buffering, or open write transaction while waiting.
Batch entries remain caller-owned and must not be mutated concurrently.
A failed rollback makes the Session unusable; destroy/reconnect.

Batch contract tests cover mixed topics/types, atomic rollback with
an injected second-row SQL error, sequence continuity, empty/single
batch, old publish and count bound. Traffic peer stages messages
until first enqueue + interval or 32 entries, then synchronously
flushes; it does not change SDK defaults. Compare 0/10/20/50/100/200
ms at 100/300/900 aggregate messages/s, 72 s, fresh DB per trial.
Same writer mutex, raw receive query, retention, NORMAL and 5 s
timeouts; Windows uses timed checkpoint and Win32 tracing in all
pairs. At 300/s Windows additionally compares 4000 vs 1000 pages
at 0 and 200 ms to distinguish threshold effects. Report message
transaction count (excluding topic/schema registration), actual
mean/max batch size, multi-row count, transaction call duration,
explicit COMMIT timing, and enqueue-to-commit per-message delay.
Receive latency starts at message generation, includes buffering.
No automatic interval in the SDK; no guarantee of flush deadline
under scheduling or lock delay. A single trial is exploratory.
