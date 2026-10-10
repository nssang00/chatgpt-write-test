#include "nativeweb/webview.hpp"

#include "browser/common/backend_registry.hpp"
#include "core/bridge_runtime.hpp"
#include "core/native_object_runtime.hpp"
#include "nativeweb/error.hpp"

#include <cstdint>
#include <mutex>
#include <sstream>
#include <utility>

namespace nativeweb {

class WebView::Impl :
    public detail::BrowserBackendListener
{
private:
    struct ResponseSinkState
    {
        explicit ResponseSinkState(Impl* valueOwner)
            : owner(valueOwner)
        {
        }

        std::mutex mutex;
        Impl* owner;
    };

public:
    Impl()
        : responseSink_(new ResponseSinkState(this)),
          listener_(0),
          resolvedEngine_(Engine::Auto)
    {
        runtime_.bind(
            "__native_object.call",
            DynamicFunction(
                [this](const VariantList& args) -> Any
                {
                    if (args.size() < 3)
                    {
                        throw Error(
                            "invalid_native_object_call",
                            "Native object call requires id, type and method");
                    }

                    const std::string idText =
                        AnyCast<std::string>(args[0]);

                    const std::string typeName =
                        AnyCast<std::string>(args[1]);

                    const std::string method =
                        AnyCast<std::string>(args[2]);

                    NativeObjectHandle handle =
                        parseObjectHandle(
                            idText,
                            typeName);

                    VariantList methodArgs;

                    const std::size_t firstArg = 3;

                    for (std::size_t i = firstArg;
                         i < args.size();
                         ++i)
                    {
                        methodArgs.push_back(args[i]);
                    }

                    return objects_.call(
                        handle,
                        method,
                        methodArgs);
                }));

        runtime_.bind(
            "__native_object.release",
            DynamicFunction(
                [this](const VariantList& args) -> Any
                {
                    if (args.empty())
                    {
                        throw Error(
                            "invalid_native_object_release",
                            "Native object release requires an id");
                    }

                    const std::string idText =
                        AnyCast<std::string>(args[0]);

                    const std::string typeName =
                        args.size() >= 2
                            ? AnyCast<std::string>(args[1])
                            : std::string();

                    return Any(
                        objects_.release(
                            parseObjectHandle(
                                idText,
                                typeName)));
                }));
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
        detachResponseSink();
        objects_.clear();
        runtime_.shutdown();

        if (backend_)
            backend_->destroy();
    }

    void shutdown()
    {
        detachResponseSink();
        objects_.clear();
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
        if (method.find("__native_object.") == 0)
        {
            throw Error(
                "reserved_method",
                "NativeWeb internal object method name is reserved");
        }

        runtime_.bind(method, function);
    }

    void bindCallable(
        const std::string& method,
        const detail::Callable& callable)
    {
        if (method.find("__native_object.") == 0)
        {
            throw Error(
                "reserved_method",
                "NativeWeb internal object method name is reserved");
        }

        runtime_.bind(method, callable);
    }

    NativeObjectHandle addObject(
        const std::shared_ptr<void>& object,
        const std::string& typeName)
    {
        return objects_.add(object, typeName);
    }

    void bindObjectMethod(
        const NativeObjectHandle& handle,
        const std::string& method,
        const DynamicFunction& function)
    {
        objects_.bindMethod(
            handle,
            method,
            function);
    }

    bool releaseObject(
        const NativeObjectHandle& handle)
    {
        return objects_.release(handle);
    }

    std::future<Any> execute(
        const std::string& method,
        const VariantList& args)
    {
        const std::shared_ptr<detail::PendingResult<Any> > pending(
            new detail::PendingResult<Any>());

        std::future<Any> result =
            pending->future();

        beginExecute(
            method,
            args,
            pending);

        return result;
    }

    void beginExecute(
        const std::string& method,
        const VariantList& args,
        const std::shared_ptr<detail::PendingResultBase>& result)
    {
        detail::BrowserBackend* backend =
            requireBackend();

        const detail::OutboundRequest call =
            runtime_.callWithPending(
                method,
                args,
                result);

        backend->postBridgeMessage(
            call.message);
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
        const std::shared_ptr<ResponseSinkState> sink =
            responseSink_;

        runtime_.receiveAsync(
            message,
            [sink](const Any& response) {
                if (!sink || response.empty())
                    return;

                std::lock_guard<std::mutex> lock(
                    sink->mutex);

                Impl* owner = sink->owner;

                if (owner && owner->backend_)
                    owner->backend_->postBridgeMessage(
                        response);
            });
    }

    void onBrowserClosed() override
    {
        detachResponseSink();
        runtime_.shutdown();

        if (listener_)
            listener_->onClosed();
    }

private:
    void detachResponseSink()
    {
        if (!responseSink_)
            return;

        std::lock_guard<std::mutex> lock(
            responseSink_->mutex);

        responseSink_->owner = 0;
    }

    static NativeObjectHandle parseObjectHandle(
        const std::string& idText,
        const std::string& typeName)
    {
        std::istringstream stream(idText);
        std::uint64_t id = 0;
        stream >> id;

        if (!stream || !stream.eof() || id == 0)
        {
            throw Error(
                "invalid_native_object",
                "Native object id is invalid");
        }

        return NativeObjectHandle(id, typeName);
    }

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

    std::shared_ptr<ResponseSinkState> responseSink_;
    detail::BridgeRuntime runtime_;
    detail::NativeObjectRuntime objects_;
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

void WebView::bindCallable(
    const std::string& method,
    const detail::Callable& callable)
{
    impl_->bindCallable(
        method,
        callable);
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

void WebView::beginExecute(
    const std::string& method,
    const VariantList& args,
    const std::shared_ptr<detail::PendingResultBase>& result)
{
    impl_->beginExecute(
        method,
        args,
        result);
}

NativeObjectHandle WebView::addObject(
    const std::shared_ptr<void>& object,
    const std::string& typeName)
{
    return impl_->addObject(object, typeName);
}

void WebView::bindObjectMethod(
    const NativeObjectHandle& handle,
    const std::string& method,
    const DynamicFunction& function)
{
    impl_->bindObjectMethod(
        handle,
        method,
        function);
}

bool WebView::releaseObject(
    const NativeObjectHandle& handle)
{
    return impl_->releaseObject(handle);
}

} // namespace nativeweb
