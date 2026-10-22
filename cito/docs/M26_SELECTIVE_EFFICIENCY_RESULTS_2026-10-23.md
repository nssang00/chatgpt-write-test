# M26 — Selective Discovery and Traffic Efficiency: audited A/B results

Measured 2026-10-22 UTC / 2026-10-23 KST. Figures were recomputed directly from each completed GitHub Actions job's JSON stdout rows; raw per-node logs and `result.json`, `summary.csv` are in the run Artifacts.

## Experimental controls

Each result uses one Linux bridge, separate Linux network namespaces/veth pairs for all processes, 1 publisher, N-2 positive subscribers, 1 unrelated subscriber. All positive subscribers uniformly subscribe to the **first K topics**, K=ceil(topics*percent/100), while publisher has topics writers for **all** topics. Publisher emits 8 samples per topic at 10Hz/topic. Payload 256 B except 100-node extension (64 B). Cyclone DDS uses Ubuntu packaged implementation with BEST_EFFORT/KEEP_LAST and SPDP-only multicast; Cito uses UDP broadcast summary and selective route detail. Engines alternate run order within each repeated test.

**Definitions:** `veth RX` = sum host-side veth received bytes (emitted from namespace towards bridge), `veth TX` = sum host-side veth transmitted bytes (bridge towards namespace, includes multicast/broadcast replication), `prepublish RX` = cumulative veth RX from immediately after link setup to publisher readiness marker (BEFORE user-data send in 1-publisher runs); values include participant startup and discovery traffic. RSS = **sum of per-process peak RSS** (not unique RAM), CPU = summed process user+system time; network numbers are averages per repetition, in decimal kB. Output values are not normalized by physical RF airtime. DDS's RTPS/CDR and Cito's binary data formats have different on-wire overhead; this is a matched **application workload**, not equal raw wire protocol.

## 5-repeat and network-loss results

