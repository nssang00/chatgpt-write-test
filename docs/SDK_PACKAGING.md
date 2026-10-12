# NativeWeb Core installed SDK verification

The first SDK packaging milestone exports engine-neutral `NativeWeb::Core`
with public C++11 headers. It does **not** constitute a full CEF or WebView2
runtime distribution.

```sh
cmake -S . -B build-sdk -DNATIVEWEB_BUILD_TESTS=OFF -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/tmp/nativeweb-sdk
cmake --build build-sdk --config Release
cmake --install build-sdk --config Release
cmake -S examples/sdk_consumer -B build-consumer -DCMAKE_PREFIX_PATH=/tmp/nativeweb-sdk
cmake --build build-consumer --config Release
ctest --test-dir build-consumer -C Release --output-on-failure
```

The installed consumer intentionally uses no source-tree includes, ensuring
`find_package(NativeWeb CONFIG REQUIRED)` and `NativeWeb::Core` are enough.
The release criteria still require Windows CI evidence and real browser E2E.
`project(VERSION 0.1.0)` here is an SDK package compatibility version, not
an assertion of an approved product release.
