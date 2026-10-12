cmake_minimum_required(VERSION 3.16)
project(NativeWebInstalledSdkConsumer LANGUAGES C CXX)

find_package(NativeWeb CONFIG REQUIRED)
add_executable(nativeweb_sdk_consumer main.cpp)
target_link_libraries(nativeweb_sdk_consumer PRIVATE NativeWeb::Core)
target_compile_features(nativeweb_sdk_consumer PRIVATE cxx_std_11)
set_target_properties(nativeweb_sdk_consumer PROPERTIES CXX_STANDARD 11 CXX_STANDARD_REQUIRED YES CXX_EXTENSIONS NO)

enable_testing()
add_test(NAME installed_sdk.basic COMMAND nativeweb_sdk_consumer)

# The stable plugin ABI is a public C header; compilation must not require C++.
add_library(nativeweb_sdk_c_abi_header OBJECT c_abi_header.c)
target_link_libraries(nativeweb_sdk_c_abi_header PRIVATE NativeWeb::Core)
