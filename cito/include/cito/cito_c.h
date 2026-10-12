#ifndef CITO_CITO_C_H
#define CITO_CITO_C_H
#include <stddef.h>
#include <stdint.h>
#if defined(_WIN32)
#  if defined(CITO_C_BUILD)
#    define CITO_C_API __declspec(dllexport)
#  else
#    define CITO_C_API __declspec(dllimport)
#  endif
#else
#  define CITO_C_API __attribute__((visibility("default")))
#endif
#ifdef __cplusplus
extern "C" {
#endif
#define CITO_C_ABI_VERSION 1u
typedef struct cito_context cito_context_t;
typedef struct cito_subscription cito_subscription_t;
typedef enum cito_status {
    CITO_STATUS_OK = 0,
    CITO_STATUS_INVALID_ARGUMENT = 1,
    CITO_STATUS_OUT_OF_MEMORY = 2,
    CITO_STATUS_INTERNAL_ERROR = 3
} cito_status_t;
typedef void (*cito_message_callback_t)(
    void* user_data, uint64_t type_id,
    const char* resource, size_t resource_size,
    const uint8_t* payload, size_t payload_size);
CITO_C_API uint32_t cito_abi_version(void);
CITO_C_API cito_status_t cito_context_create(
    const char* scope, size_t scope_size, cito_context_t** out_context);
CITO_C_API void cito_context_destroy(cito_context_t* context);
CITO_C_API cito_status_t cito_context_subscribe(
    cito_context_t* context, uint64_t type_id,
    const char* resource, size_t resource_size,
    cito_message_callback_t callback, void* user_data,
    cito_subscription_t** out_subscription);
CITO_C_API void cito_subscription_destroy(cito_subscription_t* subscription);
CITO_C_API cito_status_t cito_context_publish(
    cito_context_t* context, uint64_t type_id,
    const char* resource, size_t resource_size,
    const uint8_t* payload, size_t payload_size,
    size_t* out_delivered);
CITO_C_API cito_status_t cito_context_run(cito_context_t* context);
CITO_C_API const char* cito_status_string(cito_status_t status);
#ifdef __cplusplus
}
#endif
#endif
