cmake_minimum_required(VERSION 3.21)
project(CompanyWebViewCefRuntime LANGUAGES CXX)

if(NOT WIN32)
  message(FATAL_ERROR "CEF Texture runtime currently targets Windows only")
endif()

if(NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "CEF Texture runtime supports Windows x64 only")
endif()

set(CEF_ROOT "" CACHE PATH "Path to the pinned CEF binary distribution")
set(UNITY_PLUGIN_API "" CACHE PATH "Path to Unity native plugin API headers")
set(WEBVIEW_STAGE_DIR "${CMAKE_BINARY_DIR}/stage" CACHE PATH "Runtime staging output")
set(WEBVIEW_VALIDATION_SMOKE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../Validation/CefTexture/NativeSmoke")

add_library(CompanyWebViewCefTextureProbe SHARED
  CefTextureProbe.cpp
  Unity/UnityGraphicsDeviceBridge.cpp
)
target_compile_features(CompanyWebViewCefTextureProbe PRIVATE cxx_std_20)
target_compile_definitions(CompanyWebViewCefTextureProbe PRIVATE
  CEF_TEXTURE_PROBE_EXPORTS
  WIN32_LEAN_AND_MEAN
  NOMINMAX
)
target_include_directories(CompanyWebViewCefTextureProbe PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(CompanyWebViewCefTextureProbe PRIVATE d3d11 dxgi)

if(UNITY_PLUGIN_API)
  target_include_directories(CompanyWebViewCefTextureProbe PRIVATE ${UNITY_PLUGIN_API})
  target_compile_definitions(CompanyWebViewCefTextureProbe PRIVATE WEBVIEW_PROBE_WITH_UNITY=1)
else()
  message(WARNING "UNITY_PLUGIN_API is not set. Unity D3D11 device hook will not be compiled.")
endif()

if(CEF_ROOT)
  # CEF's official CMake configuration uses PROJECT_ARCH to select x64 files.
  set(PROJECT_ARCH "x86_64")
  set(USE_SANDBOX OFF CACHE BOOL "Runtime uses sandbox-off flow" FORCE)
  list(APPEND CMAKE_MODULE_PATH "${CEF_ROOT}/cmake")
  find_package(CEF REQUIRED)
  add_subdirectory(${CEF_LIBCEF_DLL_WRAPPER_PATH} libcef_dll_wrapper)

  add_executable(CompanyWebViewCefSubprocess WIN32
    Subprocess/main.cpp
  )
  target_compile_features(CompanyWebViewCefSubprocess PRIVATE cxx_std_20)
  target_compile_definitions(CompanyWebViewCefSubprocess PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
  target_include_directories(CompanyWebViewCefSubprocess PRIVATE ${CEF_ROOT})
  target_link_libraries(CompanyWebViewCefSubprocess PRIVATE
    libcef_dll_wrapper
    $<$<CONFIG:Debug>:${CEF_LIB_DEBUG}>
    $<$<NOT:$<CONFIG:Debug>>:${CEF_LIB_RELEASE}>
    ${CEF_STANDARD_LIBS}
  )


  add_executable(CompanyWebViewCefInitSmoke WIN32
    ${WEBVIEW_VALIDATION_SMOKE_DIR}/main.cpp
  )
  add_executable(CompanyWebViewCefExportCheck
    ${WEBVIEW_VALIDATION_SMOKE_DIR}/export_check.cpp
  )
  add_executable(CompanyWebViewCefNativeRefreshControl WIN32
    ${WEBVIEW_VALIDATION_SMOKE_DIR}/native_refresh_control.cpp
  )
  target_compile_features(CompanyWebViewCefNativeRefreshControl PRIVATE cxx_std_20)
  target_compile_definitions(CompanyWebViewCefNativeRefreshControl PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
  target_include_directories(CompanyWebViewCefNativeRefreshControl PRIVATE ${CEF_ROOT})
  target_link_libraries(CompanyWebViewCefNativeRefreshControl PRIVATE
    libcef_dll_wrapper
    $<$<CONFIG:Debug>:${CEF_LIB_DEBUG}>
    $<$<NOT:$<CONFIG:Debug>>:${CEF_LIB_RELEASE}>
    ${CEF_STANDARD_LIBS}
  )

  add_executable(CompanyWebViewD3D11CopyBenchmark
    ${WEBVIEW_VALIDATION_SMOKE_DIR}/d3d11_copy_benchmark.cpp
  )
  add_executable(CompanyWebViewDxgiAdapterProbe ${WEBVIEW_VALIDATION_SMOKE_DIR}/dxgi_adapter_probe.cpp)
  target_compile_features(CompanyWebViewDxgiAdapterProbe PRIVATE cxx_std_20)
  target_link_libraries(CompanyWebViewDxgiAdapterProbe PRIVATE dxgi)
  target_compile_features(CompanyWebViewD3D11CopyBenchmark PRIVATE cxx_std_20)
  target_compile_definitions(CompanyWebViewD3D11CopyBenchmark PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
  target_link_libraries(CompanyWebViewD3D11CopyBenchmark PRIVATE d3d11 dxgi)
  target_compile_features(CompanyWebViewCefExportCheck PRIVATE cxx_std_20)
  target_compile_definitions(CompanyWebViewCefExportCheck PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)

  target_compile_features(CompanyWebViewCefInitSmoke PRIVATE cxx_std_20)
  target_compile_definitions(CompanyWebViewCefInitSmoke PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
  target_include_directories(CompanyWebViewCefInitSmoke PRIVATE ${CEF_ROOT})
  target_link_libraries(CompanyWebViewCefInitSmoke PRIVATE
    libcef_dll_wrapper
    $<$<CONFIG:Debug>:${CEF_LIB_DEBUG}>
    $<$<NOT:$<CONFIG:Debug>>:${CEF_LIB_RELEASE}>
    ${CEF_STANDARD_LIBS}
  )

  target_sources(CompanyWebViewCefTextureProbe PRIVATE
    Host/CefRuntime.cpp
    Host/CefTextureHost.cpp
    Host/CefPrototypeApi.cpp
  )
  target_include_directories(CompanyWebViewCefTextureProbe PRIVATE ${CEF_ROOT})
  target_link_libraries(CompanyWebViewCefTextureProbe PRIVATE
    libcef_dll_wrapper
    $<$<CONFIG:Debug>:${CEF_LIB_DEBUG}>
    $<$<NOT:$<CONFIG:Debug>>:${CEF_LIB_RELEASE}>
    ${CEF_STANDARD_LIBS}
  )

  # Apply CEF's target properties when available from the binary distribution.
  if(COMMAND SET_LIBRARY_TARGET_PROPERTIES)
    SET_LIBRARY_TARGET_PROPERTIES(CompanyWebViewCefTextureProbe)
  endif()
  if(COMMAND SET_EXECUTABLE_TARGET_PROPERTIES)
    SET_EXECUTABLE_TARGET_PROPERTIES(CompanyWebViewCefSubprocess)
    SET_EXECUTABLE_TARGET_PROPERTIES(CompanyWebViewCefInitSmoke)
    SET_EXECUTABLE_TARGET_PROPERTIES(CompanyWebViewCefExportCheck)
    SET_EXECUTABLE_TARGET_PROPERTIES(CompanyWebViewCefNativeRefreshControl)
    SET_EXECUTABLE_TARGET_PROPERTIES(CompanyWebViewD3D11CopyBenchmark)
    SET_EXECUTABLE_TARGET_PROPERTIES(CompanyWebViewDxgiAdapterProbe)
  endif()

  # Build output that can be consumed by the PowerShell Unity staging script.
  # Layout intentionally mirrors the two places required by the first Unity probe:
  #   native/  - Unity native plugin + link-time CEF runtime DLL dependencies
  #   runtime/ - subprocess + CEF resources/locales
  set(WEBVIEW_NATIVE_STAGE "${WEBVIEW_STAGE_DIR}/native/$<CONFIG>")
  set(WEBVIEW_RUNTIME_STAGE "${WEBVIEW_STAGE_DIR}/runtime/$<CONFIG>")

  add_custom_command(TARGET CompanyWebViewCefTextureProbe POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${WEBVIEW_NATIVE_STAGE}"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      "$<TARGET_FILE:CompanyWebViewCefTextureProbe>"
      "${WEBVIEW_NATIVE_STAGE}/"
    VERBATIM
  )

  add_custom_command(TARGET CompanyWebViewCefSubprocess POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${WEBVIEW_RUNTIME_STAGE}"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      "$<TARGET_FILE:CompanyWebViewCefSubprocess>"
      "${WEBVIEW_RUNTIME_STAGE}/"
    VERBATIM
  )

  add_custom_command(TARGET CompanyWebViewCefInitSmoke POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${WEBVIEW_RUNTIME_STAGE}"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      "$<TARGET_FILE:CompanyWebViewCefInitSmoke>"
      "${WEBVIEW_RUNTIME_STAGE}/"
    VERBATIM
  )

  add_custom_command(TARGET CompanyWebViewCefExportCheck POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${WEBVIEW_RUNTIME_STAGE}"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      "$<TARGET_FILE:CompanyWebViewCefExportCheck>"
      "${WEBVIEW_RUNTIME_STAGE}/"
    VERBATIM
  )

  add_custom_command(TARGET CompanyWebViewCefNativeRefreshControl POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${WEBVIEW_RUNTIME_STAGE}"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different "$<TARGET_FILE:CompanyWebViewCefNativeRefreshControl>" "${WEBVIEW_RUNTIME_STAGE}/"
    VERBATIM
  )
  add_custom_command(TARGET CompanyWebViewD3D11CopyBenchmark POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${WEBVIEW_RUNTIME_STAGE}"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different "$<TARGET_FILE:CompanyWebViewD3D11CopyBenchmark>" "${WEBVIEW_RUNTIME_STAGE}/"
    VERBATIM
  )

  # Copy CEF binary dependencies to both locations for the runtime validation build. This is
  # deliberately redundant; product packaging will replace this with a single
  # controlled runtime location and loader strategy.
  foreach(_cef_binary ${CEF_BINARY_FILES})
    add_custom_command(TARGET CompanyWebViewCefTextureProbe POST_BUILD
      COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CEF_BINARY_DIR}/${_cef_binary}"
        "${WEBVIEW_NATIVE_STAGE}/${_cef_binary}"
      VERBATIM
    )
    add_custom_command(TARGET CompanyWebViewCefSubprocess POST_BUILD
      COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CEF_BINARY_DIR}/${_cef_binary}"
        "${WEBVIEW_RUNTIME_STAGE}/${_cef_binary}"
      VERBATIM
    )
  endforeach()

  foreach(_cef_resource ${CEF_RESOURCE_FILES})
    if(_cef_resource STREQUAL "locales")
      add_custom_command(TARGET CompanyWebViewCefSubprocess POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_directory
          "${CEF_RESOURCE_DIR}/locales"
          "${WEBVIEW_RUNTIME_STAGE}/locales"
        VERBATIM
      )
    else()
      add_custom_command(TARGET CompanyWebViewCefSubprocess POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
          "${CEF_RESOURCE_DIR}/${_cef_resource}"
          "${WEBVIEW_RUNTIME_STAGE}/${_cef_resource}"
        VERBATIM
      )
    endif()
  endforeach()

  add_custom_command(TARGET CompanyWebViewDxgiAdapterProbe POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${WEBVIEW_RUNTIME_STAGE}"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different "$<TARGET_FILE:CompanyWebViewDxgiAdapterProbe>" "${WEBVIEW_RUNTIME_STAGE}/"
    VERBATIM
  )

  add_custom_target(CefRuntimeStage ALL
    DEPENDS
      CompanyWebViewCefTextureProbe
      CompanyWebViewCefSubprocess
      CompanyWebViewCefInitSmoke
      CompanyWebViewCefExportCheck
      CompanyWebViewCefNativeRefreshControl
      CompanyWebViewD3D11CopyBenchmark
      CompanyWebViewDxgiAdapterProbe
  )
else()
  message(STATUS "CEF_ROOT not set: building only the D3D11/Unity texture bridge probe")
endif()
