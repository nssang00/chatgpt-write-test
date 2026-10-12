# Runtime + Plugin SDK v1 acceptance criteria

A feature is not complete solely because it compiles or has a test harness. Canonical evidence is GitHub Draft PR #7 at commit `b2f1ced3e59cd1ba77bbb912f336d889e692ecad`.

| Gate | Requirement | Current status |
| --- | --- | --- |
| Linux C++11 Release | Clean build and all CTest regressions | PASS: 21/21; 10 repetitions of each test = 210 passes locally |
| Windows C++11 Release | Clean build and all CTest regressions | PASS: Core Regression GitHub run 38322632990 (Linux + Windows) |
| Linux CEF E2E | Actual JS proxy open/method/error/busy/dispose/unload | PASS: real CEF E2E run 38322633033 |
| Windows CEF E2E | Actual JS proxy lifecycle; full target parallel build | PASS: real CEF E2E run 38322633033 |
| Windows WebView2 E2E | Actual JS proxy lifecycle | PASS: WebView2 E2E run 38322633033 |
| ABI / lifecycle | Compatibility, in-flight release, duplicate IDs, quiescing | PASS for covered tests; Linux ASan full 21/21 and plugin lifecycle 3 × 40 repetitions; wider fuzz/stress not yet complete |
| Security | Trusted origins and capability/permission defaults tested | NOT COMPLETE — release blocker |
| Packaging | C++11 Core and C ABI installed consumer | PASS: Linux/Windows GitHub SDK run 38322633018; CORE-ONLY SDK |
| Full browser runtime distribution | Reproducible CEF/WebView2 package/install and clean consumer | NOT COMPLETE — release blocker |
| Plugin-owned event/listener semantics | ABI and lifetime-aware event regression | NOT COMPLETE — planned milestone |

Windows CEF SDK bootstrap and all-target CMake shared-resource copy failures were resolved in NW-008 and NW-009. The browser E2E workflow is [38322633033](https://github.com/nssang00/chatgpt-write-test/actions/runs/38322633033).

The above reports verified implementation coverage, **not a finished NativeWeb product**. Any acceptance gate exclusion, security relaxation, `main` merge or release requires explicit approval.
