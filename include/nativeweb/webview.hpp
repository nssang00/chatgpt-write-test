#ifndef NATIVEWEB_WEBVIEW_HPP_INCLUDED
#define NATIVEWEB_WEBVIEW_HPP_INCLUDED

#include "nativeweb/any.hpp"

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

    // Dynamic primitive API. This is the stable foundation used by typed
    // convenience adapters and migration-style invoke APIs.
    typedef Any (*DynamicFunction)(const VariantList& args);

    void bind(const std::string& method, DynamicFunction function);

    std::future<Any> execute(
        const std::string& method,
        const VariantList& args = VariantList());

    void emit(
        const std::string& event,
        const Any& payload = Any());

    // Recommended typed API. The adapter implementation will map ordinary
    // C++ callables/arguments to the dynamic Any contract without exposing
    // browser-engine details.
    template <typename Callable>
    void bind(const std::string& method, Callable callable);

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