| Network | Nodes | Topics | Subscribed | Runs Cito/DDS | Received Cito | Received DDS | veth RX kB Cito / DDS | Prepublish RX kB Cito / DDS | Σpeak RSS kB Cito / DDS | Raw evidence |
|---|---:|---:|---|---|---|---|---|---|---|---|
| baseline | 10 | 8 | 10% (1) | 5/5 | 320/320 | 320/320 | 46.6 / 378.5 | 7.8 / 282.6 | 38.1 / 78.0 | [logs](https://github.com/nssang00/chatgpt-write-test/actions/runs/39859684030) |
| baseline | 10 | 8 | 100% (8) | 5/5 | 2560/2560 | 2560/2560 | 205.5 / 763.8 | 19.6 / 445.8 | 37.8 / 79.6 | [logs](https://github.com/nssang00/chatgpt-write-test/actions/runs/39858742770) |
| baseline | 10 | 128 | 10% (13) | 5/5 | 4160/4160 | 4160/4160 | 323.8 / 1464.1 | 28.2 / 961.5 | 38.2 / 84.7 | [logs](https://github.com/nssang00/chatgpt-write-test/actions/runs/39859684030) |
| baseline | 30 | 33 | 10% (4) | 5/5 | 4480/4480 | 4480/4480 | 377.9 / 6919.9 | 45.4 / 5366.8 | 113.9 / 259.3 | [logs](https://github.com/nssang00/chatgpt-write-test/actions/runs/39858742770) |
| baseline | 30 | 33 | 50% (17) | 5/5 | 19040/19040 | 19040/19040 | 1421.0 / 15501.8 | 123.9 / 11932.7 | 119.0 / 285.2 | [logs](https://github.com/nssang00/chatgpt-write-test/actions/runs/39859684030) |
| baseline | 30 | 33 | 100% (33) | 5/5 | 36960/36960 | 36960/36960 | 2702.4 / 29809.1 | 223.4 / 23945.7 | 119.1 / 324.5 | [logs](https://github.com/nssang00/chatgpt-write-test/actions/runs/39858742770) |
| limited | 10 | 8 | 10% (1) | 5/5 | 315/320 | 316/320 | 59.5 / 816.7 | 12.7 / 625.9 | 39.8 / 78.9 | [logs](https://github.com/nssang00/chatgpt-write-test/actions/runs/39858742770) |
| limited | 10 | 8 | 100% (8) | 5/5 | 2538/2560 | 2531/2560 | 247.1 / 1876.9 | 31.2 / 1375.2 | 38.9 / 81.3 | [logs](https://github.com/nssang00/chatgpt-write-test/actions/runs/39858742770) |

**Interpretation:** all completed baseline scenarios above have error-free full delivery for both engines (compare `received` and `expected`). For `limited` cases the kernel is configured with nominal 1 Mbps per-node link rate, 50ms one-way delay and 1% packet loss; BEST_EFFORT payload delivery may be less than 100%, so `valid` means correct benchmark execution, not reliable application delivery. Full-delivery pass count and individual p95 are in the raw run `results.json`.

### 30-node, 33-topic selectivity

At 10%, 50%, and 100% selectivity, both implementations have expected delivery for 5 independent repetitions. The network bytes decrease as application subscriptions decrease, and Cito's total veth RX and sum of peak per-process RSS are lower than Cyclone DDS in the tested configuration. This **does not isolate all overhead to one algorithm**: DDS discovers all participants and endpoints using RTPS/CDR and the chosen SPDP-only multicast configuration.

### Failure classification

[Initial nine-case Actions #39858742770](https://github.com/nssang00/chatgpt-write-test/actions/runs/39858742770): some jobs timed out during apt package installation before any data-plane test; these are CI infrastructure failures, **not** failed Cito/DDS Discovery. The [prebuilt runtime Actions #39859684030](https://github.com/nssang00/chatgpt-write-test/actions/runs/39859684030) switched to one DDS build/install job followed by binary reuse on other jobs and produced the valid additional scenarios in this table.

100-node default-SPDP trial from the initial matrix: Cito discovered and delivered all 784 expected matching messages **3/3 runs**, but Cyclone DDS did not reach matching readiness within 28s (0 sent). This is an observation with that DDS configuration and duration, not a general claim that Cyclone DDS cannot run 100 nodes. A tuned SPDP-interval, longer-duration retest is isolated in the separate `cito-m26-dds-100-tuning` branch.

## 100-node convergence gate (3 repetitions)

[Prebuilt runtime matrix #39859684030](https://github.com/nssang00/chatgpt-write-test/actions/runs/39859684030) completed the two 100-node cases with a 30,000 ms publisher lifetime and 8 topics. Cito: 3/3 successful complete-route matches, publishes and full subscriber deliveries in **both** percent settings. Cyclone DDS: all three trial publishers failed to reach 98 matching readers on every active topic within this 30-second budget. No DDS application data was sent. These cases do **not** establish matched-load throughput or DDS's absolute node capacity; the DDS's bytes and RSS in this case are its ongoing discovery efforts, not an application-data delivery comparison.

| Topic-interest percentage | Cito delivery per repetition | Cyclone DDS ready/published | Cito mean veth RX bytes | DDS mean veth RX bytes (discovery only) |
| --- | --- | --- | ---: | ---: |
| 10% (1/8) | 784/784 on 3/3 | 0/3, no publish | 309,457 | 15,699,993 |
| 100% (8/8) | 6,272/6,272 on 3/3 | 0/3, no publish | 1,216,609 | 22,675,673 |

A separate experiment changes Cyclone SPDP interval to 2s, lengthens the publisher lifetime to 60s and staggers participant launch by 30ms. It is not mixed into the default-setting dataset.

## Remaining limits

Only 1 publisher is present in this report; 1/5/10 publisher A/B results are on a separate `cito-m26-multipublisher` experiment branch. Uniform *prefix* topic selection is tested; heterogeneous rotating subscription sets, dynamic subscribe/unsubscribe, shared-airtime radio networks, DDS RELIABLE, PSS/true physical memory, sustained 30-60min operation, and the shipping integrated API are **not** proven by this benchmark. Do not infer field-radio performance from these GitHub namespace results.
