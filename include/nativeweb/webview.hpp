#ifndef NATIVEWEB_WEBVIEW_HPP_INCLUDED
#define NATIVEWEB_WEBVIEW_HPP_INCLUDED

#include "nativeweb/any.hpp"
#include "nativeweb/detail/bind.hpp"

#include <future>
#include <memory>
#include <string>

namespace nativeweb {

// Opaque parent handle used by the core API. Framework-specific host adapters
// translate their native widget/window handle to this boundary.
typedef void* NativeWindowHandle;

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
    void destroy();

    bool isCreated() const;

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

    template <typename Callable>
    void bind(const std::string& method, Callable callable)
    {
        const DynamicFunction dynamic =
            detail::makeDynamicFunction(callable);

        bind(method, dynamic);
    }

    // Typed execute remains part of the intended public shape. Its async
    // adapter will be implemented together with the pending-call runtime.
    template <typename Result, typename... Args>
    std::future<Result> execute(
        const std::string& method,
        const Args&... args);

private:
    class Impl;
    std::unique_ptr<Impl> impl_;
};

} // namespace nativeweb

#endif
