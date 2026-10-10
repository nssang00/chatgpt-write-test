#ifndef NATIVEWEB_PLUGIN_ABI_H_INCLUDED
#define NATIVEWEB_PLUGIN_ABI_H_INCLUDED

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define NATIVEWEB_PLUGIN_ABI_V1 1u
#define NATIVEWEB_PLUGIN_INIT_SYMBOL_V1 "nativeweb_plugin_init_v1"

typedef struct nw_string_view_v1
{
    const char* data;
    uint64_t size;
} nw_string_view_v1;

typedef struct nw_binary_view_v1
{
    const uint8_t* data;
    uint64_t size;
} nw_binary_view_v1;

typedef enum nw_value_type_v1
{
    NW_VALUE_NULL_V1 = 0,
    NW_VALUE_BOOL_V1 = 1,
    NW_VALUE_INT32_V1 = 2,
    NW_VALUE_DOUBLE_V1 = 3,
    NW_VALUE_STRING_V1 = 4,
    NW_VALUE_BINARY_V1 = 5
} nw_value_type_v1;

typedef struct nw_value_v1
{
    uint32_t struct_size;
    uint32_t type;

    union
    {
        uint8_t boolean_value;
        int32_t int32_value;
        double double_value;
        nw_string_view_v1 string_value;
        nw_binary_view_v1 binary_value;
    } data;
} nw_value_v1;

typedef struct nw_error_v1
{
    uint32_t struct_size;
    nw_string_view_v1 code;
    nw_string_view_v1 message;
} nw_error_v1;

/*
 * Input views are valid only for the duration of the call.
 * Output string/binary/error views must remain valid until the callback
 * returns. NativeWeb copies output data before returning to plugin code.
 */
typedef int32_t (*nw_plugin_call_v1)(
    void* user_data,
    const nw_value_v1* args,
    uint64_t argc,
    nw_value_v1* result,
    nw_error_v1* error);

typedef int32_t (*nw_host_register_function_v1)(
    void* host_context,
    const char* relative_name,
    nw_plugin_call_v1 function,
    void* user_data);

typedef struct nw_host_api_v1
{
    uint32_t struct_size;
    uint32_t abi_version;
    void* host_context;
    nw_host_register_function_v1 register_function;
} nw_host_api_v1;

typedef int32_t (*nw_plugin_register_api_v1)(
    void* plugin_context,
    const nw_host_api_v1* host);

typedef void (*nw_plugin_shutdown_v1)(
    void* plugin_context);

typedef struct nw_plugin_api_v1
{
    uint32_t struct_size;
    uint32_t abi_version;

    const char* id;
    const char* version;

    void* plugin_context;
    nw_plugin_register_api_v1 register_api;
    nw_plugin_shutdown_v1 shutdown;
} nw_plugin_api_v1;

/*
 * The single well-known exported symbol for ABI v1.
 * The plugin fills nw_plugin_api_v1; the host validates it before invoking
 * register_api.
 */
typedef int32_t (*nw_plugin_init_v1)(
    nw_plugin_api_v1* plugin);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif
