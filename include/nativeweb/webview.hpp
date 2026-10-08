#ifndef NATIVEWEB_WEBVIEW_HPP_INCLUDED
#define NATIVEWEB_WEBVIEW_HPP_INCLUDED

#include "nativeweb/any.hpp"
#include "nativeweb/error.hpp"
#include "nativeweb/detail/bind.hpp"
#include "nativeweb/detail/async.hpp"
#include "nativeweb/detail/pending_result.hpp"
#include "nativeweb/types.hpp"

#include <future>
#include <memory>
#include <string>
#include <type_traits>

namespace nativeweb {

template <typename T>
class ObjectBinder;

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

    template <typename T>
    ObjectBinder<T> bind(
        const std::string& objectName,
        const std::shared_ptr<T>& object);

    // Convenience overload for the beginner path. Ownership is transferred to
    // NativeWeb immediately; the caller must not delete the pointer.
    template <typename T>
    typename std::enable_if<
        !std::is_function<T>::value,
        ObjectBinder<T>
    >::type
    bind(
        const std::string& objectName,
        T* object);

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

        const std::shared_ptr<detail::PendingResult<Result> > pending(
            new detail::PendingResult<Result>());

        std::future<Result> result =
            pending->future();

        beginExecute(
            method,
            packed,
            pending);

        return result;
    }

private:
    void beginExecute(
        const std::string& method,
        const VariantList& args,
        const std::shared_ptr<detail::PendingResultBase>& result);

    class Impl;
    std::unique_ptr<Impl> impl_;
};

template <typename T>
class ObjectBinder
{
public:
    ObjectBinder(
        WebView* webview,
        const std::string& objectName,
        const std::shared_ptr<T>& object)
        : webview_(webview),
          objectName_(objectName),
          object_(object)
    {
        if (!webview_)
            throw Error(
                "invalid_object_binding",
                "NativeWeb object binding has no WebView");

        if (objectName_.empty())
            throw Error(
                "invalid_object_binding",
                "NativeWeb object binding name cannot be empty");

        if (!object_)
            throw Error(
                "invalid_object_binding",
                "NativeWeb cannot bind a null C++ object");
    }

    template <typename Result, typename... Args>
    ObjectBinder& method(
        const std::string& name,
        Result (T::*method)(Args...))
    {
        requireMethodName(name);

        webview_->bind(
            objectName_ + "." + name,
            detail::bindMember(
                object_,
                method));

        return *this;
    }

    template <typename Result, typename... Args>
    ObjectBinder& method(
        const std::string& name,
        Result (T::*method)(Args...) const)
    {
        requireMethodName(name);

        webview_->bind(
            objectName_ + "." + name,
            detail::bindMember(
                object_,
                method));

        return *this;
    }

private:
    void requireMethodName(
        const std::string& name) const
    {
        if (name.empty())
            throw Error(
                "invalid_object_binding",
                "NativeWeb object method name cannot be empty");
    }

    WebView* webview_;
    std::string objectName_;
    std::shared_ptr<T> object_;
};

template <typename T>
ObjectBinder<T> WebView::bind(
    const std::string& objectName,
    const std::shared_ptr<T>& object)
{
    return ObjectBinder<T>(
        this,
        objectName,
        object);
}

template <typename T>
typename std::enable_if<
    !std::is_function<T>::value,
    ObjectBinder<T>
>::type
WebView::bind(
    const std::string& objectName,
    T* object)
{
    return bind(
        objectName,
        std::shared_ptr<T>(object));
}

} // namespace nativeweb

#endif
