#include "core/pending_call_registry.hpp"

#include <iostream>
#include <string>

namespace {

int failures = 0;

void fail(const char* expression, const char* file, int line)
{
    std::cerr << file << ":" << line << ": CHECK failed: "
              << expression << std::endl;
    ++failures;
}

#define CHECK(expr) do { if (!(expr)) fail(#expr, __FILE__, __LINE__); } while (0)

void testCreateAndResolve()
{
    nativeweb::detail::PendingCallRegistry registry;

    nativeweb::detail::PendingCall call = registry.create();

    CHECK(call.id != 0);
    CHECK(registry.size() == 1u);
    CHECK(registry.resolve(call.id, Any(42)));
    CHECK(registry.size() == 0u);
    CHECK(AnyCast<int>(call.result.get()) == 42);
}

void testUniqueIds()
{
    nativeweb::detail::PendingCallRegistry registry;

    nativeweb::detail::PendingCall first = registry.create();
    nativeweb::detail::PendingCall second = registry.create();

    CHECK(first.id != second.id);
    CHECK(second.id > first.id);

    CHECK(registry.resolve(first.id, Any(1)));
    CHECK(registry.resolve(second.id, Any(2)));

    CHECK(AnyCast<int>(first.result.get()) == 1);
    CHECK(AnyCast<int>(second.result.get()) == 2);
}

void testReject()
{
    nativeweb::detail::PendingCallRegistry registry;
    nativeweb::detail::PendingCall call = registry.create();

    CHECK(registry.reject(
        call.id,
        nativeweb::Error("native_failure", "native call failed")));

    bool threw = false;

    try
    {
        (void)call.result.get();
    }
    catch (const nativeweb::Error& error)
    {
        threw = true;
        CHECK(error.code() == "native_failure");
        CHECK(std::string(error.what()) == "native call failed");
    }

    CHECK(threw);
}

void testRejectAllOnDestroyContract()
{
    nativeweb::detail::PendingCallRegistry registry;

    nativeweb::detail::PendingCall first = registry.create();
    nativeweb::detail::PendingCall second = registry.create();

    registry.rejectAll(nativeweb::Error(
        "webview_destroyed",
        "WebView was destroyed before the call completed"));

    CHECK(registry.size() == 0u);

    bool firstRejected = false;
    bool secondRejected = false;

    try
    {
        (void)first.result.get();
    }
    catch (const nativeweb::Error& error)
    {
        firstRejected = true;
        CHECK(error.code() == "webview_destroyed");
    }

    try
    {
        (void)second.result.get();
    }
    catch (const nativeweb::Error& error)
    {
        secondRejected = true;
        CHECK(error.code() == "webview_destroyed");
    }

    CHECK(firstRejected);
    CHECK(secondRejected);
}

void testUnknownId()
{
    nativeweb::detail::PendingCallRegistry registry;

    CHECK(!registry.resolve(9999, Any(1)));
    CHECK(!registry.reject(
        9999,
        nativeweb::Error("missing", "missing request")));
}

} // namespace

int main()
{
    testCreateAndResolve();
    testUniqueIds();
    testReject();
    testRejectAllOnDestroyContract();
    testUnknownId();

    if (failures != 0)
    {
        std::cerr << "Pending call regression failed: "
                  << failures << " check(s)" << std::endl;
        return 1;
    }

    std::cout << "Pending call regression: PASS" << std::endl;
    return 0;
}
