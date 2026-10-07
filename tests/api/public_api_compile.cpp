#include "nativeweb/nativeweb.hpp"

#include <future>
#include <string>

namespace {

Any dynamicAdd(const VariantList& args)
{
    const int a = AnyCast<int>(args[0]);
    const int b = AnyCast<int>(args[1]);
    return Any(a + b);
}

void compileBeginnerContract(nativeweb::NativeWindowHandle parent)
{
    nativeweb::WebView webview;

    webview.create(parent, "index.html");
    webview.load("index.html");

    webview.bind("math.dynamicAdd", &dynamicAdd);

    webview.bind("math.add", [](int a, int b) {
        return a + b;
    });

    VariantList args;
    args.push_back(Any(3));
    args.push_back(Any(4));

    std::future<Any> dynamicResult =
        webview.execute("ui.calculate", args);

    webview.emit("app.ready", Any(true));
    webview.reload();
    webview.destroy();

    (void)dynamicResult;
}

} // namespace
