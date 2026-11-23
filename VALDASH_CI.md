# VAL DASH local app — GitHub Actions validation fixture

This repository contains unrelated C++ projects. VAL DASH lives here only as an **isolated CI fixture**.

- **Source archive:** `valdash-local-source.tar.xz` (the full local webapp source, including `install.bat` and `run.bat`).
- **Workflow:** `.github/workflows/valdash-local.yml`.
- **Windows job:** extract archive, run `install.bat`, run Python security tests, start the server through `run.bat`, verify `GET /api/health` and reject unauthenticated `GET /api/overview`.
- **Linux job:** build the React / TypeScript frontend with Node.js 22.

To work with the source locally:

```bash
mkdir valdash-local
tar -xf valdash-local-source.tar.xz -C valdash-local
```

On Windows, run `valdash-local\install.bat`, then `valdash-local\run.bat`. This is a **demo-only application**, not a Riot-authenticated store checker. All player/store/penalty data is synthetic. No secrets or Riot credentials are included.

The full source is also distributed as `valorant-local-updated.zip` in the ChatGPT conversation.
