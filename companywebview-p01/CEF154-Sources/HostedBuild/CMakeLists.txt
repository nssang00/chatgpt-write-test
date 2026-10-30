cmake_minimum_required(VERSION 3.21)
project(CompanyWebViewCefHostedProduct LANGUAGES CXX)
if(NOT WIN32 OR NOT MSVC OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "Requires MSVC x64 on Windows")
endif()
if(NOT DEFINED CWV_SOURCE OR NOT EXISTS "${CWV_SOURCE}/CefTextureProbe.cpp")
  message(FATAL_ERROR "Verified CEF native source root required")
endif()
if(NOT DEFINED CEF_ROOT OR NOT EXISTS "${CEF_ROOT}/include/cef_app.h")
  message(FATAL_ERROR "Official CEF 154 root required")
endif()
if(NOT DEFINED UNITY_PLUGIN_API OR NOT EXISTS "${UNITY_PLUGIN_API}/IUnityGraphicsD3D11.h")
  message(FATAL_ERROR "Unity plugin interface headers required")
endif()
set(PROJECT_ARCH "x86_64")
set(USE_SANDBOX OFF CACHE BOOL "" FORCE)
list(APPEND CMAKE_MODULE_PATH "${CEF_ROOT}/cmake")
find_package(CEF REQUIRED)
add_subdirectory("${CEF_LIBCEF_DLL_WRAPPER_PATH}" libcef_dll_wrapper)
add_library(CompanyWebViewCefTextureProbe SHARED
  "${CWV_SOURCE}/CefTextureProbe.cpp"
  "${CWV_SOURCE}/Unity/UnityGraphicsDeviceBridge.cpp"
  "${CWV_SOURCE}/Host/CefRuntime.cpp"
  "${CWV_SOURCE}/Host/CefTextureHost.cpp"
  "${CWV_SOURCE}/Host/CefPrototypeApi.cpp")
target_compile_features(CompanyWebViewCefTextureProbe PRIVATE cxx_std_20)
target_compile_definitions(CompanyWebViewCefTextureProbe PRIVATE
  WIN32_LEAN_AND_MEAN NOMINMAX WEBVIEW_PROBE_WITH_UNITY=1 CEF_TEXTURE_PROBE_EXPORTS)
target_include_directories(CompanyWebViewCefTextureProbe PRIVATE
  "${CWV_SOURCE}" "${CEF_ROOT}" "${UNITY_PLUGIN_API}")
target_link_libraries(CompanyWebViewCefTextureProbe PRIVATE
  libcef_dll_wrapper "${CEF_LIB_RELEASE}" ${CEF_STANDARD_LIBS} d3d11 dxgi)
add_executable(CompanyWebViewCefSubprocess WIN32
  "${CWV_SOURCE}/Subprocess/main.cpp")
target_compile_features(CompanyWebViewCefSubprocess PRIVATE cxx_std_20)
target_compile_definitions(CompanyWebViewCefSubprocess PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
target_include_directories(CompanyWebViewCefSubprocess PRIVATE "${CWV_SOURCE}" "${CEF_ROOT}")
target_link_libraries(CompanyWebViewCefSubprocess PRIVATE
  libcef_dll_wrapper "${CEF_LIB_RELEASE}" ${CEF_STANDARD_LIBS})
set_target_properties(CompanyWebViewCefTextureProbe PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/stage/native")
set_target_properties(CompanyWebViewCefSubprocess PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/stage/runtime")
