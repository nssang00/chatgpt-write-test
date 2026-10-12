# NativeWeb autonomous execution plan (2026-10-13)

## Operating policy
- Continue tasks that do not depend on a blocked task; record every blocker in `docs/ISSUE_LOG.md`.
- Distinguish implemented, locally verified, CI verified, blocked and requires-approval states.
- Work on isolated branches and PRs; do not modify `main` or release externally without approval.
- Ask only for material compatibility breaks, scope changes, security reductions, financial commitments, destructive repository changes and final merge/release.
- Do not bypass broken tests or claim browser validation without a real engine run.

## Workstreams
1. Reconcile the local browser-E2E ZIP with upstream main, using base commit `43639459c97044feed1d2f8020979f589c99ef96`. Fix Release CTest assertion side effects.
2. Run and repair the existing plugin object E2E on Linux CEF, Windows CEF and Windows WebView2 in actual SDK/runtime CI environments.
3. Harden cross-platform ABI, concurrent calls, unload and plugin-owned events; cover platform failures with regression tests.
4. Implement SDK installation, sample consumer, security defaults, documentation and clean-environment packaging.
5. Progress through host adapters, desktop APIs and developer tooling according to `docs/ROADMAP.md` after Runtime + Plugin SDK v1 gates.

## Gates
- C++11 Linux and Windows Release regression suites pass.
- All three actual browser plugin E2E targets pass.
- Plugin ABI, lifecycle, error, duplicate ID and concurrency tests pass.
- Capability/permission security defaults and a clean SDK consumer build are verified.
- Blocking issues are resolved; any release exclusion is explicitly approved.

Logs must include a reproducible command, observed output, scope, severity, status and next action.
