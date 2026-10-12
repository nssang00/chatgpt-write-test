#ifndef NATIVEWEB_PLUGIN_HPP_INCLUDED
#define NATIVEWEB_PLUGIN_HPP_INCLUDED

#include "nativeweb/detail/bind.hpp"
#include "nativeweb/error.hpp"
#include "nativeweb/plugin_abi.h"

#include <cstring>
#include <cstddef>
#include <exception>
#include <limits>
#include <memory>
#include <string>
#include <vector>

namespace nativeweb {

class PluginApi;

class Plugin
{
public:
    virtual ~Plugin()
    {
    }

    virtual void registerApi(
        PluginApi& api) = 0;

    virtual std::string version() const
    {
        return std::string();
    }
};

namespace detail {

class PluginBindingBase
{
public:
    virtual ~PluginBindingBase()
    {
    }
};

inline std::string copyPluginStringView(
    const nw_string_view_v1& value)
{
    if (!value.data || value.size == 0)
        return std::string();

    if (
        value.size >
        static_cast<uint64_t>(
            std::numeric_limits<std::size_t>::max()))
    {
        throw Error(
            "plugin_invalid_value",
            "Plugin string input is too large");
    }

    return std::string(
        value.data,
        value.data +
            static_cast<std::size_t>(
                value.size));
}

inline Any pluginInputValueToAny(
    const nw_value_v1& value)
{
    if (
        value.struct_size <
        sizeof(nw_value_v1))
    {
        throw Error(
            "plugin_invalid_value",
            "Plugin input value structure is invalid");
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
            copyPluginStringView(
                value.data.string_value));

    case NW_VALUE_BINARY_V1:
    {
        Binary bytes;

        if (
            value.data.binary_value.data &&
            value.data.binary_value.size)
        {
            if (
                value.data.binary_value.size >
                static_cast<uint64_t>(
                    std::numeric_limits<std::size_t>::max()))
            {
                throw Error(
                    "plugin_invalid_value",
                    "Plugin binary input is too large");
            }

            const std::size_t size =
                static_cast<std::size_t>(
                    value.data.binary_value.size);

            bytes.assign(
                value.data.binary_value.data,
                value.data.binary_value.data +
                    size);
        }

        return Any(bytes);
    }

    default:
        throw Error(
            "plugin_invalid_value",
            "Plugin input value type is not supported");
    }
}

struct PluginThreadStorage
{
    std::string resultString;
    Binary resultBinary;
    std::string errorCode;
    std::string errorMessage;

