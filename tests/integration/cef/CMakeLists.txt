cmake_minimum_required(VERSION 3.21)

project(NativeWebCefIntegration LANGUAGES C CXX)

if(NOT DEFINED CEF_ROOT OR CEF_ROOT STREQUAL "")
  message(FATAL_ERROR "CEF_ROOT must point to the extracted CEF distribution")
endif()

get_filename_component(
  NATIVEWEB_ROOT
  "${CMAKE_CURRENT_LIST_DIR}/../../.."
  ABSOLUTE
)

# Normalize command-line paths before CEF's CMake modules propagate them into
# nested try_compile projects. Raw Windows backslashes such as D:\a\... can
# otherwise be parsed as CMake escape sequences (for example \a).
file(TO_CMAKE_PATH "${CEF_ROOT}" CEF_ROOT)
list(APPEND CMAKE_MODULE_PATH "${CEF_ROOT}/cmake")

find_package(CEF REQUIRED)

if(NOT WIN32)
  find_package(Threads REQUIRED)
endif()

add_subdirectory(
  "${CEF_LIBCEF_DLL_WRAPPER_PATH}"
  "${CMAKE_BINARY_DIR}/libcef_dll_wrapper"
)

ADD_LOGICAL_TARGET(
  "libcef_lib"
  "${CEF_LIB_DEBUG}"
  "${CEF_LIB_RELEASE}"
)

add_library(nativeweb_core_for_cef STATIC
  "${NATIVEWEB_ROOT}/src/core/pending_call_registry.cpp"
  "${NATIVEWEB_ROOT}/src/core/object_registry.cpp"
  "${NATIVEWEB_ROOT}/src/core/native_object_runtime.cpp"
  "${NATIVEWEB_ROOT}/src/core/event_dispatcher.cpp"
  "${NATIVEWEB_ROOT}/src/core/bridge_message.cpp"
  "${NATIVEWEB_ROOT}/src/core/json_codec.cpp"
  "${NATIVEWEB_ROOT}/src/core/bridge_runtime.cpp"
  "${NATIVEWEB_ROOT}/src/core/binding_registry.cpp"
  "${NATIVEWEB_ROOT}/src/core/worker_pool.cpp"
  "${NATIVEWEB_ROOT}/src/browser/common/backend_registry.cpp"
  "${NATIVEWEB_ROOT}/src/plugin/shared_library.cpp"
  "${NATIVEWEB_ROOT}/src/plugin/plugin_module.cpp"
  "${NATIVEWEB_ROOT}/src/webview.cpp"
)

target_include_directories(nativeweb_core_for_cef
  PUBLIC
    "${NATIVEWEB_ROOT}/include"
  PRIVATE
    "${NATIVEWEB_ROOT}/src"
)

set_target_properties(nativeweb_core_for_cef PROPERTIES
  CXX_STANDARD 11
  CXX_STANDARD_REQUIRED YES
  CXX_EXTENSIONS NO
)

# CEF's Windows targets use the static MSVC runtime. nativeweb_core_for_cef is
# our own integration target and does not pass through CEF's target-property
# macros, so match its CRT explicitly to avoid /MD + /MT linker conflicts.
if(MSVC)
  set_property(
    TARGET nativeweb_core_for_cef
    PROPERTY MSVC_RUNTIME_LIBRARY
      "MultiThreaded$<$<CONFIG:Debug>:Debug>"
  )
endif()

if(NOT WIN32)
  target_link_libraries(nativeweb_core_for_cef
    PUBLIC
      Threads::Threads
      ${CMAKE_DL_LIBS}
  )
endif()

# CEF intentionally builds its own wrapper with C++ exceptions disabled.
# NativeWeb's public/runtime contract converts user C++ exceptions into
# structured Promise errors, so do not propagate CEF's _HAS_EXCEPTIONS=0
# policy into NativeWeb-owned backend/host targets.
if(MSVC)
  list(REMOVE_ITEM CEF_COMPILER_DEFINES _HAS_EXCEPTIONS=0)
endif()

add_library(nativeweb_cef_backend STATIC
  "${NATIVEWEB_ROOT}/src/browser/cef/cef_value_converter.cpp"
  "${NATIVEWEB_ROOT}/src/browser/cef/cef_renderer_app.cpp"
  "${NATIVEWEB_ROOT}/src/browser/cef/cef_backend.cpp"
)

