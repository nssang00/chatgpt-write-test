# R55 actual OpenLayers cancellation/retry race gate (not yet PASS)

## Purpose
R50/R53 prove real pointer/wheel input but their tile loader is synchronous, so they do **not** establish in-flight cancellation or retry correctness. R49 proves deterministic Worker faults but not the actual OpenLayers UI path.

## Required test design
1. Reconstruct pinned R35 seed (SHA-256 3e5d3cb5d525b818a3b560731dac0ae17ce734ab5a96057c67c546c4b7cb2776) and apply R45 then R48 on the physical Windows RTX 5060 Ti runner.
2. Reuse R53's 32 independently hashed MVT fixtures and real Chromium OpenLayers Map; replace synchronous tile loading with an instrumented **asynchronous** tile/Worker pipeline. Record monotonically increasing request generations, tile IDs, issue/settle/abort timestamps, and actual Worker dispatch/response IDs. Delays must be controlled, not inferred from UI churn.
3. Cause overlap: start delayed generation A, issue actual mouse drag/wheel to generation B, cancel/evict A, retry failed B tiles, and force out-of-order A completion after B. Verify at least one observed in-flight cancellation, at least one real retry, and at least one late response. A test that does not observe all three MUST fail.
4. Assert stale generation A never enters the committed tile packet set or final framebuffer. Compare settled B RGBA8 with a clean fresh-load B oracle on the same GPU; require diffPixels=0. Assert no missing expected tiles, GL errors, page errors, HTTP errors, or unhandled rejections.
5. Repeat at DPR1 and DPR2 with 8, 16 and 32 distinct sources, multiple deterministic delay seeds. Assert nonempty rendered frames and independently check recorded PNGs and machine-readable JSON. Ensure the oracle exits nonzero on *every* failed assertion.
6. Run separate forced Worker crash/restart during UI churn and verify fail-closed plus recovery; do not conflate with synthetic Worker fault tests.

## Acceptance / evidence
- Physical RTX 5060 Ti hardware identity and pinned seed SHA in artifact.
- JSON: actual event timeline, counts for cancellations/retries/late responses, per-generation tile identities, expected-vs-committed tile IDs, GL/console/network errors, PNG comparison diffPixels, final pass flag.
- PNG: clean B reference, raced B final, and their difference for every test case.
- ZIP SHA-256 recorded with Actions run/job/artifact links.
- Only after actual raw ZIP inspection may R55 be marked PASS.

## Release lock
Until R55, R35 always-worker cold-start, broad-data coverage and final integrated regression all pass from raw evidence: Production NO-GO, PR #23 Draft, default Worker OFF, no main merge.
