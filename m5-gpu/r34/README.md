# M5 R34 — Shared MVT decode inside persistent Earcut Worker Pool

**Experimental. CPU parity verified; RTX GPU acceptance NOT completed.**
Branch based on `m5/r33-earcut-workerpool-20261022`. This branch
is the provenance record; the runnable **source is distributed in the
ChatGPT artifacts**, not committed in this GitHub branch.

Outputs (2026-10-22):
- `M5_R34_COMPLETE_SOURCE_2026-10-22.zip`
  SHA-256 `549e0a56f59ec0b8e38e95873f68ffd2ff49b71d8830e3b88d8a38a6a8c102d9`
- `M5_R34_SHARED_DECODE_WORKERPOOL_PATCH_2026-10-22.zip`
  SHA-256 `4657f1af43f12d6136d6ab687c4bdfd5f40f4636f8e3dcff41f752568313a450`

Performance design:
- Four PBF tiles / four source layers: shared decode calls 16 -> 4.
- Four Worker tasks rather than 16 independent layer tasks.
- GPU typed array equality: 48/48, 5,774,598 bytes, 16 painter packets.
- Node 22 mixed geometry CPU medians (9 crossed rounds):
  serial 70.381ms; independent 2-worker 50.566ms;
  shared 2-worker 37.893ms; 4-worker shared 27.142ms.
- Cache hit avoids PBF decode + Earcut; median 2.697ms.
- Two Worker cold creation + first grouped processing: 293.454ms;
  cold goal is **not achieved**.
- Existing R33/R34 Node and Python 41-test regressions pass.

R34 opt-in request flags:
`--workerPool=warm --workerCount=2 --workerSharedDecode=1 --workerCache=0`.
Browser Worker import and actual WebGL path remain unverified, because local
Chromium ANGLE/EGL failed and past successful self-hosted NVIDIA RTX workflow
re-run #39750095083 returned `startup_failure` before job creation.

**No claim of OpenLayers-relative stable 50% GPU wall-frame improvement.
Release blocked; main unchanged.**
