#include "plugin/plugin_module.hpp"

#include "nativeweb/error.hpp"
#include "nativeweb/plugin_abi.h"
#include "plugin/shared_library.hpp"

#include <cstring>
#include <limits>
#include <memory>
#include <sstream>

namespace nativeweb {
namespace detail {

namespace {

std::string copyString(
    const nw_string_view_v1& value)
{
    if (!value.data || value.size == 0)
        return std::string();

    return std::string(
        value.data,
        value.data +
            static_cast<std::size_t>(
                value.size));
}

nw_value_v1 anyToPluginValue(
    const Any& value,
    std::string* stringStorage,
    Binary* binaryStorage)
{
    nw_value_v1 output;
    std::memset(
        &output,
        0,
        sizeof(output));

    output.struct_size =
        static_cast<uint32_t>(
            sizeof(output));

    if (value.empty())
    {
        output.type =
            NW_VALUE_NULL_V1;
        return output;
    }

    if (value.type() == typeid(bool))
    {
        output.type =
            NW_VALUE_BOOL_V1;

        output.data.boolean_value =
            AnyCast<bool>(value)
                ? 1u
                : 0u;

        return output;
    }

    if (value.type() == typeid(int))
    {
        output.type =
            NW_VALUE_INT32_V1;

        output.data.int32_value =
            static_cast<int32_t>(
                AnyCast<int>(value));

        return output;
    }

    if (value.type() == typeid(double))
    {
        output.type =
            NW_VALUE_DOUBLE_V1;

        output.data.double_value =
            AnyCast<double>(value);

        return output;
    }

    if (value.type() == typeid(std::string))
    {
        *stringStorage =
            AnyCast<std::string>(value);

        output.type =
            NW_VALUE_STRING_V1;

        output.data.string_value.data =
            stringStorage->data();

        output.data.string_value.size =
            static_cast<uint64_t>(
                stringStorage->size());

        return output;
    }

    if (value.type() == typeid(Binary))
    {
        *binaryStorage =
            AnyCast<Binary>(value);

        output.type =
            NW_VALUE_BINARY_V1;

        output.data.binary_value.data =
            binaryStorage->empty()
                ? 0
                : &(*binaryStorage)[0];

        output.data.binary_value.size =
            static_cast<uint64_t>(
                binaryStorage->size());

        return output;
    }

    throw Error(
        "plugin_value_unsupported",
        "NativeWeb plugin ABI v1 does not support this argument type yet");
}

Any pluginValueToAny(
    const nw_value_v1& value)
{
    if (
        value.struct_size <
        sizeof(nw_value_v1))
    {
        throw Error(
            "plugin_invalid_value",
            "Plugin returned an invalid nw_value_v1 structure");
    }

    switch (value.type)
    {
    case NW_VALUE_NULL_V1:
        return Any();

    case NW_VALUE_BOOL_V1:
        return Any(
            value.data.boolean_value != 0);

    case NW_VALUE_INT32_V1:
        return Any(
            static_cast<int>(
                value.data.int32_value));

    case NW_VALUE_DOUBLE_V1:
        return Any(
            value.data.double_value);

    case NW_VALUE_STRING_V1:
        return Any(
            copyString(
                value.data.string_value));

    case NW_VALUE_BINARY_V1:
    {
        Binary bytes;

        if (
            value.data.binary_value.data &&
            value.data.binary_value.size)
        {
            const uint64_t size =
                value.data.binary_value.size;

            if (
                size >
                static_cast<uint64_t>(
                    std::numeric_limits<std::size_t>::max()))
            {
                throw Error(
                    "plugin_invalid_value",
                    "Plugin binary result is too large for this process");
            }

            bytes.assign(
                value.data.binary_value.data,
                value.data.binary_value.data +
                    static_cast<std::size_t>(size));
        }

        return Any(bytes);
    }

    default:
        throw Error(
            "plugin_invalid_value",
            "Plugin returned an unknown value type");
    }
}

Callable makePluginCallable(
    nw_plugin_call_v1 function,
    void* userData,
    const std::shared_ptr<void>& lifetime)
{
    const DynamicFunction dynamic =
        [function, userData](
            const VariantList& args)
            -> Any
        {
            std::vector<nw_value_v1> pluginArgs(
                args.size());

            std::vector<std::string> strings(
                args.size());

            std::vector<Binary> binaries(
                args.size());

            for (
                std::size_t i = 0;
                i < args.size();
                ++i)
            {
                pluginArgs[i] =
                    anyToPluginValue(
                        args[i],
                        &strings[i],
                        &binaries[i]);
            }

            nw_value_v1 result;
            std::memset(
                &result,
                0,
                sizeof(result));
            result.struct_size =
                static_cast<uint32_t>(
                    sizeof(result));
            result.type =
                NW_VALUE_NULL_V1;

            nw_error_v1 error;
            std::memset(
                &error,
                0,
                sizeof(error));
            error.struct_size =
                static_cast<uint32_t>(
                    sizeof(error));

            const int32_t status =
                function(
                    userData,
                    pluginArgs.empty()
                        ? 0
                        : &pluginArgs[0],
                    static_cast<uint64_t>(
                        pluginArgs.size()),
                    &result,
                    &error);

            if (status != 0)
            {
                std::string code =
                    copyString(error.code);

                std::string message =
                    copyString(error.message);

                if (code.empty())
                    code = "plugin_call_failed";

                if (message.empty())
                    message = "Plugin call failed";

                throw Error(
                    code,
                    message);
            }

            return pluginValueToAny(
                result);
        };

    CallableSignature signature;

    return Callable(
        dynamic,
        signature,
        lifetime);
}

bool validPluginId(
    const std::string& id)
{
    if (id.empty())
        return false;

    for (
        std::size_t i = 0;
        i < id.size();
        ++i)
    {
        const char ch = id[i];

        const bool ok =
            (ch >= 'a' && ch <= 'z') ||
            (ch >= 'A' && ch <= 'Z') ||
            (ch >= '0' && ch <= '9') ||
            ch == '_' ||
            ch == '-';

        if (!ok)
            return false;
    }

    return true;
}

} // namespace

class PluginLibraryLease
{
public:
    explicit PluginLibraryLease(
        const std::string& path)
        : library(path)
    {
        std::memset(
            &api,
            0,
            sizeof(api));

        api.struct_size =
            static_cast<uint32_t>(
                sizeof(api));
    }

