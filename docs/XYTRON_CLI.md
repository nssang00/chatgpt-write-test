Native C++11 xytron bootstrap CLI status
====================================

Implemented: xytron new desktop NAME --backend cpp|python|csharp; xytron plugin new NAME --language cpp; --help and --version. Command is native C++11 and does not need Node/Python to run. The app manifest has one Main and no Modules by default; C++ plugin template is independently packaged and uses PluginApi plus NATIVEWEB_PLUGIN macro.

This is only scaffolding. App files explicitly state that runtime integration is a TODO. Commands restore/run/build/test/publish/doctor/module add/plugin build fail with nonzero unimplemented status; no actual desktop app has been launched by this scaffold. Cross-platform tests use tools/cli/test_xytron.cmake and .github/workflows/xytron-cli.yml, independent of Core/browser CI. Next: manifest parser, language-neutral modules, plugin build, engine restore and standalone shell.

## First bootstrap validation

Scaffold matrix in [GitHub Actions 38334300772](https://github.com/nssang00/chatgpt-write-test/actions/runs/38334300772) has PASSED on Ubuntu and Windows at source 091a57f. That run verified file generation/invalid input only, not DLL/SO output. A follow-up workflow step now installs Core from source and builds the generated camera plugin from its own CMake project against the SDK exported CMake config. Mark binary-plugin generation PASS only after both CI jobs complete.

## Verified initial CLI code and generated plugin compilation (2026-10-13)

- Commit `091a57f4` implemented C++11-native scaffold CLI for three Main languages and a C++ independently delivered plugin.
- [CLI #38334300772](https://github.com/nssang00/chatgpt-write-test/actions/runs/38334300772) PASSED on Windows and Linux for input validation/scaffolding.
- [CLI #38334470209](https://github.com/nssang00/chatgpt-write-test/actions/runs/38334470209) PASSED on **both Windows and Linux**, including installed CMake Core SDK and compilation of scaffold-generated camera plugin as a real DLL or SO.
- [CLI #38334609335](https://github.com/nssang00/chatgpt-write-test/actions/runs/38334609335) also PASS on both OS after security policy foundation was added.

This is a repeatable developer-onboarding **foundation only**. No working desktop app, JS module bridge, Python/C# language host, `restore`, `run`, `publish` or CLI-managed plugin build command exists yet. The next work must test a real executable project without source tree access.
