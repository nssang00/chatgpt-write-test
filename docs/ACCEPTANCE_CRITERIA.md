# Runtime + Plugin SDK v1 acceptance criteria

A feature is not complete solely because it compiles or has a test harness.

| Gate | Requirement | Current status |
| --- | --- | --- |
| Linux C++11 Release | Clean build and all CTest regressions | Release 21/21 and Debug 21/21 pass locally after assertion fix |
| Windows C++11 Release | Clean build and all CTest regressions | GitHub Core Regression #38314597138 PASS Windows with imported plugin sources |
| Linux CEF E2E | Real JS proxy open/method/error/busy/dispose/unload | CI rerun #38314779373 in progress (actual pinned CEF) |
| Windows CEF E2E | Same test on Windows CEF | CI rerun #38314779373 in progress |
| Windows WebView2 E2E | Same test on real WebView2 runtime | PASS: browser E2E #38314779373 |
| ABI / lifecycle | Compatibility, in-flight release, duplicate IDs, quiescing | Partial local verification; Linux plugin race tests 3 types × 30 repeats pass; Windows Core Regression #38314597138 PASS; engine stress pending |
| Security | Capability/permission defaults tested | Not complete |
| Packaging | Install targets and clean consumer example pass | PASS: Linux/Windows installed C++11 and C ABI consumer CI #38314597217; Core-only SDK |

Report `PASS`, `IMPLEMENTED / UNVERIFIED`, `BLOCKED`, or `REQUIRES APPROVAL` precisely. Any gate exclusion requires explicit approval.