    ~PluginLibraryLease()
    {
        if (api.shutdown)
            api.shutdown(
                api.plugin_context);
    }

    SharedLibrary library;
    nw_plugin_api_v1 api;
};

PluginModule::PluginModule(
    const std::string& path,
    BindingRegistry& registry)
    : registry_(registry),
      lease_(new PluginLibraryLease(path))
{
    initialize();
}

PluginModule::~PluginModule()
{
    // Tokens unregister public entry points first. Callable copies already
    // queued/running retain PluginLibraryLease and therefore the DLL/SO.
    registrations_.clear();
    lease_.reset();
}

const std::string& PluginModule::id() const
{
    return id_;
}

const std::string& PluginModule::version() const
{
    return version_;
}

const std::string& PluginModule::path() const
{
    return lease_->library.path();
}

std::size_t PluginModule::registrationCount() const
{
    return registrations_.size();
}

void PluginModule::initialize()
{
    void* symbol =
        lease_->library.symbol(
            NATIVEWEB_PLUGIN_INIT_SYMBOL_V1);

    nw_plugin_init_v1 init =
        reinterpret_cast<nw_plugin_init_v1>(
            symbol);

    const int32_t initStatus =
        init(&lease_->api);

    if (initStatus != 0)
    {
        throw Error(
            "plugin_init_failed",
            "Plugin initialization failed");
    }

    if (
        lease_->api.struct_size <
        sizeof(nw_plugin_api_v1))
    {
        throw Error(
            "plugin_invalid_descriptor",
            "Plugin returned an invalid ABI descriptor");
    }

    if (
        lease_->api.abi_version !=
        NATIVEWEB_PLUGIN_ABI_V1)
    {
        throw Error(
            "plugin_abi_mismatch",
            "Plugin ABI version is not supported");
    }

    if (
        !lease_->api.id ||
        !validPluginId(
            lease_->api.id))
    {
        throw Error(
            "plugin_invalid_id",
            "Plugin id is empty or contains unsupported characters");
    }

    if (!lease_->api.register_api)
    {
        throw Error(
            "plugin_invalid_descriptor",
            "Plugin register_api callback is missing");
    }

    id_ = lease_->api.id;
    version_ =
        lease_->api.version
            ? lease_->api.version
            : std::string();

    nw_host_api_v1 host;
    std::memset(
        &host,
        0,
        sizeof(host));

    host.struct_size =
        static_cast<uint32_t>(
            sizeof(host));

    host.abi_version =
        NATIVEWEB_PLUGIN_ABI_V1;

    host.host_context = this;
    host.register_function =
        &PluginModule::registerFunctionThunk;

    const int32_t registerStatus =
        lease_->api.register_api(
            lease_->api.plugin_context,
            &host);

    if (registerStatus != 0)
    {
        throw Error(
            "plugin_register_failed",
            "Plugin API registration failed");
    }
}

int32_t PluginModule::registerFunctionThunk(
    void* hostContext,
    const char* relativeName,
    nw_plugin_call_v1 function,
    void* userData)
{
    if (!hostContext)
        return -1;

    try
    {
        return static_cast<PluginModule*>(
            hostContext)->registerFunction(
                relativeName,
                function,
                userData);
    }
    catch (...)
    {
        return -1;
    }
}

int32_t PluginModule::registerFunction(
    const char* relativeName,
    nw_plugin_call_v1 function,
    void* userData)
{
    if (
        !relativeName ||
        !*relativeName ||
        !function)
    {
        return -1;
    }

    const std::string relative(
        relativeName);

    if (
        relative.find('.') !=
        std::string::npos)
    {
        return -1;
    }

    const std::string method =
        id_ + "." + relative;

    if (registry_.has(method))
        return -1;

    const std::shared_ptr<void> lifetime(
        lease_);

    RegistrationToken token =
        registry_.registerBinding(
            method,
            makePluginCallable(
                function,
                userData,
                lifetime));

    registrations_.push_back(
        std::move(token));

    return 0;
}

} // namespace detail
} // namespace nativeweb
