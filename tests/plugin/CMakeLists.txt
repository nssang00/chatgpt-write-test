add_library(nativeweb_test_shared_library SHARED
    sample_shared_library.cpp
)

set_target_properties(nativeweb_test_shared_library PROPERTIES
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)

add_executable(nativeweb_shared_library_regression
    shared_library_regression.cpp
)

target_link_libraries(nativeweb_shared_library_regression
    PRIVATE
        NativeWeb::Core
)

target_include_directories(nativeweb_shared_library_regression
    PRIVATE
        ${PROJECT_SOURCE_DIR}/src
)

set_target_properties(nativeweb_shared_library_regression PROPERTIES
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)

add_test(
    NAME plugin.shared_library
    COMMAND
        nativeweb_shared_library_regression
        $<TARGET_FILE:nativeweb_test_shared_library>
)


add_library(nativeweb_test_plugin SHARED
    sample_plugin.cpp
)

target_include_directories(nativeweb_test_plugin
    PRIVATE
        ${PROJECT_SOURCE_DIR}/include
)

set_target_properties(nativeweb_test_plugin PROPERTIES
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)

add_library(nativeweb_test_bad_abi_plugin SHARED
    bad_abi_plugin.cpp
)

target_include_directories(nativeweb_test_bad_abi_plugin
    PRIVATE
        ${PROJECT_SOURCE_DIR}/include
)

set_target_properties(nativeweb_test_bad_abi_plugin PROPERTIES
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)

add_executable(nativeweb_plugin_module_regression
    plugin_module_regression.cpp
)

target_link_libraries(nativeweb_plugin_module_regression
    PRIVATE
        NativeWeb::Core
)

target_include_directories(nativeweb_plugin_module_regression
    PRIVATE
        ${PROJECT_SOURCE_DIR}/src
)

set_target_properties(nativeweb_plugin_module_regression PROPERTIES
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)

add_test(
    NAME plugin.module
    COMMAND
        nativeweb_plugin_module_regression
        $<TARGET_FILE:nativeweb_test_plugin>
        $<TARGET_FILE:nativeweb_test_bad_abi_plugin>
        $<TARGET_FILE:nativeweb_test_shared_library>
)


add_library(nativeweb_test_cpp_plugin SHARED
    sample_cpp_plugin.cpp
)

target_include_directories(nativeweb_test_cpp_plugin
    PRIVATE
        ${PROJECT_SOURCE_DIR}/include
)

set_target_properties(nativeweb_test_cpp_plugin PROPERTIES
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)

add_executable(nativeweb_cpp_plugin_wrapper_regression
    cpp_plugin_wrapper_regression.cpp
)

target_link_libraries(nativeweb_cpp_plugin_wrapper_regression
    PRIVATE
        NativeWeb::Core
)

target_include_directories(nativeweb_cpp_plugin_wrapper_regression
    PRIVATE
        ${PROJECT_SOURCE_DIR}/src
)

set_target_properties(nativeweb_cpp_plugin_wrapper_regression PROPERTIES
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)

add_test(
    NAME plugin.cpp_wrapper
    COMMAND
        nativeweb_cpp_plugin_wrapper_regression
        $<TARGET_FILE:nativeweb_test_cpp_plugin>
)

add_library(nativeweb_test_object_factory_plugin SHARED object_factory_plugin.cpp)
target_include_directories(nativeweb_test_object_factory_plugin PRIVATE ${PROJECT_SOURCE_DIR}/include)
set_target_properties(nativeweb_test_object_factory_plugin PROPERTIES CXX_STANDARD 11 CXX_STANDARD_REQUIRED YES CXX_EXTENSIONS NO)
add_executable(nativeweb_object_factory_regression object_factory_regression.cpp)
target_link_libraries(nativeweb_object_factory_regression PRIVATE NativeWeb::Core)
target_include_directories(nativeweb_object_factory_regression PRIVATE ${PROJECT_SOURCE_DIR}/src)
set_target_properties(nativeweb_object_factory_regression PROPERTIES CXX_STANDARD 11 CXX_STANDARD_REQUIRED YES CXX_EXTENSIONS NO)
add_test(NAME plugin.object_factory COMMAND nativeweb_object_factory_regression $<TARGET_FILE:nativeweb_test_object_factory_plugin>)

add_executable(nativeweb_webview_plugin_regression webview_plugin_regression.cpp)
target_link_libraries(nativeweb_webview_plugin_regression PRIVATE NativeWeb::Core)
target_include_directories(nativeweb_webview_plugin_regression PRIVATE ${PROJECT_SOURCE_DIR}/src)
set_target_properties(nativeweb_webview_plugin_regression PROPERTIES
    CXX_STANDARD 11 CXX_STANDARD_REQUIRED YES CXX_EXTENSIONS NO)
add_test(NAME plugin.webview_facade COMMAND nativeweb_webview_plugin_regression
    $<TARGET_FILE:nativeweb_test_object_factory_plugin>)

add_executable(nativeweb_plugin_async_lifetime_regression plugin_async_lifetime_regression.cpp)
target_link_libraries(nativeweb_plugin_async_lifetime_regression PRIVATE NativeWeb::Core)
target_include_directories(nativeweb_plugin_async_lifetime_regression PRIVATE ${PROJECT_SOURCE_DIR}/src)
set_target_properties(nativeweb_plugin_async_lifetime_regression PROPERTIES
    CXX_STANDARD 11 CXX_STANDARD_REQUIRED YES CXX_EXTENSIONS NO)
add_test(NAME plugin.async_lifetime COMMAND nativeweb_plugin_async_lifetime_regression
    $<TARGET_FILE:nativeweb_test_object_factory_plugin>)
