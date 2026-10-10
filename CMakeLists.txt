cmake_minimum_required(VERSION 3.16)

project(NativeWeb LANGUAGES CXX)

option(NATIVEWEB_BUILD_TESTS "Build NativeWeb regression tests" ON)

find_package(Threads REQUIRED)

add_library(nativeweb_core STATIC
    src/core/pending_call_registry.cpp
    src/core/object_registry.cpp
    src/core/native_object_runtime.cpp
    src/core/event_dispatcher.cpp
    src/core/bridge_message.cpp
    src/core/json_codec.cpp
    src/core/bridge_runtime.cpp
    src/core/binding_registry.cpp
    src/core/worker_pool.cpp
    src/browser/common/backend_registry.cpp
    src/plugin/shared_library.cpp
    src/plugin/plugin_module.cpp
    src/webview.cpp
)
add_library(NativeWeb::Core ALIAS nativeweb_core)

target_include_directories(nativeweb_core
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:include>
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(nativeweb_core
    PUBLIC
        Threads::Threads
        ${CMAKE_DL_LIBS}
)

target_compile_features(nativeweb_core PUBLIC cxx_std_11)

set_target_properties(nativeweb_core PROPERTIES
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)

if(NATIVEWEB_BUILD_TESTS)
    include(CTest)
    enable_testing()
    add_subdirectory(tests/core)
    add_subdirectory(tests/api)
    add_subdirectory(tests/plugin)
endif()
