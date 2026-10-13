Native C++11 xytron bootstrap CLI status
====================================

Implemented: xytron new desktop NAME --backend cpp|python|csharp; xytron plugin new NAME --language cpp; --help and --version. Command is native C++11 and does not need Node/Python to run. The app manifest has one Main and no Modules by default; C++ plugin template is independently packaged and uses PluginApi plus NATIVEWEB_PLUGIN macro.

This is only scaffolding. App files explicitly state that runtime integration is a TODO. Commands restore/run/build/test/publish/doctor/module add/plugin build fail with nonzero unimplemented status; no actual desktop app has been launched by this scaffold. Cross-platform tests use tools/cli/test_xytron.cmake and .github/workflows/xytron-cli.yml, independent of Core/browser CI. Next: manifest parser, language-neutral modules, plugin build, engine restore and standalone shell.
