add_executable(nativeweb_any_regression
    any_regression.cpp
)

target_link_libraries(nativeweb_any_regression
    PRIVATE
        NativeWeb::Core
)

set_target_properties(nativeweb_any_regression PROPERTIES
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)

add_test(
    NAME core.any
    COMMAND nativeweb_any_regression
)

add_executable(nativeweb_bind_adapter_regression
    bind_adapter_regression.cpp
)

target_link_libraries(nativeweb_bind_adapter_regression
    PRIVATE
        NativeWeb::Core
)

set_target_properties(nativeweb_bind_adapter_regression PROPERTIES
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)

add_test(
    NAME core.bind_adapter
    COMMAND nativeweb_bind_adapter_regression
)

add_executable(nativeweb_pending_call_regression
    pending_call_registry_regression.cpp
)

target_link_libraries(nativeweb_pending_call_regression
    PRIVATE
        NativeWeb::Core
)

target_include_directories(nativeweb_pending_call_regression
    PRIVATE
        ${PROJECT_SOURCE_DIR}/src
)

set_target_properties(nativeweb_pending_call_regression PROPERTIES
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)

add_test(
    NAME core.pending_call
    COMMAND nativeweb_pending_call_regression
)
