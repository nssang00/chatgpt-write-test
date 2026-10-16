cmake_minimum_required(VERSION 3.16)
project(NativeWebWKWebViewApiProbe LANGUAGES CXX OBJCXX)

if(NOT APPLE)
  message(FATAL_ERROR "The WKWebView API probe requires macOS")
endif()

find_library(NATIVEWEB_APPKIT_FRAMEWORK AppKit)
find_library(NATIVEWEB_WEBKIT_FRAMEWORK WebKit)
if(NOT NATIVEWEB_APPKIT_FRAMEWORK OR NOT NATIVEWEB_WEBKIT_FRAMEWORK)
  message(FATAL_ERROR "macOS AppKit/WebKit frameworks are unavailable")
endif()

# Deliberately separate from the Core SDK: this is only the Apple adapter
# compile/link feasibility gate, NOT a working WKWebView browser backend.
add_executable(nativeweb_wkwebview_api_probe wkwebview_api_probe.mm)
target_compile_options(nativeweb_wkwebview_api_probe PRIVATE -fobjc-arc)
target_link_libraries(nativeweb_wkwebview_api_probe PRIVATE
  "${NATIVEWEB_APPKIT_FRAMEWORK}" "${NATIVEWEB_WEBKIT_FRAMEWORK}")
set_target_properties(nativeweb_wkwebview_api_probe PROPERTIES
  CXX_STANDARD 11
  CXX_STANDARD_REQUIRED YES
  CXX_EXTENSIONS NO
  OBJCXX_STANDARD 11
  OBJCXX_STANDARD_REQUIRED YES
  OBJCXX_EXTENSIONS NO)
