cmake_minimum_required(VERSION 3.21)

project(NativeWebWebView2Integration LANGUAGES CXX)

if(NOT WIN32)
  message(FATAL_ERROR "NativeWeb WebView2 integration requires Windows")
endif()

if(NOT DEFINED WEBVIEW2_ROOT OR WEBVIEW2_ROOT STREQUAL "")
  message(FATAL_ERROR "WEBVIEW2_ROOT must point to an extracted Microsoft.Web.WebView2 NuGet package")
endif()

get_filename_component(
  NATIVEWEB_ROOT
  "${CMAKE_CURRENT_LIST_DIR}/../../.."
  ABSOLUTE
)

find_package(Threads REQUIRED)

if(CMAKE_SIZEOF_VOID_P EQUAL 8)
  set(WEBVIEW2_ARCH x64)
else()
  set(WEBVIEW2_ARCH x86)
endif()

set(WEBVIEW2_INCLUDE_DIR "${WEBVIEW2_ROOT}/build/native/include")
set(
  WEBVIEW2_LOADER_STATIC
  "${WEBVIEW2_ROOT}/build/native/${WEBVIEW2_ARCH}/WebView2LoaderStatic.lib"
)

if(NOT EXISTS "${WEBVIEW2_INCLUDE_DIR}/WebView2.h")
  message(FATAL_ERROR "WebView2.h not found under ${WEBVIEW2_INCLUDE_DIR}")
endif()

if(NOT EXISTS "${WEBVIEW2_LOADER_STATIC}")
  message(FATAL_ERROR "WebView2 static loader not found: ${WEBVIEW2_LOADER_STATIC}")
endif()

add_library(nativeweb_core_for_webview2 STATIC
  "${NATIVEWEB_ROOT}/src/core/pending_call_registry.cpp"
  "${NATIVEWEB_ROOT}/src/core/object_registry.cpp"
  "${NATIVEWEB_ROOT}/src/core/native_object_runtime.cpp"
  "${NATIVEWEB_ROOT}/src/core/event_dispatcher.cpp"
  "${NATIVEWEB_ROOT}/src/core/bridge_message.cpp"
  "${NATIVEWEB_ROOT}/src/core/json_codec.cpp"
  "${NATIVEWEB_ROOT}/src/core/process_broker.cpp"
  "${NATIVEWEB_ROOT}/src/core/bridge_runtime.cpp"
  "${NATIVEWEB_ROOT}/src/core/app_resources.cpp"
  "${NATIVEWEB_ROOT}/src/core/module_registry.cpp"
  "${NATIVEWEB_ROOT}/src/core/binding_registry.cpp"
  "${NATIVEWEB_ROOT}/src/core/worker_pool.cpp"
  "${NATIVEWEB_ROOT}/src/browser/common/backend_registry.cpp"
  "${NATIVEWEB_ROOT}/src/plugin/shared_library.cpp"
  "${NATIVEWEB_ROOT}/src/plugin/plugin_module.cpp"
  "${NATIVEWEB_ROOT}/src/webview.cpp"
)

target_include_directories(nativeweb_core_for_webview2
  PUBLIC
    "${NATIVEWEB_ROOT}/include"
  PRIVATE
    "${NATIVEWEB_ROOT}/src"
)

target_compile_features(nativeweb_core_for_webview2 PUBLIC cxx_std_11)
target_link_libraries(nativeweb_core_for_webview2 PUBLIC Threads::Threads)

add_library(nativeweb_webview2_backend STATIC
  "${NATIVEWEB_ROOT}/src/browser/webview2/webview2_backend.cpp"
)

target_include_directories(nativeweb_webview2_backend
  PUBLIC
    "${NATIVEWEB_ROOT}/include"
  PRIVATE
    "${NATIVEWEB_ROOT}/src"
    "${WEBVIEW2_INCLUDE_DIR}"
)

target_compile_features(nativeweb_webview2_backend PUBLIC cxx_std_11)

target_compile_definitions(nativeweb_webview2_backend
  PRIVATE
    UNICODE
    _UNICODE
    WIN32_LEAN_AND_MEAN
    NOMINMAX
)

target_link_libraries(nativeweb_webview2_backend
  PUBLIC
    nativeweb_core_for_webview2
  PRIVATE
    "${WEBVIEW2_LOADER_STATIC}"
    ole32
    user32
    version
    shlwapi
)

