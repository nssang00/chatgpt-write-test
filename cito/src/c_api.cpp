#include <cito/cito_c.h>
#include <cito/detail/raw_context.hpp>
#include <new>
#include <span>
#include <string>
#include <utility>
struct cito_context {
    explicit cito_context(std::string scope) : impl(std::move(scope)) {}
    cito::detail::RawContext impl;
};
struct cito_subscription {
    explicit cito_subscription(cito::detail::RawSubscription value)
        : impl(std::move(value)) {}
    cito::detail::RawSubscription impl;
};
namespace {
bool valid_bytes(const void* data, size_t size) noexcept {
    return size == 0 || data != nullptr;
}
std::string copy_text(const char* data, size_t size) {
    return size == 0 ? std::string{} : std::string(data, size);
}
}
extern "C" {
uint32_t cito_abi_version(void) { return CITO_C_ABI_VERSION; }
cito_status_t cito_context_create(const char* scope, size_t scope_size, cito_context_t** out) {
    if (!out || !valid_bytes(scope, scope_size)) return CITO_STATUS_INVALID_ARGUMENT;
    *out = nullptr;
    try { *out = new cito_context(copy_text(scope, scope_size)); return CITO_STATUS_OK; }
    catch (const std::bad_alloc&) { return CITO_STATUS_OUT_OF_MEMORY; }
    catch (...) { return CITO_STATUS_INTERNAL_ERROR; }
}
void cito_context_destroy(cito_context_t* context) { delete context; }
cito_status_t cito_context_subscribe(
    cito_context_t* context, uint64_t type_id, const char* resource, size_t resource_size,
    cito_message_callback_t callback, void* user_data, cito_subscription_t** out) {
    if (!context || !callback || !out || !valid_bytes(resource, resource_size))
        return CITO_STATUS_INVALID_ARGUMENT;
    *out = nullptr;
    try {
        auto sub = context->impl.on(type_id, copy_text(resource, resource_size),
            [callback, user_data](std::uint64_t id, std::string_view name,
                                  std::span<const std::uint8_t> payload) {
                callback(user_data, id, name.data(), name.size(),
                         payload.data(), payload.size());
            });
        *out = new cito_subscription(std::move(sub));
        return CITO_STATUS_OK;
    } catch (const std::bad_alloc&) { return CITO_STATUS_OUT_OF_MEMORY; }
      catch (...) { return CITO_STATUS_INTERNAL_ERROR; }
}
void cito_subscription_destroy(cito_subscription_t* subscription) { delete subscription; }
cito_status_t cito_context_publish(
    cito_context_t* context, uint64_t type_id, const char* resource, size_t resource_size,
    const uint8_t* payload, size_t payload_size, size_t* out_delivered) {
    if (!context || !valid_bytes(resource, resource_size) || !valid_bytes(payload, payload_size))
        return CITO_STATUS_INVALID_ARGUMENT;
    try {
        const auto delivered = context->impl.publish(
            type_id,
            resource_size ? std::string_view(resource, resource_size) : std::string_view{},
            payload_size ? std::span<const std::uint8_t>(payload, payload_size)
                         : std::span<const std::uint8_t>{});
        if (out_delivered) *out_delivered = delivered;
        return CITO_STATUS_OK;
    } catch (...) { return CITO_STATUS_INTERNAL_ERROR; }
}
cito_status_t cito_context_run(cito_context_t* context) {
    if (!context) return CITO_STATUS_INVALID_ARGUMENT;
    context->impl.run();
    return CITO_STATUS_OK;
}
const char* cito_status_string(cito_status_t status) {
    switch (status) {
        case CITO_STATUS_OK: return "ok";
        case CITO_STATUS_INVALID_ARGUMENT: return "invalid argument";
        case CITO_STATUS_OUT_OF_MEMORY: return "out of memory";
        case CITO_STATUS_INTERNAL_ERROR: return "internal error";
    }
    return "unknown";
}
}