    void reset()
    {
        resultString.clear();
        resultBinary.clear();
        errorCode.clear();
        errorMessage.clear();
    }
};

inline PluginThreadStorage& pluginThreadStorage()
{
    static thread_local PluginThreadStorage storage;
    return storage;
}

inline void setPluginStringView(
    nw_string_view_v1* output,
    const std::string& value)
{
    output->data =
        value.empty()
            ? 0
            : value.data();

    output->size =
        static_cast<uint64_t>(
            value.size());
}

inline void anyToPluginOutputValue(
    const Any& value,
    nw_value_v1* output,
    PluginThreadStorage& storage)
{
    if (!output)
    {
        throw Error(
            "plugin_invalid_value",
            "Plugin output value pointer is null");
    }

    std::memset(
        output,
        0,
        sizeof(*output));

    output->struct_size =
        static_cast<uint32_t>(
            sizeof(*output));

    if (value.empty())
    {
        output->type =
            NW_VALUE_NULL_V1;
        return;
    }

    if (value.type() == typeid(bool))
    {
        output->type =
            NW_VALUE_BOOL_V1;

        output->data.boolean_value =
            AnyCast<bool>(value)
                ? 1u
                : 0u;

        return;
    }

    if (value.type() == typeid(int))
    {
        output->type =
            NW_VALUE_INT32_V1;

        output->data.int32_value =
            static_cast<int32_t>(
                AnyCast<int>(value));

        return;
    }

    if (value.type() == typeid(double))
    {
        output->type =
            NW_VALUE_DOUBLE_V1;

        output->data.double_value =
            AnyCast<double>(value);

        return;
    }

    if (value.type() == typeid(std::string))
    {
        storage.resultString =
            AnyCast<std::string>(
                value);

        output->type =
            NW_VALUE_STRING_V1;

        setPluginStringView(
            &output->data.string_value,
            storage.resultString);

        return;
    }

    if (value.type() == typeid(Binary))
    {
        storage.resultBinary =
            AnyCast<Binary>(
                value);

        output->type =
            NW_VALUE_BINARY_V1;

        output->data.binary_value.data =
            storage.resultBinary.empty()
                ? 0
                : &storage.resultBinary[0];

        output->data.binary_value.size =
            static_cast<uint64_t>(
                storage.resultBinary.size());

        return;
    }

    throw Error(
        "plugin_value_unsupported",
        "C++ plugin wrapper cannot return this type through ABI v1");
}

inline void setPluginError(
    nw_error_v1* error,
    const std::string& code,
    const std::string& message,
    PluginThreadStorage& storage)
{
    if (!error)
        return;

    storage.errorCode = code;
    storage.errorMessage = message;

    std::memset(
        error,
        0,
        sizeof(*error));

    error->struct_size =
        static_cast<uint32_t>(
            sizeof(*error));

    setPluginStringView(
        &error->code,
        storage.errorCode);

    setPluginStringView(
        &error->message,
        storage.errorMessage);
}

class PluginBinding :
    public PluginBindingBase
{
public:
    explicit PluginBinding(
        const Callable& callable)
        : callable_(callable)
    {
    }

    static int32_t invokeThunk(
        void* userData,
        const nw_value_v1* args,
        uint64_t argc,
        nw_value_v1* result,
        nw_error_v1* error)
    {
        if (!userData)
            return -1;

        return static_cast<PluginBinding*>(
            userData)->invoke(
                args,
                argc,
                result,
                error);
    }

private:
    int32_t invoke(
        const nw_value_v1* args,
        uint64_t argc,
        nw_value_v1* result,
        nw_error_v1* error)
    {
        PluginThreadStorage& storage =
            pluginThreadStorage();

        storage.reset();

        try
        {
            if (argc != 0 && !args)
            {
                throw Error(
                    "plugin_invalid_value",
                    "Plugin argument array is null");
            }

            if (
                argc >
                static_cast<uint64_t>(
                    std::numeric_limits<std::size_t>::max()))
            {
                throw Error(
                    "plugin_invalid_value",
                    "Plugin argument count is too large");
            }

            VariantList values;
            values.reserve(
                static_cast<std::size_t>(
                    argc));

            for (
                uint64_t i = 0;
                i < argc;
                ++i)
            {
                values.push_back(
                    pluginInputValueToAny(
                        args[i]));
            }

            const Any value =
                callable_.invoke(
                    values);

            anyToPluginOutputValue(
                value,
                result,
                storage);

            return 0;
        }
        catch (const Error& nativeError)
        {
            setPluginError(
                error,
                nativeError.code(),
                nativeError.what(),
                storage);

            return -1;
        }
        catch (const std::exception& exception)
        {
            setPluginError(
                error,
                "plugin_exception",
                exception.what(),
                storage);

            return -1;
        }
        catch (...)
        {
            setPluginError(
                error,
                "plugin_exception",
                "Unknown C++ plugin exception",
                storage);

            return -1;
        }
    }

    Callable callable_;
};

template <typename PluginType>
class PluginExportContext;

} // namespace detail

class PluginApi
{
public:
    template <typename CallableValue>
    void bind(
        const std::string& relativeName,
        CallableValue callable)
    {
        registerCallable(
            relativeName,
            detail::makeCallable(
                callable));
    }

private:
    PluginApi(
        const nw_host_api_v1* host,
        std::vector<
            std::unique_ptr<
                detail::PluginBindingBase> >* bindings)
        : host_(host),
          bindings_(bindings)
    {
        if (
            !host_ ||
            host_->struct_size <
                offsetof(nw_host_api_v1, register_function) +
                    sizeof(host_->register_function) ||
            host_->abi_version !=
                NATIVEWEB_PLUGIN_ABI_V1 ||
            !host_->register_function ||
            !bindings_)
        {
            throw Error(
                "plugin_invalid_host",
                "NativeWeb plugin host API is invalid");
        }
    }

