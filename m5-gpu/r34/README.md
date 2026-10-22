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

## 2026-10-22 RTX Actions infrastructure blocker — verified by API

GitHub Actions cannot currently create a job in this repository. A new one-step
NVIDIA RTX probe [run #39777179108](https://github.com/nssang00/chatgpt-write-test/actions/runs/39777179108)
was routed to synthetic `BuildFailed`, `workflow_id=392700471`,
`conclusion=startup_failure`, **0 jobs and 0 artifacts**. Re-running a prior
working R30 RTX job was blocked before job creation as well.

**NEW DISTINCT ACCOUNT-LEVEL SIGNAL:** Attempt to create a tracking GitHub Issue
via the linked account returned HTTP **422**, GitHub API message:
`at least one email address must be verified to do that`.
GitHub's official account documentation states that without a verified account
email, both **issues and GitHub Actions** are restricted:
https://docs.github.com/en/account-and-profile/reference/email-addresses-reference

### Required account-owner action
1. Sign in as the repository-owning `nssang00` account.
2. Visit https://github.com/settings/emails and confirm at least one verified
   address. If not verified, use **Resend verification email** and complete its link.
3. Re-run the minimum `m5-r34-nvidia-rtx-probe.yml` workflow before any GPU A/B.
4. If the same `startup_failure` persists despite verified email, inspect
   Actions billing/payment authorization and GitHub Support's workflow registry
   status for synthetic workflow ID `392700471`.

This is a *strong and actionable lead*, but the root cause of the synthetic
startup failure is not proven until an actual job starts. CPU byte-equality and
regression checks still pass; **R34 RTX wall-frame performance remains unverified**.
