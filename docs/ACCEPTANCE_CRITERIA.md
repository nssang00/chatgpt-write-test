# Runtime + Plugin SDK v1 acceptance criteria

A feature is not complete solely because it compiles or has a test harness.

| Gate | Requirement | Current status |
| --- | --- | --- |
| Linux C++11 Release | Clean build and all CTest regressions | Release 21/21 and Debug 21/21 pass locally after assertion fix |
| Windows C++11 Release | Clean build and all CTest regressions | Pending latest ZIP CI |
| Linux CEF E2E | Real JS proxy open/method/error/busy/dispose/unload | Pending SDK-backed execution |
| Windows CEF E2E | Same test on Windows CEF | Pending |
| Windows WebView2 E2E | Same test on real WebView2 runtime | Pending |
| ABI / lifecycle | Compatibility, in-flight release, duplicate IDs, quiescing | Partial local verification; Windows/stress pending |
| Security | Capability/permission defaults tested | Not complete |
| Packaging | Install targets and clean consumer example pass | Not complete |

Report `PASS`, `IMPLEMENTED / UNVERIFIED`, `BLOCKED`, or `REQUIRES APPROVAL` precisely. Any gate exclusion requires explicit approval.
