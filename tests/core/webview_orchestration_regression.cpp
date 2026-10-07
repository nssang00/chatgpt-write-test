#include "browser/common/backend_registry.hpp"
#include "core/bridge_message.hpp"
#include "nativeweb/webview.hpp"

#include <chrono>
#include <condition_variable>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>

namespace {

int failures = 0;

void fail(const char* expression, const char* file, int line)
{
    std::cerr << file << ":" << line
              << ": CHECK failed: " << expression << std::endl;
    ++failures;
}

#define CHECK(expr) do { if (!(expr)) fail(#expr, __FILE__, __LINE__); } while (0)

class FakeBackend : public nativeweb::detail::BrowserBackend
{
public:
    FakeBackend()
        : listener_(0),
          created_(false)
    {
        instance = this;
    }

    ~FakeBackend()
    {
        if (instance == this)
            instance = 0;
    }

    const char* engineName() const override
    {
        return "fake-cef";
    }

    nativeweb::Engine engine() const override
    {
        return nativeweb::Engine::Cef;
    }

    nativeweb::Capabilities capabilities() const override
    {
        return nativeweb::Capabilities(
            static_cast<std::uint64_t>(
                nativeweb::Capability::Binary) |
            static_cast<std::uint64_t>(
                nativeweb::Capability::Events));
    }

    void setListener(
        nativeweb::detail::BrowserBackendListener* listener) override
    {
        listener_ = listener;
    }

    void create(
        const nativeweb::detail::BrowserCreateParams& params) override
    {
        created_ = true;
        source_ = params.source;
        if (listener_)
            listener_->onBrowserCreated();
    }

    void destroy() override
    {
        created_ = false;
        if (listener_)
            listener_->onBrowserClosed();
    }

    bool isCreated() const override
    {
        return created_;
    }

    void load(const std::string& source) override
    {
        source_ = source;
    }

    void reload() override
    {
        reloaded_ = true;
    }

    void postBridgeMessage(const Any& message) override
    {
        {
            std::lock_guard<std::mutex> lock(messageMutex_);
            lastMessage_ = message;
            ++messageVersion_;
        }

        messageCondition_.notify_all();
    }

    std::size_t messageVersion() const
    {
        std::lock_guard<std::mutex> lock(messageMutex_);
        return messageVersion_;
    }

    Any waitForMessageAfter(std::size_t previousVersion)
    {
        std::unique_lock<std::mutex> lock(messageMutex_);

        const bool changed =
            messageCondition_.wait_for(
                lock,
                std::chrono::seconds(3),
                [this, previousVersion]() {
                    return messageVersion_ > previousVersion;
                });

        if (!changed)
            return Any();

        return lastMessage_;
    }

    void deliver(const Any& message)
    {
        if (listener_)
            listener_->onBridgeMessage(message);
    }

    static FakeBackend* instance;

    bool reloaded_ = false;

private:
    mutable std::mutex messageMutex_;
    std::condition_variable messageCondition_;
    std::size_t messageVersion_ = 0;
    Any lastMessage_;

    nativeweb::detail::BrowserBackendListener* listener_;
    bool created_;
    std::string source_;
};

FakeBackend* FakeBackend::instance = 0;

void registerFake()
{
    nativeweb::detail::registerBrowserBackendFactory(
        nativeweb::Engine::Cef,
        []() -> std::unique_ptr<nativeweb::detail::BrowserBackend>
        {
            return std::unique_ptr<nativeweb::detail::BrowserBackend>(
                new FakeBackend());
        });
}

class PublicListener : public nativeweb::WebViewListener
{
public:
    PublicListener()
        : created(false),
          closed(false)
    {
    }

    void onCreated() override
    {
        created = true;
    }

    void onClosed() override
    {
        closed = true;
    }

    bool created;
    bool closed;
};

void testPublicOrchestration()
{
    registerFake();

    nativeweb::WebView webview;
    PublicListener listener;
    webview.setListener(&listener);
    webview.bind("math.add", [](int a, int b) {
        return a + b;
    });

    nativeweb::WebViewOptions options;
    options.engine = nativeweb::Engine::Cef;
    webview.create(0, "index.html", options);

    CHECK(webview.isCreated());
    CHECK(listener.created);
    CHECK(webview.engine() == nativeweb::Engine::Cef);
    CHECK(webview.capabilities().supports(
        nativeweb::Capability::Binary));

    CHECK(FakeBackend::instance != 0);

    VariantList requestArgs;
    requestArgs.push_back(Any(3));
    requestArgs.push_back(Any(4));

    const std::size_t inboundVersion =
        FakeBackend::instance->messageVersion();

    FakeBackend::instance->deliver(
        nativeweb::detail::makeRequestMessage(
            77,
            "math.add",
            requestArgs));

    const Any inboundMessage =
        FakeBackend::instance->waitForMessageAfter(
            inboundVersion);

    CHECK(!inboundMessage.empty());

    const nativeweb::detail::BridgeMessage response =
        nativeweb::detail::parseBridgeMessage(
            inboundMessage);

    CHECK(
        response.type ==
        nativeweb::detail::BridgeMessageType::Response);
    CHECK(response.requestId == 77);
    CHECK(AnyCast<int>(response.value) == 7);

    const std::size_t outboundVersion =
        FakeBackend::instance->messageVersion();

    std::future<int> outbound =
        webview.execute<int>("ui.answer", 21, 2);

    const Any outboundMessage =
        FakeBackend::instance->waitForMessageAfter(
            outboundVersion);

    CHECK(!outboundMessage.empty());

    const nativeweb::detail::BridgeMessage outboundRequest =
        nativeweb::detail::parseBridgeMessage(
            outboundMessage);

    CHECK(
        outboundRequest.type ==
        nativeweb::detail::BridgeMessageType::Request);
    CHECK(outboundRequest.method == "ui.answer");

    FakeBackend::instance->deliver(
        nativeweb::detail::makeResponseMessage(
            outboundRequest.requestId,
            Any(42)));

    CHECK(outbound.get() == 42);

    const std::size_t eventVersion =
        FakeBackend::instance->messageVersion();

    webview.emit("app.ready", Any(true));

    const Any eventMessage =
        FakeBackend::instance->waitForMessageAfter(
            eventVersion);

    CHECK(!eventMessage.empty());

    const nativeweb::detail::BridgeMessage event =
        nativeweb::detail::parseBridgeMessage(
            eventMessage);
    CHECK(
        event.type ==
        nativeweb::detail::BridgeMessageType::Event);
    CHECK(event.eventName == "app.ready");
    CHECK(AnyCast<bool>(event.value));

    webview.reload();
    CHECK(FakeBackend::instance->reloaded_);

    webview.destroy();
    CHECK(!webview.isCreated());
    CHECK(listener.closed);
}

} // namespace

int main()
{
    testPublicOrchestration();

    if (failures != 0)
    {
        std::cerr << "WebView orchestration regression failed: "
                  << failures << " check(s)" << std::endl;
        return 1;
    }

    std::cout << "WebView orchestration regression: PASS"
              << std::endl;
    return 0;
}
