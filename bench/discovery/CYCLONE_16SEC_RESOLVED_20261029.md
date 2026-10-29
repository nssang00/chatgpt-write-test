# Cyclone DDS 16-second "discovery" anomaly: resolved

Date: 2026-10-29

## Conclusion

The original 10-node result 16.635s was an **application-visible receipt of one user sample from each of 10 publishers**, not native SPDP/SEDP discovery. Instrumented DDS discovery completed around 0.1-0.2s for participants and 0.2-0.3s for all Reader/Writer matches. The original comparison incorrectly called the application presence sample completion "Discovery latency."

**Root cause:** One keyless IDL Topic, 10 concurrent publishers, default DataReader KEEP_LAST(1), and slow one-item-per-call consumption. The keyless type is one DDS instance. As multiple writers' samples arrive in a burst, the Reader History Cache can overwrite a sample from one source before the benchmark records that source. It then waits for a later repeat sample, sometimes many seconds later. This is expected KEEP_LAST behavior rather than proof of slow Cyclone Discovery.

## Direct packet-level evidence

In a 10-node run with original keyless type and Reader default History, writer 8 emitted a sample with origin 8, sequence 0 near t=0.2 seconds. The internal Cyclone DDS packet capture at **receiver 1** contains the RTPS DATA submessage for origin=8/seq=0 at that time, and subsequent origin 8 DATA samples every ~0.5s. Nevertheless, reader 1 first returned origin 8 to the application at sequence 8 around t=4.209s.

Actual writer.write calls lasted less than 0.5 milliseconds in the slow 10-node run. The application had matched all 10 writers by about 0.27s. These directly contradict both the notion of 16-second SPDP and a 16-second blocking writer call.

PCAP evidence: https://github.com/nssang00/chatgpt-write-test/actions/runs/40864140768

## Controlled 10-node experiments, full application receipt times in seconds

| Reader / IDL | seed 1 | seed 2 | seed 3 |
|---|---:|---:|---:|
| Keyless / Reader default: first independent wire run | 12.752 | 4.330 | 0.806 |
| Keyless / Reader KEEP_LAST(64) | 0.711 | 0.451 | 0.699 |
| Keyless / Reader KEEP_ALL | 0.361 | 0.697 | 0.702 |
| **Keyed by origin / default KEEP_LAST(1)** | **0.435** | **0.462** | **0.384** |

These are separate fresh Linux GitHub runners and one execution per seed. Do not interpret as statistical precision. Another independent keyless default run took 2.769s; variability is a symptom of this workload and history interaction.

At 20 nodes, history depth 64 completed at 0.797s, KEEP_ALL completed at 0.553s, and keyed-default completed at 0.554s.

Independent convergence instrumentation found full native 10-node participant and endpoint discovery in approximately 0.1-0.3s consistently across all these configurations.

## Critical caveat

A 40-node test with Reader KEEP_LAST(64) **still failed** full participant and endpoint convergence within a 20-second observation window. This is a distinct unsolved scale/topology/host-load issue and cannot be dismissed as Reader overwrite alone. Full middleware algorithm selection remains premature and earlier Cyclone-vs-custom comparisons require a corrected, fairer redo.

## Code fixes and evidence

Branch: diagnostic/cyclone-wire-timing-20261029 (default branch not changed).

- bench/discovery/node.py: original presence type now declares node_id as DDS key and calls reader.take(N=256), rather than keyless + one sample per call.
- bench/discovery/vendor_probe_node.py: now calls reader.take(N=256). The vendor probe already used KEEP_ALL but consumed only one sample per polling iteration.
- bench/discovery/cyclone_wire_node.py: measures writer call timing, per-source user-data first-seen, Participant discovery, endpoint matching and optional internal Cyclone network packet capture.
- bench/discovery/cyclone_wire_run.py: netns/veth/bridge runner with veth tcpdump captures and raw timings.

Supporting GitHub Actions:
- First writer/wire timeline: https://github.com/nssang00/chatgpt-write-test/actions/runs/40863686801
- Internal packet/receiver pcap: https://github.com/nssang00/chatgpt-write-test/actions/runs/40864140768
- Reader history A/B: https://github.com/nssang00/chatgpt-write-test/actions/runs/40864599128
- Keyed data A/B: https://github.com/nssang00/chatgpt-write-test/actions/runs/40864869419
- Corrected old vendor threshold: https://github.com/nssang00/chatgpt-write-test/actions/workflows/cyclone-corrected-baseline.yml

## Updated evaluation rule

Measure separately (1) SPDP participant discovery, (2) SEDP endpoint matching, (3) application visibility of each publisher, (4) user sample receipt after a known readiness barrier. Do not use repeated user-data presence under Keyless KEEP_LAST(1) as a discovery oracle.

For 40+ nodes investigate interface selection and multicast join, qdisc/UDP socket drops, CPU throttling, Cyclone transport internals, and matched endpoint counts. Re-run fair data delivery against Zenoh and custom algorithms before deciding superiority.

Official DDS QoS docs: https://cyclonedds.io/docs/cyclonedds/latest/about_dds/qos.html
Cyclone Python IDL key annotations: https://cyclonedds.io/docs/cyclonedds-python/latest/idl.html