    void registerCallable(
        const std::string& relativeName,
        const detail::Callable& callable)
    {
        if (
            relativeName.empty() ||
            relativeName.find('.') !=
                std::string::npos)
        {
            throw Error(
                "plugin_invalid_method",
                "Plugin method name must be a non-empty relative name");
        }

        std::unique_ptr<detail::PluginBinding> binding(
            new detail::PluginBinding(
                callable));

        const int32_t status =
            host_->register_function(
                host_->host_context,
                relativeName.c_str(),
                &detail::PluginBinding::invokeThunk,
                binding.get());

        if (status != 0)
        {
            throw Error(
                "plugin_register_failed",
                "NativeWeb host rejected plugin method: " +
                    relativeName);
        }

        bindings_->push_back(
            std::unique_ptr<
                detail::PluginBindingBase>(
                    binding.release()));
    }

    const nw_host_api_v1* host_;
    std::vector<
        std::unique_ptr<
            detail::PluginBindingBase> >* bindings_;

    template <typename PluginType>
    friend class detail::PluginExportContext;
};

namespace detail {

template <typename PluginType>
class PluginExportContext
{
public:
    explicit PluginExportContext(
        const char* id)
        : id_(id ? id : ""),
          version_(plugin_.version())
    {
        if (id_.empty())
        {
            throw Error(
                "plugin_invalid_id",
                "NativeWeb plugin id cannot be empty");
        }
    }

    static int32_t registerApiThunk(
        void* pluginContext,
        const nw_host_api_v1* host)
    {
        if (!pluginContext)
            return -1;

        try
        {
            PluginExportContext* context =
                static_cast<PluginExportContext*>(
                    pluginContext);

            PluginApi api(
                host,
                &context->bindings_);

            context->plugin_.registerApi(
                api);

            return 0;
        }
        catch (...)
        {
            return -1;
        }
    }

    static void shutdownThunk(
        void* pluginContext)
    {
        delete static_cast<
            PluginExportContext*>(
                pluginContext);
    }

    const std::string& id() const
    {
        return id_;
    }

    const std::string& version() const
    {
        return version_;
    }

private:
    PluginType plugin_;
    std::string id_;
    std::string version_;
    std::vector<
        std::unique_ptr<
            PluginBindingBase> > bindings_;
};

template <typename PluginType>
int32_t initializeCppPlugin(
    const char* id,
    nw_plugin_api_v1* output)
{
    if (!output)
        return -1;

    try
    {
        std::unique_ptr<
            PluginExportContext<PluginType> > context(
                new PluginExportContext<PluginType>(
                    id));

        std::memset(
            output,
            0,
            sizeof(*output));

        output->struct_size =
            static_cast<uint32_t>(
                sizeof(*output));

        output->abi_version =
            NATIVEWEB_PLUGIN_ABI_V1;

        output->id =
            context->id().c_str();

        output->version =
            context->version().c_str();

        output->plugin_context =
            context.get();

        output->register_api =
            &PluginExportContext<
                PluginType>::registerApiThunk;

        output->shutdown =
            &PluginExportContext<
                PluginType>::shutdownThunk;

        context.release();
        return 0;
    }
    catch (...)
    {
        return -1;
    }
}

} // namespace detail
} // namespace nativeweb

#if defined(_WIN32)
#  define NATIVEWEB_PLUGIN_EXPORT extern "C" __declspec(dllexport)
#else
#  define NATIVEWEB_PLUGIN_EXPORT extern "C" __attribute__((visibility("default")))
#endif

#define NATIVEWEB_PLUGIN(PluginType, PluginId)                    \
    NATIVEWEB_PLUGIN_EXPORT                                      \
    int32_t nativeweb_plugin_init_v1(                             \
        nw_plugin_api_v1* plugin)                                 \
    {                                                             \
        return ::nativeweb::detail::initializeCppPlugin<PluginType>( \
            PluginId,                                             \
            plugin);                                              \
    }

#endif
