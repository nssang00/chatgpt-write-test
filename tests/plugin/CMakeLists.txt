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
