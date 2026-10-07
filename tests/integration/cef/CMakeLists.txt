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

list(APPEND CMAKE_MODULE_PATH "${CEF_ROOT}/cmake")
find_package(CEF REQUIRED)

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
  "${NATIVEWEB_ROOT}/src/core/event_dispatcher.cpp"
  "${NATIVEWEB_ROOT}/src/core/bridge_message.cpp"
  "${NATIVEWEB_ROOT}/src/core/bridge_runtime.cpp"
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

target_include_directories(${TARGET}
  PRIVATE
    "${NATIVEWEB_ROOT}/include"
    "${NATIVEWEB_ROOT}/src"
    "${CEF_ROOT}"
)

SET_EXECUTABLE_TARGET_PROPERTIES(${TARGET})

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
