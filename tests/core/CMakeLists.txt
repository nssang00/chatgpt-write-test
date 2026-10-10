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

add_executable(nativeweb_object_registry_regression
    object_registry_regression.cpp
)

target_link_libraries(nativeweb_object_registry_regression
    PRIVATE
        NativeWeb::Core
)

target_include_directories(nativeweb_object_registry_regression
    PRIVATE
        ${PROJECT_SOURCE_DIR}/src
)

set_target_properties(nativeweb_object_registry_regression PROPERTIES
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)

add_test(
    NAME core.object_registry
    COMMAND nativeweb_object_registry_regression
)

add_executable(nativeweb_async_adapter_regression
    async_adapter_regression.cpp
)
target_link_libraries(nativeweb_async_adapter_regression PRIVATE NativeWeb::Core)
set_target_properties(nativeweb_async_adapter_regression PROPERTIES
    CXX_STANDARD 11 CXX_STANDARD_REQUIRED YES CXX_EXTENSIONS NO)
add_test(NAME core.async_adapter COMMAND nativeweb_async_adapter_regression)

add_executable(nativeweb_event_dispatcher_regression
    event_dispatcher_regression.cpp
)
target_link_libraries(nativeweb_event_dispatcher_regression PRIVATE NativeWeb::Core)
target_include_directories(nativeweb_event_dispatcher_regression PRIVATE ${PROJECT_SOURCE_DIR}/src)
set_target_properties(nativeweb_event_dispatcher_regression PROPERTIES
    CXX_STANDARD 11 CXX_STANDARD_REQUIRED YES CXX_EXTENSIONS NO)
add_test(NAME core.event_dispatcher COMMAND nativeweb_event_dispatcher_regression)

add_executable(nativeweb_bridge_message_regression
    bridge_message_regression.cpp
)
target_link_libraries(nativeweb_bridge_message_regression PRIVATE NativeWeb::Core)
target_include_directories(nativeweb_bridge_message_regression PRIVATE ${PROJECT_SOURCE_DIR}/src)
set_target_properties(nativeweb_bridge_message_regression PROPERTIES
    CXX_STANDARD 11 CXX_STANDARD_REQUIRED YES CXX_EXTENSIONS NO)
add_test(NAME core.bridge_message COMMAND nativeweb_bridge_message_regression)

add_executable(nativeweb_bridge_runtime_regression
    bridge_runtime_regression.cpp
)
target_link_libraries(nativeweb_bridge_runtime_regression PRIVATE NativeWeb::Core)
target_include_directories(nativeweb_bridge_runtime_regression PRIVATE ${PROJECT_SOURCE_DIR}/src)
set_target_properties(nativeweb_bridge_runtime_regression PROPERTIES
    CXX_STANDARD 11 CXX_STANDARD_REQUIRED YES CXX_EXTENSIONS NO)
add_test(NAME core.bridge_runtime COMMAND nativeweb_bridge_runtime_regression)

add_executable(nativeweb_webview_orchestration_regression
    webview_orchestration_regression.cpp
)

target_link_libraries(nativeweb_webview_orchestration_regression
    PRIVATE
        NativeWeb::Core
)

target_include_directories(nativeweb_webview_orchestration_regression
    PRIVATE
        ${PROJECT_SOURCE_DIR}/src
)

set_target_properties(nativeweb_webview_orchestration_regression PROPERTIES
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)

add_test(
    NAME core.webview_orchestration
    COMMAND nativeweb_webview_orchestration_regression
)

add_executable(nativeweb_native_object_runtime_regression
    native_object_runtime_regression.cpp
)

target_link_libraries(nativeweb_native_object_runtime_regression
    PRIVATE
        NativeWeb::Core
)

target_include_directories(nativeweb_native_object_runtime_regression
    PRIVATE
        ${PROJECT_SOURCE_DIR}/src
)

set_target_properties(nativeweb_native_object_runtime_regression PROPERTIES
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)

add_test(
    NAME core.native_object_runtime
    COMMAND nativeweb_native_object_runtime_regression
)

add_executable(nativeweb_json_codec_regression
    json_codec_regression.cpp
)

target_link_libraries(nativeweb_json_codec_regression
    PRIVATE
        NativeWeb::Core
)

target_include_directories(nativeweb_json_codec_regression
    PRIVATE
        ${PROJECT_SOURCE_DIR}/src
)

set_target_properties(nativeweb_json_codec_regression PROPERTIES
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)

add_test(
    NAME core.json_codec
    COMMAND nativeweb_json_codec_regression
)


add_executable(nativeweb_worker_pool_regression
    worker_pool_regression.cpp
)

target_link_libraries(nativeweb_worker_pool_regression
    PRIVATE
        NativeWeb::Core
)

target_include_directories(nativeweb_worker_pool_regression
    PRIVATE
        ${PROJECT_SOURCE_DIR}/src
)

set_target_properties(nativeweb_worker_pool_regression PROPERTIES
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)

add_test(
    NAME core.worker_pool
    COMMAND nativeweb_worker_pool_regression
)


add_executable(nativeweb_bridge_async_regression
    bridge_async_regression.cpp
)

target_link_libraries(nativeweb_bridge_async_regression
    PRIVATE
        NativeWeb::Core
)

target_include_directories(nativeweb_bridge_async_regression
    PRIVATE
        ${PROJECT_SOURCE_DIR}/src
)

set_target_properties(nativeweb_bridge_async_regression PROPERTIES
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)

add_test(
    NAME core.bridge_async
    COMMAND nativeweb_bridge_async_regression
)


add_executable(nativeweb_callable_regression
    callable_regression.cpp
)

target_link_libraries(nativeweb_callable_regression PRIVATE NativeWeb::Core)
target_include_directories(nativeweb_callable_regression PRIVATE ${PROJECT_SOURCE_DIR}/src)
set_target_properties(nativeweb_callable_regression PROPERTIES
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)
add_test(NAME core.callable COMMAND nativeweb_callable_regression)

add_executable(nativeweb_binding_registry_regression
    binding_registry_regression.cpp
)

target_link_libraries(nativeweb_binding_registry_regression PRIVATE NativeWeb::Core)
target_include_directories(nativeweb_binding_registry_regression PRIVATE ${PROJECT_SOURCE_DIR}/src)
set_target_properties(nativeweb_binding_registry_regression PROPERTIES
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)
add_test(NAME core.binding_registry COMMAND nativeweb_binding_registry_regression)
