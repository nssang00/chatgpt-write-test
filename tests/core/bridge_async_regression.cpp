#include "core/bridge_message.hpp"
#include "core/bridge_runtime.hpp"

#include <chrono>
#include <future>
#include <iostream>
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

#define CHECK(expr)     do { if (!(expr)) fail(#expr, __FILE__, __LINE__); } while (0)

bool ready(
    std::future<Any>& future,
    int milliseconds = 3000)
{
    return future.wait_for(
        std::chrono::milliseconds(milliseconds)) ==
        std::future_status::ready;
}

void testRequestRunsOnWorker()
{
    nativeweb::detail::BridgeRuntime bridge;

    const std::thread::id caller =
        std::this_thread::get_id();

    std::promise<std::thread::id> executedPromise;
    std::future<std::thread::id> executed =
        executedPromise.get_future();

    bridge.bind(
        "thread.check",
        nativeweb::detail::makeDynamicFunction(
            [&executedPromise]() {
                executedPromise.set_value(
                    std::this_thread::get_id());
                return true;
            }));

    std::promise<Any> responsePromise;
    std::future<Any> response =
        responsePromise.get_future();

    bridge.receiveAsync(
        nativeweb::detail::makeRequestMessage(
            1,
            "thread.check",
            VariantList()),
        [&responsePromise](const Any& value) {
            responsePromise.set_value(value);
        });

    CHECK(
        executed.wait_for(
            std::chrono::seconds(3)) ==
        std::future_status::ready);

    CHECK(executed.get() != caller);
    CHECK(ready(response));

    const nativeweb::detail::BridgeMessage parsed =
        nativeweb::detail::parseBridgeMessage(
            response.get());

    CHECK(
        parsed.type ==
        nativeweb::detail::BridgeMessageType::Response);
    CHECK(AnyCast<bool>(parsed.value));
}

void testConcurrentRequestsCanOverlap()
{
    nativeweb::detail::BridgeRuntime bridge;

    std::promise<void> releasePromise;
    std::shared_future<void> release =
        releasePromise.get_future().share();

    std::promise<void> slowStartedPromise;
    std::future<void> slowStarted =
        slowStartedPromise.get_future();

    bridge.bind(
        "slow",
        nativeweb::detail::makeDynamicFunction(
            [&]() {
                slowStartedPromise.set_value();
                release.wait();
                return 1;
            }));

    bridge.bind(
        "fast",
        nativeweb::detail::makeDynamicFunction(
            []() {
                return 2;
            }));

    std::promise<Any> slowResponsePromise;
    std::future<Any> slowResponse =
        slowResponsePromise.get_future();

    std::promise<Any> fastResponsePromise;
    std::future<Any> fastResponse =
        fastResponsePromise.get_future();

    bridge.receiveAsync(
        nativeweb::detail::makeRequestMessage(
            10,
            "slow",
            VariantList()),
        [&slowResponsePromise](const Any& value) {
            slowResponsePromise.set_value(value);
        });

    CHECK(
        slowStarted.wait_for(
            std::chrono::seconds(3)) ==
        std::future_status::ready);

    bridge.receiveAsync(
        nativeweb::detail::makeRequestMessage(
            11,
            "fast",
            VariantList()),
        [&fastResponsePromise](const Any& value) {
            fastResponsePromise.set_value(value);
        });

    // Fast must finish while slow is still blocked. This proves that incoming
    // requests are not serialized through one worker.
    CHECK(ready(fastResponse, 1500));

    const nativeweb::detail::BridgeMessage fastParsed =
        nativeweb::detail::parseBridgeMessage(
            fastResponse.get());

    CHECK(fastParsed.requestId == 11u);
    CHECK(AnyCast<int>(fastParsed.value) == 2);

    releasePromise.set_value();

    CHECK(ready(slowResponse));

    const nativeweb::detail::BridgeMessage slowParsed =
        nativeweb::detail::parseBridgeMessage(
            slowResponse.get());

    CHECK(slowParsed.requestId == 10u);
    CHECK(AnyCast<int>(slowParsed.value) == 1);
}

void testExceptionRejectsOnlyMatchingRequest()
{
    nativeweb::detail::BridgeRuntime bridge;

    bridge.bind(
        "fail",
        nativeweb::detail::makeDynamicFunction(
            []() -> int {
                throw std::runtime_error("expected failure");
            }));

    std::promise<Any> responsePromise;
    std::future<Any> response =
        responsePromise.get_future();

    bridge.receiveAsync(
        nativeweb::detail::makeRequestMessage(
            20,
            "fail",
            VariantList()),
        [&responsePromise](const Any& value) {
            responsePromise.set_value(value);
        });

    CHECK(ready(response));

    const nativeweb::detail::BridgeMessage parsed =
        nativeweb::detail::parseBridgeMessage(
            response.get());

    CHECK(
        parsed.type ==
        nativeweb::detail::BridgeMessageType::Error);
    CHECK(parsed.requestId == 20u);
    CHECK(parsed.errorCode == "native_exception");
}

void testStoppedRuntimeRejectsNewRequest()
{
    nativeweb::detail::BridgeRuntime bridge;

    bridge.bind(
        "value",
        nativeweb::detail::makeDynamicFunction(
            []() { return 1; }));

    bridge.shutdown();

    std::promise<Any> responsePromise;
    std::future<Any> response =
        responsePromise.get_future();

    bridge.receiveAsync(
        nativeweb::detail::makeRequestMessage(
            30,
            "value",
            VariantList()),
        [&responsePromise](const Any& value) {
            responsePromise.set_value(value);
        });

    CHECK(ready(response));

    const nativeweb::detail::BridgeMessage parsed =
        nativeweb::detail::parseBridgeMessage(
            response.get());

    CHECK(parsed.errorCode == "runtime_stopped");
}

} // namespace

int main()
{
    testRequestRunsOnWorker();
    testConcurrentRequestsCanOverlap();
    testExceptionRejectsOnlyMatchingRequest();
    testStoppedRuntimeRejectsNewRequest();

    if (failures != 0)
    {
        std::cerr
            << "Async bridge regression failed: "
            << failures
            << " check(s)"
            << std::endl;
        return 1;
    }

    std::cout
        << "Async bridge regression: PASS"
        << std::endl;
    return 0;
}
