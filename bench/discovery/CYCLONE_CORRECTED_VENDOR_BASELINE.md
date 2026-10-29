# Corrected Cyclone DDS vendor threshold after reader-loop fix — 2026-10-29

Runner: https://github.com/nssang00/chatgpt-write-test/actions/runs/40865077866
Branch: diagnostic/cyclone-wire-timing-20261029

The previously used vendor presence + Pub/Sub benchmark was corrected to use DataReader.take(N=256) rather than taking one sample every 10ms. The existing QoS was already Reliable and KEEP_ALL on both writer/reader; this change does not alter those settings.

| Nodes | loss per veth end | warmup | application presence complete nodes | Data-complete nodes | remote samples | outcome |
|---:|---:|---:|---:|---:|---:|---|
| 10 | 0% | 17s | 10/10 | 10/10 | 180/180 | PASS |
| 30 | 0% | 17s | 30/30 | 30/30 | 1,740/1,740 | PASS |
| 30 | 10% | 38s | 30/30 | 30/30 | 1,740/1,740 | PASS |
| 40 | 0% | 17s | 1/40 | 0/40 | 72/3,120 | FAIL |
| 40 | 0% | 38s | 0/40 | 0/40 | 1,518/3,120 | FAIL |
| 40 | 10% | 38s | 0/40 | 0/40 | 1,568/3,120 | FAIL |

The 10/30 node results confirm the repaired data-loop does not cause spurious errors in this workload. The 40-node experiment **still fails**, even with a longer 38s prepublish interval. This should be investigated as a separate issue of multicast delivery, participant/endpoint discovery or shared-host resource contention. Existing vendor threshold code does not collect native participant counts, therefore "application presence complete nodes" here is NOT SPDP/SEDP completion.

Important: all results are one sample per configuration, with multiple concurrent runners and a single CPU/memory environment. Failure is only under this test's specifics, not a universal threshold for Cyclone DDS. No proof of comparative superiority over Cyclone DDS or Zenoh in a fair production environment follows.

The initial 16s 'Cyclone discovery' anomaly is resolved via the history/keyed results documented in CYCLONE_16SEC_RESOLVED_20261029.md.