target_include_directories(nativeweb_cef_backend
  PUBLIC
    "${NATIVEWEB_ROOT}/include"
  PRIVATE
    "${NATIVEWEB_ROOT}/src"
    "${CEF_ROOT}"
)

SET_LIBRARY_TARGET_PROPERTIES(nativeweb_cef_backend)

if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  target_compile_options(nativeweb_cef_backend PRIVATE -frtti -fexceptions)
elseif(MSVC)
  target_compile_options(nativeweb_cef_backend PRIVATE /EHsc)
  target_compile_definitions(nativeweb_cef_backend PRIVATE _HAS_EXCEPTIONS=1)
endif()

target_link_libraries(nativeweb_cef_backend
  PUBLIC
    nativeweb_core_for_cef
  PRIVATE
    libcef_lib
    libcef_dll_wrapper
    ${CEF_STANDARD_LIBS}
)

set(TARGET nativeweb_cef_bridge_integration)

add_executable(${TARGET}
  main.cpp
)

if(WIN32)
  target_sources(${TARGET} PRIVATE nativeweb_cef_windows_manifest.rc)
endif()

target_include_directories(${TARGET}
  PRIVATE
    "${NATIVEWEB_ROOT}/include"
    "${NATIVEWEB_ROOT}/src"
    "${CEF_ROOT}"
)

SET_EXECUTABLE_TARGET_PROPERTIES(${TARGET})

if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  target_compile_options(${TARGET} PRIVATE -frtti -fexceptions)
elseif(MSVC)
  target_compile_options(${TARGET} PRIVATE /EHsc)
  target_compile_definitions(${TARGET} PRIVATE _HAS_EXCEPTIONS=1)
endif()

target_link_libraries(${TARGET}
  PRIVATE
    nativeweb_cef_backend
    nativeweb_core_for_cef
    libcef_lib
    libcef_dll_wrapper
    ${CEF_STANDARD_LIBS}
)

set(CEF_TARGET_OUT_DIR "${CMAKE_BINARY_DIR}/bin")
set_target_properties(${TARGET} PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CEF_TARGET_OUT_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CEF_TARGET_OUT_DIR}"
)

COPY_FILES(
  "${TARGET}"
  "${CEF_BINARY_FILES}"
  "${CEF_BINARY_DIR}"
  "${CEF_TARGET_OUT_DIR}"
)

COPY_FILES(
  "${TARGET}"
  "${CEF_RESOURCE_FILES}"
  "${CEF_RESOURCE_DIR}"
  "${CEF_TARGET_OUT_DIR}"
)


set(MULTI_TARGET nativeweb_cef_multi_webview_integration)

add_executable(${MULTI_TARGET}
  multi_webview.cpp
)

if(WIN32)
  target_sources(${MULTI_TARGET} PRIVATE nativeweb_cef_windows_manifest.rc)
endif()

target_include_directories(${MULTI_TARGET}
  PRIVATE
    "${NATIVEWEB_ROOT}/include"
    "${NATIVEWEB_ROOT}/src"
    "${CEF_ROOT}"
)

SET_EXECUTABLE_TARGET_PROPERTIES(${MULTI_TARGET})

if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  target_compile_options(${MULTI_TARGET} PRIVATE -frtti -fexceptions)
elseif(MSVC)
  target_compile_options(${MULTI_TARGET} PRIVATE /EHsc)
  target_compile_definitions(${MULTI_TARGET} PRIVATE _HAS_EXCEPTIONS=1)
endif()

target_link_libraries(${MULTI_TARGET}
  PRIVATE
    nativeweb_cef_backend
    nativeweb_core_for_cef
    libcef_lib
    libcef_dll_wrapper
    ${CEF_STANDARD_LIBS}
)

set_target_properties(${MULTI_TARGET} PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CEF_TARGET_OUT_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CEF_TARGET_OUT_DIR}"
)

COPY_FILES(
  "${MULTI_TARGET}"
  "${CEF_BINARY_FILES}"
  "${CEF_BINARY_DIR}"
  "${CEF_TARGET_OUT_DIR}"
)

COPY_FILES(
  "${MULTI_TARGET}"
  "${CEF_RESOURCE_FILES}"
  "${CEF_RESOURCE_DIR}"
  "${CEF_TARGET_OUT_DIR}"
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
    --engine cef --build-dir "${CMAKE_BINARY_DIR}"
)
set_tests_properties(browser.plugin_object_lifecycle PROPERTIES TIMEOUT 150)
