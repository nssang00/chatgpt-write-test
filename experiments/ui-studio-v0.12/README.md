# UI Studio v0.12 isolated CI experiment

This branch tests the **actual UI Studio v0.12 source archive**, not the earlier Easy GUI Studio PoC.

- Source: `experiments/ui-studio-v0.12/ui-studio-source.zip`
- SHA-256: `4585173e7af37fe51540da782d4cc83c4f98cc7992ffc29df9266c9206ba2027`
- Workflow: `.github/workflows/ui-studio-v012-e2e.yml`
- Verification: Node regression, Runtime, Vite production build, standalone exported React component install/build, and Playwright Chromium browser E2E.
- Isolation: No changes to the existing NativeWeb application paths. Branch-only, not merged.
