#ifndef NATIVEWEB_PLUGIN_MODULE_HPP_INCLUDED
#define NATIVEWEB_PLUGIN_MODULE_HPP_INCLUDED

#include "core/binding_registry.hpp"

#include <memory>
#include <string>
#include <vector>

namespace nativeweb {
namespace detail {

class PluginLibraryLease;

class PluginModule
{
public:
    PluginModule(
        const std::string& path,
        BindingRegistry& registry);

    ~PluginModule();

    PluginModule(const PluginModule&) = delete;
    PluginModule& operator=(const PluginModule&) = delete;

    const std::string& id() const;
    const std::string& version() const;
    const std::string& path() const;

    std::size_t registrationCount() const;

private:
    static int32_t registerFunctionThunk(
        void* hostContext,
        const char* relativeName,
        nw_plugin_call_v1 function,
        void* userData);

    int32_t registerFunction(
        const char* relativeName,
        nw_plugin_call_v1 function,
        void* userData);

    void initialize();

    BindingRegistry& registry_;
    std::shared_ptr<PluginLibraryLease> lease_;
    std::vector<RegistrationToken> registrations_;
    std::string id_;
    std::string version_;
};

} // namespace detail
} // namespace nativeweb

#endif
