#include <cito/cito_c.h>

#include <cito/detail/embedded_host_runtime.hpp>
#include <cito/detail/raw_context.hpp>
#include <cito/identity.hpp>

#include <memory>
#include <new>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>

namespace {

bool valid_bytes(
    const void* data,
    size_t size) noexcept {
    return
        size == 0 ||
        data != nullptr;
}

std::string copy_text(
    const char* data,
    size_t size) {
    return
        size == 0
            ? std::string{}
            : std::string(
                data,
                size);
}

struct ContextState {
    explicit ContextState(
        std::string scope)
        : scope_(std::move(scope)),
          scope_id_(
              cito::stable_name_id(
                  scope_)),
          runtime_(
              cito::detail::
                  acquire_embedded_host_runtime()),
          app_id_(
              runtime_->allocate_app_id()),
          local_(scope_) {
        const auto registered =
            runtime_->host().register_app(
                app_id_,
                [this](
                    cito::TypeId type_id,
                    std::string_view resource,
                    std::span<
                        const std::uint8_t>
                        payload) {
                    return local_.publish(
                        type_id,
                        resource,
                        payload);
                });

        if (!registered) {
            throw std::logic_error(
                "Cito C ABI app registration failed");
        }
    }

    ~ContextState() {
        runtime_->host().unregister_app(
            app_id_);
    }

    cito::detail::HostRuntimeCore&
    host() noexcept {
        return runtime_->host();
    }

    cito::InterestKey key(
        cito::TypeId type_id,
        std::string_view resource) const noexcept {
        return {
            scope_id_,
            cito::stable_name_id(
                resource),
            type_id};
    }

    std::string scope_;
    cito::ScopeId scope_id_{};
    std::shared_ptr<
        cito::detail::EmbeddedHostRuntime>
        runtime_;
    cito::detail::AppId app_id_{};
    cito::detail::RawContext local_;
};

} // namespace

struct cito_context {
    explicit cito_context(
        std::string scope)
        : state(
              std::make_shared<
                  ContextState>(
                  std::move(scope))) {}

    std::shared_ptr<
        ContextState> state;
};

struct cito_subscription {
    cito_subscription(
        cito::detail::RawSubscription local,
        std::weak_ptr<ContextState> state,
        cito::InterestKey key)
        : local(std::move(local)),
          state(std::move(state)),
          key(key) {}

    ~cito_subscription() {
        close();
    }

    void close() noexcept {
        if (!active) {
            return;
        }

        active = false;
        local.close();

        if (const auto locked =
                state.lock()) {
            locked->host_
                .remove_interest(
                    context->state->app_id_,
                    key);
        }
    }

    cito::detail::RawSubscription local;
    std::weak_ptr<ContextState> state;
    cito::InterestKey key{};
    bool active{true};
};