add_executable(nativeweb_webview2_bridge_integration
  main.cpp
)

target_include_directories(nativeweb_webview2_bridge_integration
  PRIVATE
    "${NATIVEWEB_ROOT}/include"
    "${NATIVEWEB_ROOT}/src"
    "${WEBVIEW2_INCLUDE_DIR}"
)

target_compile_features(nativeweb_webview2_bridge_integration PUBLIC cxx_std_11)

target_compile_definitions(nativeweb_webview2_bridge_integration
  PRIVATE
    UNICODE
    _UNICODE
    WIN32_LEAN_AND_MEAN
    NOMINMAX
)

target_link_libraries(nativeweb_webview2_bridge_integration
  PRIVATE
    nativeweb_webview2_backend
    nativeweb_core_for_webview2
    user32
)

set_target_properties(
  nativeweb_webview2_bridge_integration
  PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin"
)


add_executable(nativeweb_webview2_multi_webview_integration
  multi_webview.cpp
)

target_include_directories(nativeweb_webview2_multi_webview_integration
  PRIVATE
    "${NATIVEWEB_ROOT}/include"
    "${NATIVEWEB_ROOT}/src"
    "${WEBVIEW2_INCLUDE_DIR}"
)

target_compile_features(nativeweb_webview2_multi_webview_integration PUBLIC cxx_std_11)

target_compile_definitions(nativeweb_webview2_multi_webview_integration
  PRIVATE
    UNICODE
    _UNICODE
    WIN32_LEAN_AND_MEAN
    NOMINMAX
)

target_link_libraries(nativeweb_webview2_multi_webview_integration
  PRIVATE
    nativeweb_webview2_backend
    nativeweb_core_for_webview2
    user32
)

set_target_properties(
  nativeweb_webview2_multi_webview_integration
  PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin"
)

# Real SO/DLL used by --plugin-path E2E. Never replace with a mock module.
add_library(nativeweb_plugin_browser_fixture SHARED
  "${NATIVEWEB_ROOT}/tests/plugin/object_factory_plugin.cpp"
)
target_include_directories(nativeweb_plugin_browser_fixture PRIVATE
  "${NATIVEWEB_ROOT}/include"
)
set_target_properties(nativeweb_plugin_browser_fixture PROPERTIES
  CXX_STANDARD 11
  CXX_STANDARD_REQUIRED YES
  CXX_EXTENSIONS NO
  LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin"
)

# This is an opt-in external SDK build, so the browser E2E is mandatory
# whenever this integration project is configured and CTest is run.
include(CTest)
find_package(Python3 COMPONENTS Interpreter REQUIRED)
add_test(
  NAME browser.plugin_object_lifecycle
  COMMAND "${Python3_EXECUTABLE}"
    "${NATIVEWEB_ROOT}/tools/run_browser_plugin_e2e.py"
    --engine webview2 --build-dir "${CMAKE_BINARY_DIR}"
)
set_tests_properties(browser.plugin_object_lifecycle PROPERTIES TIMEOUT 150)

add_test(
  NAME browser.app_resource_lifecycle
  COMMAND "${Python3_EXECUTABLE}"
    "${NATIVEWEB_ROOT}/tools/run_browser_plugin_e2e.py"
    --engine webview2 --build-dir "${CMAKE_BINARY_DIR}" --app-resources
)
set_tests_properties(browser.app_resource_lifecycle PROPERTIES TIMEOUT 150)


# Actual JavaScript -> engine bridge -> C++11 ProcessBroker -> Python object host.
add_test(
  NAME browser.managed_python
  COMMAND "${Python3_EXECUTABLE}"
    "${NATIVEWEB_ROOT}/tools/run_browser_plugin_e2e.py"
    --engine webview2 --build-dir "${CMAKE_BINARY_DIR}" --managed
)
set_tests_properties(browser.managed_python PROPERTIES TIMEOUT 150)

# Real browser -> C++ ProcessBroker -> .NET 8 worker (requires built test assembly).
add_test(
  NAME browser.managed_dotnet
  COMMAND "${Python3_EXECUTABLE}"
    "${NATIVEWEB_ROOT}/tools/run_browser_plugin_e2e.py"
    --engine webview2 --build-dir "${CMAKE_BINARY_DIR}" --managed-dotnet
)
set_tests_properties(browser.managed_dotnet PROPERTIES TIMEOUT 150)
