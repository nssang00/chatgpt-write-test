#include "nativeweb/webview.hpp"

#include "browser/common/backend_registry.hpp"
#include "core/bridge_runtime.hpp"
#include "nativeweb/error.hpp"

#include <utility>

namespace nativeweb {

class WebView::Impl :
    public detail::BrowserBackendListener
{
public:
    Impl()
        : listener_(0),
          resolvedEngine_(Engine::Auto)
    {
    }

    ~Impl()
    {
        shutdown();
    }

    void create(
        NativeWindowHandle parent,
        const std::string& source,
        const WebViewOptions& options)
    {
        if (backend_)
            throw Error(
                "webview_already_created",
                "NativeWeb WebView is already created");

        backend_ =
            detail::createBrowserBackend(
                options.engine,
                &resolvedEngine_);

        backend_->setListener(this);

        detail::BrowserCreateParams params;
        params.parent = parent;
        params.source = source;

        try
        {
            backend_->create(params);
        }
        catch (...)
        {
            backend_->setListener(0);
            backend_.reset();
            resolvedEngine_ = Engine::Auto;
            throw;
        }
    }

    void destroy()
    {
        runtime_.shutdown();

        if (backend_)
            backend_->destroy();
    }

    void shutdown()
    {
        runtime_.shutdown();

        if (backend_)
        {
            backend_->setListener(0);

            if (backend_->isCreated())
                backend_->destroy();

            backend_.reset();
        }

        resolvedEngine_ = Engine::Auto;
    }

    void setListener(WebViewListener* listener)
    {
        listener_ = listener;
    }

    bool isCreated() const
    {
        return backend_ && backend_->isCreated();
    }

    Engine engine() const
    {
        return resolvedEngine_;
    }

    Capabilities capabilities() const
    {
        if (!backend_)
            return Capabilities();

        return backend_->capabilities();
    }

    void load(const std::string& source)
    {
        requireBackend()->load(source);
    }

    void reload()
    {
        requireBackend()->reload();
    }

    void bind(
        const std::string& method,
        const DynamicFunction& function)
    {
        runtime_.bind(method, function);
    }

    std::future<Any> execute(
        const std::string& method,
        const VariantList& args)
    {
        detail::BrowserBackend* backend =
            requireBackend();

        detail::OutboundCall call =
            runtime_.call(method, args);

        backend->postBridgeMessage(call.message);

        return std::move(call.result);
    }

    void emit(
        const std::string& event,
        const Any& payload)
    {
        requireBackend()->postBridgeMessage(
            runtime_.eventMessage(event, payload));
    }

    void onBrowserCreated() override
    {
        if (listener_)
            listener_->onCreated();
    }

    void onLoadStarted(const std::string& source) override
    {
        if (listener_)
            listener_->onLoadStarted(source);
    }

    void onLoadFinished(const std::string& source) override
    {
        if (listener_)
            listener_->onLoadFinished(source);
    }

    void onBridgeMessage(const Any& message) override
    {
        const Any response = runtime_.receive(message);

        if (!response.empty() && backend_)
            backend_->postBridgeMessage(response);
    }

    void onBrowserClosed() override
    {
        runtime_.shutdown();

        if (listener_)
            listener_->onClosed();
    }

private:
    detail::BrowserBackend* requireBackend()
    {
        if (!backend_ || !backend_->isCreated())
        {
            throw Error(
                "webview_not_created",
                "NativeWeb WebView has not been created");
        }

        return backend_.get();
    }

    detail::BridgeRuntime runtime_;
    std::unique_ptr<detail::BrowserBackend> backend_;
    WebViewListener* listener_;
    Engine resolvedEngine_;
};

WebView::WebView()
    : impl_(new Impl())
{
}

WebView::~WebView()
{
}

WebView::WebView(WebView&& other)
    : impl_(std::move(other.impl_))
{
    if (!impl_)
        impl_.reset(new Impl());
}

WebView& WebView::operator=(WebView&& other)
{
    if (this != &other)
    {
        impl_ = std::move(other.impl_);

        if (!impl_)
            impl_.reset(new Impl());
    }

    return *this;
}

void WebView::create(
    NativeWindowHandle parent,
    const std::string& source)
{
    create(parent, source, WebViewOptions());
}

void WebView::create(
    NativeWindowHandle parent,
    const std::string& source,
    const WebViewOptions& options)
{
    impl_->create(parent, source, options);
}

void WebView::destroy()
{
    impl_->destroy();
}

void WebView::setListener(WebViewListener* listener)
{
    impl_->setListener(listener);
}

bool WebView::isCreated() const
{
    return impl_->isCreated();
}

Engine WebView::engine() const
{
    return impl_->engine();
}

Capabilities WebView::capabilities() const
{
    return impl_->capabilities();
}

void WebView::load(const std::string& source)
{
    impl_->load(source);
}

void WebView::reload()
{
    impl_->reload();
}

void WebView::bind(
    const std::string& method,
    const DynamicFunction& function)
{
    impl_->bind(method, function);
}

std::future<Any> WebView::execute(
    const std::string& method,
    const VariantList& args)
{
    return impl_->execute(method, args);
}

void WebView::emit(
    const std::string& event,
    const Any& payload)
{
    impl_->emit(event, payload);
}

} // namespace nativeweb
