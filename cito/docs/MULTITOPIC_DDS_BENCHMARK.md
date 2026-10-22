# Cito vs Cyclone DDS: reproducible multi-topic network benchmark

## Scope

Experimental branch based on `cito-discovery-retry` (the GitHub development stack), **not** a shipping v25 integration benchmark.

- One publisher, one matched subscriber, one unrelated subscriber.
- Each process has a distinct Linux network namespace/veth connected to a Linux bridge.
- Cito: `UdpRuntimeAdapter` (best-effort UDP, broadcast announcements and unicast payloads).
- Cyclone DDS: Ubuntu 24.04 `cyclonedds-dev` 0.10.4 family, C API, IDL-defined `Bench::Msg`; BEST_EFFORT, KEEP_LAST(2048), SPDP discovery multicast and unicast data.
- Both engines use the same topic names by ordinal, subscriber pattern (all target topics plus a nonmatching topic), nominal application byte size, samples/topic, Hz/topic and 500ms post-match warm-up. Execution order alternates Cito/DDS and DDS/Cito.
- Both embed a per-topic sequence number, monotonic send timestamp, deterministic payload and validate receive integrity. One-way p95 is measured on a single shared Linux kernel with CLOCK_MONOTONIC/steady_clock in microseconds.
- Topic counts 1, 8, 33, 65; application message byte sizes 16, 256, 1200, 4096; 20 samples/topic per repetition.
- Linux tc netem baseline = no impairment; limited = 1Mbit/s per node interface, 50ms nominal one-way delay, 1% nominal independent random loss. Two qdiscs per path (namespace egress, recipient host-side veth egress). This is **not** shared Wi-Fi airtime or actual drone radio.
- Each case records `results.json`, `summary.csv`, node logs, optional `tc -s qdisc` counters and exact process return statuses.

## Critical comparability limitations

These experiments have an *equal nominal application payload budget* but **not identical serialization or wire-byte overhead**. Cito transmits a 32B transport header plus binary payload; the DDS IDL encodes unsigned integer fields and an IDL string with CDR/RTPS overhead. The DDS C reader uses a WaitSet and ReadCondition event wakeup before dds_take; the Cito reader uses UDP poll. Scheduling and internal processing still differ. Thus latency numbers reflect *these client harnesses* too. Do not infer universal middleware superiority.

Cyclone DDS reliability is BEST_EFFORT to approximate Cito's one-shot UDP data semantics. Neither side has an app-level ACK. One dropped sample in a 1%-loss experiment does **not** constitute a Discovery failure.

`pass` requires every expected sample to reach the subscriber, zero corruption or duplicates, nothing at the unrelated node, and clean process exits. Under best-effort random loss, an entire repeated case is expected to fail full-delivery criteria at some sample counts. Always report **delivery fraction as well as pass/fail**.

Network feasibility: 33*1200B*20Hz ≈ 6.34 Mbps app data, exceeding a 1 Mbps limited link. This is a deliberate *saturation* test if enabled. Network-feasible inputs under 1 Mbps use 33*1200*2Hz ≈ 0.634Mbps and 8*4096*2Hz ≈ 0.524Mbps; actual wire overhead may still cause additional loss. The CI checks each case independently and preserves results even for failing cases.

## Reproduce on GitHub Actions Ubuntu 24.04

```bash
sudo apt-get update -qq
sudo apt-get install -y -qq ninja-build cmake iproute2 cyclonedds-dev cyclonedds-tools
cmake -S cito/tests/bench -B build-multitopic -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build-multitopic -j2
python3 cito/tools/multi_topic_compare.py \
  --cito build-multitopic/cito_multi_topic_node \
  --dds build-multitopic/dds_multi_topic_node \
  --profile baseline --topics 33 --bytes 1200 \
  --samples 20 --hz 20 --repeat 2 --timeout-ms 16000 \
  --output bench-results
```

Requires CAP_NET_ADMIN for veth/netns/tc. GitHub's `.github/workflows/cito-multitopic-dds.yml` executes the test matrix and uploads per-case artifacts. Do not execute multiple instances of the *same case runner* simultaneously on one Linux host because the netns/veth names are fixed.

## Evidence

- Initial baseline independent CI showing 1/16B and 33/1200B 2x delivery success: https://github.com/nssang00/chatgpt-write-test/actions/runs/39852816102
- Corrected burst-paced and warm-up comparison (DDS 200us poll): https://github.com/nssang00/chatgpt-write-test/actions/runs/39853629298
- Event-driven Cyclone WaitSet comparison: https://github.com/nssang00/chatgpt-write-test/actions/runs/39854435409
- Focused follow-up on stalled environment installers: https://github.com/nssang00/chatgpt-write-test/actions/runs/39855017123
- Final revised low-Hz timeout and network-feasible workload comparison: see the latest run on `cito-multitopic-dds-benchmark` Actions branch.
- Validation of 1, 8, 33 and 65 topics with Cito was also performed locally using a v25 source ZIP and a loopback network; those local trials are **not** Cyclone DDS/namespace evidence.

## Next after this experimental comparison

More repetitions (5+), mixed subscription subsets, dynamic subscribe/unsubscribe, simultaneous publishers, QUIC/RPC, 64B/1.4KB MTU boundary, longer (>30min) stability, CPU and memory, matched on-wire bytes/packet counts, DDS RELIABLE vs Cito reliable transport, and the actual merged v25/v26 public API are separate gates. Do not use this experiment to claim any of these as completed.
