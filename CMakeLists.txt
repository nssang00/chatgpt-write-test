cmake_minimum_required(VERSION 3.16)

project(NativeWeb LANGUAGES CXX)

option(NATIVEWEB_BUILD_TESTS "Build NativeWeb regression tests" ON)

add_library(nativeweb_core INTERFACE)
add_library(NativeWeb::Core ALIAS nativeweb_core)

target_include_directories(nativeweb_core
    INTERFACE
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:include>
)

target_compile_features(nativeweb_core INTERFACE cxx_std_11)

if(NATIVEWEB_BUILD_TESTS)
    include(CTest)
    enable_testing()
    add_subdirectory(tests/core)
    add_subdirectory(tests/api)
endif()
