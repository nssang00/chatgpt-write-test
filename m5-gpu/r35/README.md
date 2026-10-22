# R35: Self-contained R34 Worker Pool recovery and strict NVIDIA RTX acceptance

Status 2026-10-22: **CPU+distribution verified; no new GPU RTX result; release blocked**.

The previous R34 full-source ZIP omitted a necessary top-level `vendor/` directory;
the OL 10.10.0 runtime existed only in `project_round18_verified_candidate/vendor/`.
Directly extracting the old ZIP led to `ERR_MODULE_NOT_FOUND`. A corrected
self-contained full source ZIP is provided as conversation artifact:

- `M5_R35_RTX_READY_SELF_CONTAINED_2026-10-22.zip`
- SHA-256 `3e5d3cb5d525b818a3b560731dac0ae17ce734ab5a96057c67c546c4b7cb2776`
- 3,460 files, ZIP CRC PASS; clean extraction dependency smoke PASS.

Verified after clean extraction on Node 22.16:
- Shared MVT decode 16 → 4 invocations, 48/48 GPU arrays byte-identical, 16 ordered packets and 5,774,598 GPU bytes exact.
- Independent Node WebGL/line/polygon/range regressions PASS; Python unit tests 41/41 PASS.
- Fresh worker-ready CPU timing in ms: serial 66.222, independent 2W 37.275,
  R34 shared 2W 26.840. Startup + first grouped 2W 276.715ms (**not a cold win**).
- Cache hit median 2.615ms with zero new worker dispatches.

The corrected archive includes:
- `RUN_R35_RTX_SELF_HOSTED.ps1`: actual NVIDIA RTX 5060 Ti Windows self-hosted OL ↔ M5 ↔ R34 crossed capture.
- `tests/r35_rtx_acceptance.mjs`: independent fail-closed RTX PNG and
  50% cold-performance gate, including warm Worker startup cost.
- `tests/verify_r35_rtx_gate.mjs`: four synthetic gate unit tests (not GPU proof).
- `R35_RTX_INSTRUCTIONS_KO.md`: detailed execution steps.

GitHub Actions remains blocked before any runner job is allocated
(example https://github.com/nssang00/chatgpt-write-test/actions/runs/39777179108).
A prior GitHub API 422 error stated "at least one email address must be verified
to do that"; GitHub's [official email verification limitations]
(https://docs.github.com/en/account-and-profile/reference/email-addresses-reference)
also block creating or using Actions when no account email is verified.
Review account verification at https://github.com/settings/emails. This is
a strong suspect, **not proven causal for startup_failure**.

Never claim R35 has GPU pixel or end-to-end RTX speed approval. The RTX runner
requires the corrected archive to be locally available; the runnable ZIP bytes
are not committed to this branch. Opera was not used. `main` unchanged.
