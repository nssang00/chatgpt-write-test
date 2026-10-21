# M5 Round 19 GPU parity handoff (2026-10-21)

## Exact acceptance remains FAIL

Authoritative **five-cold RTX ABBA**:
https://github.com/nssang00/chatgpt-write-test/actions/runs/39538121326
Node tests 95/95 PASS; the real RTX campaign completed; exact RGBA8 differs:
- building-1l: 13 pixels; OL 213.70ms vs M5 86.90ms (59.34% shorter)
- road-1l: 226 pixels; OL 88.25ms vs M5 40.30ms (54.33% shorter)
- mixed-4l: 212 pixels; OL 285.45ms vs M5 126.20ms (55.79% shorter)

**208 of the 212 Mixed mismatching coordinates coincide with Road mismatches**, making Road stroke geometry/rasterization the main target. Building has isolated tile-seam pixels and minor alpha deviations. No automatic acceptance threshold changes, source-image injection or screenshot-copy corrections.

## New Round 19 negative controls on actual self-hosted RTX

- Shader numeric reconstruction (M5 vs OL fragment tangent and vertex mixing): no improvement, 13/226/212. https://github.com/nssang00/chatgpt-write-test/actions/runs/39593388306
- GPU Join -> CPU Join: no improvement (and slower Mixed). https://github.com/nssang00/chatgpt-write-test/actions/runs/39589582722
- DITHER disabled: no improvement, 13/226/212. https://github.com/nssang00/chatgpt-write-test/actions/runs/39594086841
- Single-layer RGBA8 FBO: no improvement, 13/226/212. https://github.com/nssang00/chatgpt-write-test/actions/runs/39594276388
- Painter ordering: worse Building 81, Road 226, Mixed 229. https://github.com/nssang00/chatgpt-write-test/actions/runs/39594777509

Keep the Round18 closed-polygon/direct-flat baseline and do NOT adopt failing variants. Next trials must be based on evidence-rich per-fragment rasterization/triangle coverage, line geometry, or OL render extent, not repeatedly switching ineffective options.

## Verification policy

Only release with simultaneously measured zero RGBA8 mismatched pixels for Building/Road/Mixed, stable within-renderer captures, all Node regression tests passing, and >=50% shorter cold-to-captured-frame median for every scene in a full 5-cold, 4-campaign ABBA on physical RTX 5060 Ti. Keep `main` and source Round14 unchanged. All diagnostic scenarios must preserve raw PNGs, differences, browser logs and exact run URL.
