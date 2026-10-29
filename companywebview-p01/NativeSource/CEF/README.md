# P0-1 CEF 154 source-first build

The manifest pins 14 individual C++ native files expected below `Native/`. This is a **manifest only**; the entire C++ tree must be uploaded before this can compile.

Version: `154.0.28+g564dd6c+chromium-154.0.8037.58` (official Windows x64 minimal SDK). Official upstream SHA-1: `34a32277db8addfa355a009ed16c8dae939daed1`.

The source-first project has a one-line CMake path adaptation (local NativeSmoke source path), reflected in CMakeLists.txt's SHA-256. Do not substitute other SDK or old CEF 144 integration as product evidence.

**Release status:** exact CEF native source upload and MSVC product DLL/subprocess compilation are not yet complete; Unity Player and GPU tests remain separate gates.
