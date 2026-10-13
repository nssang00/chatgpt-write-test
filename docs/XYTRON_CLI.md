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

## CLI `module add` bootstrap

The new `xytron module add ID --language cpp|python|csharp` command runs
inside a CLI-generated project, creates embedded Module source/descriptor
and appends it to `xytron.json` while preserving the original single Main.
A Python Main + C++/Python/C# feature Module combination is exercised
by the CLI's Windows/Linux CTest. This is a **scaffolding operation**;
module loading, JS dispatch and real mixed-language app execution remain
unimplemented.

The implementation intentionally accepts only the CLI-produced manifest
layout, rejects unknown user-edited Module records and refuses duplicate
IDs or directory overwrites. A general versioned JSON schema parser and
atomic manifest save are required before production-grade CLI release.

## Verified mixed-language scaffold CLI (code 7e45e72b)

`xytron module add` and C++ plugin bootstrap compile tests pass on
Windows and Ubuntu in [CLI 38336744554](https://github.com/nssang00/chatgpt-write-test/actions/runs/38336744554).
The test script typo NW-016 was fixed; no live Python/.NET module
process runs as part of this command. Real shell/run/publish is pending.

## Native `xytron plugin build` implemented (2026-10-13)

`xytron plugin build camera --sdk /installed/nativeweb/prefix` invokes
CMake configure/build in the generated `plugins/camera` tree against a
previously installed NativeWeb Core SDK. The code builds an **actual C++
DLL/SO**, not an example-text file. SDK prefix arguments are bounded and
reject shell metacharacters; Module IDs are constrained to strict ASCII.
The workflow now tests the **CLI command** on both Windows and Linux,
in addition to the existing direct CMake build.

The SDK is still supplied explicitly. `xytron restore` (download),
automatic CLI plugin SDK discovery, signing, C ABI runtime loading,
`xytron run` and `xytron publish` are separate open deliverables.
Do not confuse this build command with application deployment.

### Verified `xytron plugin build`

[Windows + Ubuntu CLI run 38343029145](https://github.com/nssang00/chatgpt-write-test/actions/runs/38343029145)
passes all commands, including SDK installation and the **native xytron
plugin build command** that configures and compiles an actual DLL/SO.
The first CLI test failed because a semicolon in a CMake test argument was
split into multiple positional arguments (NW-021); after replacing the
probe with an ampersand, the test passed on both OS. An installed SDK
is required; this is not `xytron restore/run/publish`.
