#ifndef NATIVEWEB_WEBVIEW_HPP_INCLUDED
#define NATIVEWEB_WEBVIEW_HPP_INCLUDED

#include "nativeweb/any.hpp"
#include "nativeweb/detail/bind.hpp"
#include "nativeweb/detail/async.hpp"
#include "nativeweb/types.hpp"

#include <future>
#include <memory>
#include <string>

namespace nativeweb {

class WebViewListener
{
public:
    virtual ~WebViewListener()
    {
    }

    virtual void onCreated()
    {
    }

    virtual void onLoadStarted(const std::string&)
    {
    }

    virtual void onLoadFinished(const std::string&)
    {
    }

    virtual void onClosed()
    {
    }
};

class WebView
{
public:
    WebView();
    ~WebView();

    WebView(const WebView&) = delete;
    WebView& operator=(const WebView&) = delete;

    WebView(WebView&& other);
    WebView& operator=(WebView&& other);

    // Beginner path: create a WebView with the framework-selected engine
    // (engine=auto policy is resolved internally).
    void create(NativeWindowHandle parent, const std::string& source);
    void create(
        NativeWindowHandle parent,
        const std::string& source,
        const WebViewOptions& options);
    void destroy();

    void setListener(WebViewListener* listener);

    bool isCreated() const;
    Engine engine() const;
    Capabilities capabilities() const;

    void load(const std::string& source);
    void reload();

    // Dynamic primitive API. Typed bind below adapts ordinary C++ callables to
    // this canonical Any/VariantList contract.
    void bind(const std::string& method, const DynamicFunction& function);

    std::future<Any> execute(
        const std::string& method,
        const VariantList& args = VariantList());

    void emit(
        const std::string& event,
        const Any& payload = Any());

    NativeObjectHandle addObject(
        const std::shared_ptr<void>& object,
        const std::string& typeName);

    template <typename T>
    NativeObjectHandle addObject(
        const std::shared_ptr<T>& object,
        const std::string& typeName)
    {
        return addObject(
            std::static_pointer_cast<void>(object),
            typeName);
    }

    void bindObjectMethod(
        const NativeObjectHandle& handle,
        const std::string& method,
        const DynamicFunction& function);

    template <typename Callable>
    void bindObjectMethod(
        const NativeObjectHandle& handle,
        const std::string& method,
        Callable callable)
    {
        bindObjectMethod(
            handle,
            method,
            detail::makeDynamicFunction(callable));
    }

    bool releaseObject(
        const NativeObjectHandle& handle);

    template <typename Callable>
    void bind(const std::string& method, Callable callable)
    {
        const DynamicFunction dynamic =
            detail::makeDynamicFunction(callable);

        bind(method, dynamic);
    }

    template <typename Result, typename... Args>
    std::future<Result> execute(
        const std::string& method,
        const Args&... args)
    {
        VariantList packed;
        detail::appendArguments(packed, args...);

        return detail::castFuture<Result>(
            execute(method, packed));
    }

private:
    class Impl;
    std::unique_ptr<Impl> impl_;
};

} // namespace nativeweb

#endif
