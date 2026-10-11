#include "core/binding_registry.hpp"
#include "nativeweb/error.hpp"
#include "plugin/plugin_module.hpp"
#include "core/worker_pool.hpp"

#include <chrono>
#include <exception>
#include <future>
#include <iostream>
#include <memory>
#include <string>
#include <thread>

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
        CHECK(module.registrationCount() == 4u);

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

void testQueuedTaskRetainsModuleLease(
    const std::string& pluginPath)
{
    nativeweb::detail::BindingRegistry registry;
    std::unique_ptr<nativeweb::detail::PluginModule> module(
        new nativeweb::detail::PluginModule(
            pluginPath,
            registry));

    nativeweb::detail::Callable slow =
        registry.find("sample.slow_add");

    VariantList args;
    args.push_back(Any(20));
    args.push_back(Any(22));

    nativeweb::detail::WorkerPool pool(1);

    std::promise<void> releaseBlocker;
    std::shared_future<void> blocker =
        releaseBlocker.get_future().share();

    std::promise<void> blockerStartedPromise;
    std::future<void> blockerStarted =
        blockerStartedPromise.get_future();

    CHECK(pool.post([&]() {
        blockerStartedPromise.set_value();
        blocker.wait();
    }));

    CHECK(
        blockerStarted.wait_for(
            std::chrono::seconds(3)) ==
        std::future_status::ready);

    std::promise<int> resultPromise;
    std::future<int> result =
        resultPromise.get_future();

    CHECK(pool.post(
        [slow, args, &resultPromise]() mutable {
            try
            {
                resultPromise.set_value(
                    AnyCast<int>(
                        slow.invoke(args)));
            }
            catch (...)
            {
                resultPromise.set_exception(
                    std::current_exception());
            }
        }));

    // The queued task owns the only remaining Callable copy after these
    // releases. Destroying the module must unregister methods but must not
    // unload the DLL/SO before the queued task starts.
    slow = nativeweb::detail::Callable();
    module.reset();

    CHECK(!registry.has("sample.slow_add"));

    releaseBlocker.set_value();

    CHECK(
        result.wait_for(
            std::chrono::seconds(3)) ==
        std::future_status::ready);

    CHECK(result.get() == 42);
    pool.shutdown();
}

void testRunningTaskRetainsModuleLease(
    const std::string& pluginPath)
{
    nativeweb::detail::BindingRegistry registry;
    std::unique_ptr<nativeweb::detail::PluginModule> module(
        new nativeweb::detail::PluginModule(
            pluginPath,
            registry));

    nativeweb::detail::Callable slow =
        registry.find("sample.slow_add");

    nativeweb::detail::Callable status =
        registry.find("sample.is_slow_running");

    VariantList args;
    args.push_back(Any(40));
    args.push_back(Any(2));

    nativeweb::detail::WorkerPool pool(1);

    std::promise<int> resultPromise;
    std::future<int> result =
        resultPromise.get_future();

    CHECK(pool.post(
        [slow, args, &resultPromise]() mutable {
            try
            {
                resultPromise.set_value(
                    AnyCast<int>(
                        slow.invoke(args)));
            }
            catch (...)
            {
                resultPromise.set_exception(
                    std::current_exception());
            }
        }));

    bool observedRunning = false;
    const std::chrono::steady_clock::time_point deadline =
        std::chrono::steady_clock::now() +
        std::chrono::seconds(3);

    while (
        std::chrono::steady_clock::now() <
        deadline)
    {
        if (
            AnyCast<bool>(
                status.invoke(
                    VariantList())))
        {
            observedRunning = true;
            break;
        }

        std::this_thread::sleep_for(
            std::chrono::milliseconds(5));
    }

    CHECK(observedRunning);

    // Drop all test-thread references into plugin code. The worker task's
    // captured Callable must now be the only lease keeping the library loaded.
    status = nativeweb::detail::Callable();
    slow = nativeweb::detail::Callable();
    module.reset();

    CHECK(!registry.has("sample.slow_add"));
    CHECK(!registry.has("sample.is_slow_running"));

    CHECK(
        result.wait_for(
            std::chrono::seconds(3)) ==
        std::future_status::ready);

    CHECK(result.get() == 42);
    pool.shutdown();
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

    testQueuedTaskRetainsModuleLease(
        argv[1]);

    testRunningTaskRetainsModuleLease(
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