extern "C" {

uint32_t cito_abi_version(void) {
    return CITO_C_ABI_VERSION;
}

cito_status_t cito_context_create(
    const char* scope,
    size_t scope_size,
    cito_context_t** out) {
    if (
        !out ||
        !valid_bytes(
            scope,
            scope_size)) {
        return
            CITO_STATUS_INVALID_ARGUMENT;
    }

    *out = nullptr;

    try {
        *out = new cito_context(
            copy_text(
                scope,
                scope_size));

        return CITO_STATUS_OK;
    } catch (
        const std::bad_alloc&) {
        return
            CITO_STATUS_OUT_OF_MEMORY;
    } catch (...) {
        return
            CITO_STATUS_INTERNAL_ERROR;
    }
}

void cito_context_destroy(
    cito_context_t* context) {
    delete context;
}

cito_status_t cito_context_subscribe(
    cito_context_t* context,
    uint64_t type_id,
    const char* resource,
    size_t resource_size,
    cito_message_callback_t callback,
    void* user_data,
    cito_subscription_t** out) {
    if (
        !context ||
        !callback ||
        !out ||
        !valid_bytes(
            resource,
            resource_size)) {
        return
            CITO_STATUS_INVALID_ARGUMENT;
    }

    *out = nullptr;

    try {
        auto text =
            copy_text(
                resource,
                resource_size);

        const auto key =
            context->state->key(
                type_id,
                text);

        auto local =
            context->state->local_.on(
                type_id,
                text,
                [callback, user_data](
                    std::uint64_t id,
                    std::string_view name,
                    std::span<
                        const std::uint8_t>
                        payload) {
                    callback(
                        user_data,
                        id,
                        name.data(),
                        name.size(),
                        payload.data(),
                        payload.size());
                });

        const auto interest =
            context->state->host()
                .add_interest(
                    context->state->app_id_,
                    key);

        if (!interest.changed) {
            return
                CITO_STATUS_INTERNAL_ERROR;
        }

        try {
            *out =
                new cito_subscription(
                    std::move(local),
                    context->state,
                    key);
        } catch (...) {
            context->state->host()
                .remove_interest(
                    context->state->app_id_,
                    key);
            throw;
        }

        return CITO_STATUS_OK;
    } catch (
        const std::bad_alloc&) {
        return
            CITO_STATUS_OUT_OF_MEMORY;
    } catch (...) {
        return
            CITO_STATUS_INTERNAL_ERROR;
    }
}

void cito_subscription_destroy(
    cito_subscription_t* subscription) {
    delete subscription;
}

cito_status_t cito_context_has_demand(
    cito_context_t* context,
    uint64_t type_id,
    const char* resource,
    size_t resource_size,
    int* out_has_demand) {
    if (
        !context ||
        !out_has_demand ||
        !valid_bytes(
            resource,
            resource_size)) {
        return
            CITO_STATUS_INVALID_ARGUMENT;
    }

    try {
        const auto resource_view =
            resource_size == 0
                ? std::string_view{}
                : std::string_view(
                    resource,
                    resource_size);

        *out_has_demand =
            context->state->host()
                .has_demand(
                    context->state->key(
                        type_id,
                        resource_view))
                ? 1
                : 0;

        return CITO_STATUS_OK;
    } catch (...) {
        return
            CITO_STATUS_INTERNAL_ERROR;
    }
}

cito_status_t cito_context_publish(
    cito_context_t* context,
    uint64_t type_id,
    const char* resource,
    size_t resource_size,
    const uint8_t* payload,
    size_t payload_size,
    size_t* out_delivered) {
    if (
        !context ||
        !valid_bytes(
            resource,
            resource_size) ||
        !valid_bytes(
            payload,
            payload_size)) {
        return
            CITO_STATUS_INVALID_ARGUMENT;
    }

    try {
        const auto resource_view =
            resource_size == 0
                ? std::string_view{}
                : std::string_view(
                    resource,
                    resource_size);

        const auto payload_view =
            payload_size == 0
                ? std::span<
                    const std::uint8_t>{}
                : std::span<
                    const std::uint8_t>(
                    payload,
                    payload_size);

        const auto result =
            context->state->host().publish(
                context->state->key(
                    type_id,
                    resource_view),
                resource_view,
                payload_view,
                [](
                    cito::DestinationId,
                    std::span<
                        const std::uint8_t>) {
                    return false;
                });

        if (out_delivered) {
            *out_delivered =
                result.delivered();
        }

        return CITO_STATUS_OK;
    } catch (...) {
        return
            CITO_STATUS_INTERNAL_ERROR;
    }
}

cito_status_t cito_context_run(
    cito_context_t* context) {
    if (!context) {
        return
            CITO_STATUS_INVALID_ARGUMENT;
    }

    context->state->local_.run();
    return CITO_STATUS_OK;
}

const char* cito_status_string(
    cito_status_t status) {
    switch (status) {
        case CITO_STATUS_OK:
            return "ok";
        case CITO_STATUS_INVALID_ARGUMENT:
            return "invalid argument";
        case CITO_STATUS_OUT_OF_MEMORY:
            return "out of memory";
        case CITO_STATUS_INTERNAL_ERROR:
            return "internal error";
    }

    return "unknown";
}

} // extern "C"
