# VAL DASH CI (v0.4)

The VAL DASH source is kept in `valdash-local-source.tar.xz`. Existing unrelated code in the repository is unchanged.

## CI on GitHub-hosted runners
The `.github/workflows/valdash-local.yml` workflow extracts the archive and validates `install.bat`, `run.bat`, backend/mock auth and API tests, and the React build. It **does not log into any real Riot account**. No Riot credentials, cookies, CAPTCHA values or tokens should be placed in Actions Secrets.

## Opt-in live smoke test
The separate `VAL DASH - Interactive Riot smoke (self-hosted)` workflow supports an actual Riot login **only on a trusted Windows interactive desktop** that you operate and to which you have attached a self-hosted GitHub runner with label `valdash-interactive`. Launch the runner inside the active Windows desktop session (not as a Windows service), then manually trigger the workflow after it is merged to the default branch, enter `YES`, and complete password, CAPTCHA and MFA on Riot's page yourself. CAPTCHA is **not bypassed or automated**. A GitHub-hosted `windows-latest` runner cannot complete the human challenge.

Outputs are redacted milestones and counts only: `LIVE_LOGIN_OK`, `LIVE_STORE_OK`, `LIVE_PENALTIES_OK`, or sanitized failures. **No token, Riot ID, PUUID, personal skin contents or credentials are printed**. This is a third-party experimental integration and not Riot-approved RSO. Login and API calls can fail after Riot changes.

**Public-repository security:** do not let untrusted PRs run on self-hosted runners. Prefer a dedicated private repository and isolated low-privilege runner for any live login workflow. The interactive workflow is manually triggered only; it does not run on pull requests.

For a local smoke test without GitHub, on a Windows desktop with `install.bat` already run:

```powershell
$env:VALDASH_ALLOW_INTERACTIVE_LIVE_TEST='yes'
$env:VALDASH_SHARD='kr'
.venv\Scripts\python.exe -m scripts.real_login_smoke
```
