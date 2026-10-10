#include "core/binding_registry.hpp"
#include "nativeweb/error.hpp"
#include "plugin/plugin_module.hpp"

#include <iostream>
#include <string>

namespace {

int failures = 0;

void fail(
    const char* expression,
    const char* file,
    int line)
{
    std::cerr
        << file << ":" << line
        << ": CHECK failed: "
        << expression
        << std::endl;
    ++failures;
}

#define CHECK(expr) \
    do { if (!(expr)) fail(#expr, __FILE__, __LINE__); } while (0)

void testLoadRegisterCallAndLifetime(
    const std::string& pluginPath)
{
    nativeweb::detail::BindingRegistry registry;
    nativeweb::detail::Callable retained;

    {
        nativeweb::detail::PluginModule module(
            pluginPath,
            registry);

        CHECK(module.id() == "sample");
        CHECK(module.version() == "1.0.0");
        CHECK(module.registrationCount() == 2u);

        CHECK(registry.has("sample.add"));
        CHECK(registry.has("sample.fail"));

        VariantList args;
        args.push_back(Any(20));
        args.push_back(Any(22));

        CHECK(
            AnyCast<int>(
                registry.find(
                    "sample.add").invoke(args)) ==
            42);

        bool rejected = false;

        try
        {
            (void)registry.find(
                "sample.fail").invoke(
                    VariantList());
        }
        catch (const nativeweb::Error& error)
        {
            rejected = true;
            CHECK(error.code() == "sample_error");
            CHECK(
                std::string(error.what()) ==
                "expected plugin failure");
        }

        CHECK(rejected);

        retained =
            registry.find(
                "sample.add");
    }

    CHECK(!registry.has("sample.add"));
    CHECK(!registry.has("sample.fail"));

    // The registration owner is gone, but a previously copied callable keeps
    // the PluginLibraryLease alive so its function pointer remains valid.
    VariantList args;
    args.push_back(Any(40));
    args.push_back(Any(2));

    CHECK(
        AnyCast<int>(
            retained.invoke(args)) ==
        42);
}

void testAbiMismatch(
    const std::string& badPluginPath)
{
    nativeweb::detail::BindingRegistry registry;

    bool rejected = false;

    try
    {
        nativeweb::detail::PluginModule module(
            badPluginPath,
            registry);
    }
    catch (const nativeweb::Error& error)
    {
        rejected = true;
        CHECK(
            error.code() ==
            "plugin_abi_mismatch");
    }

    CHECK(rejected);
    CHECK(registry.size() == 0u);
}

void testMissingEntryPoint(
    const std::string& plainLibraryPath)
{
    nativeweb::detail::BindingRegistry registry;

    bool rejected = false;

    try
    {
        nativeweb::detail::PluginModule module(
            plainLibraryPath,
            registry);
    }
    catch (const nativeweb::Error& error)
    {
        rejected = true;
        CHECK(
            error.code() ==
            "shared_library_symbol_not_found");
    }

    CHECK(rejected);
    CHECK(registry.size() == 0u);
}

} // namespace

int main(
    int argc,
    char* argv[])
{
    if (argc != 4)
    {
        std::cerr
            << "Expected valid plugin, bad ABI plugin and plain library paths"
            << std::endl;
        return 2;
    }

    testLoadRegisterCallAndLifetime(
        argv[1]);

    testAbiMismatch(
        argv[2]);

    testMissingEntryPoint(
        argv[3]);

    if (failures)
    {
        std::cerr
            << "PluginModule regression failed: "
            << failures
            << std::endl;
        return 1;
    }

    std::cout
        << "PluginModule regression: PASS"
        << std::endl;

    return 0;
}
