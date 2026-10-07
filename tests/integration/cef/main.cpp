#include "browser/cef/cef_backend.hpp"
#include "browser/cef/cef_renderer_app.hpp"
#include "core/bridge_message.hpp"
#include "core/bridge_runtime.hpp"
#include "include/cef_app.h"
#include "include/cef_command_line.h"

#include <iostream>
#include <stdexcept>
#include <string>

namespace {

class IntegrationListener :
    public nativeweb::detail::BrowserBackendListener
{
public:
    IntegrationListener()
        : backend_(0),
          success_(false),
          finished_(false)
    {
        runtime_.bind(
            "math.add",
            nativeweb::detail::makeDynamicFunction(
                [](int a, int b) {
                    return a + b;
                }));

        runtime_.bind(
            "echo.object",
            nativeweb::detail::makeDynamicFunction(
                [](const VariantDict& value) {
                    return value;
                }));

        runtime_.bind(
            "echo.array",
            nativeweb::detail::makeDynamicFunction(
                [](const VariantList& value) {
                    return value;
                }));

        runtime_.bind(
            "test.binary",
            nativeweb::detail::makeDynamicFunction(
                []() {
                    nativeweb::Binary bytes;
                    bytes.push_back(0);
                    bytes.push_back(127);
                    bytes.push_back(255);
                    return bytes;
                }));

        runtime_.bind(
            "test.throw",
            nativeweb::detail::makeDynamicFunction(
                []() -> int {
                    throw std::runtime_error(
                        "expected native exception");
                }));

        runtime_.bind(
            "test.done",
            nativeweb::detail::makeDynamicFunction(
                [this](int result) {
                    success_ = (result == 7);
                    finished_ = true;
                    return success_;
                }));

        runtime_.bind(
            "test.fail",
            nativeweb::detail::makeDynamicFunction(
                [this](const std::string& message) {
                    failure_ = message;
                    success_ = false;
                    finished_ = true;
                    return false;
                }));
    }

    void setBackend(nativeweb::detail::CefBackend* backend)
    {
        backend_ = backend;
    }

    bool success() const
    {
        return success_;
    }

    const std::string& failure() const
    {
        return failure_;
    }

    void onBrowserCreated() override
    {
    }

    void onLoadStarted(const std::string& source) override
    {
        std::cout << "load-start: " << source << std::endl;
    }

    void onLoadFinished(const std::string& source) override
    {
        std::cout << "load-finish: " << source << std::endl;
    }

    void onBridgeMessage(const Any& message) override
    {
        const nativeweb::detail::BridgeMessage request =
            nativeweb::detail::parseBridgeMessage(message);

        const Any response = runtime_.receive(message);

        if (backend_ && !response.empty())
            backend_->postBridgeMessage(response);

        if (finished_ && backend_)
            backend_->destroy();

        std::cout << "bridge-method: "
                  << request.method << std::endl;
    }

    void onBrowserClosed() override
    {
        CefQuitMessageLoop();
    }

private:
    nativeweb::detail::CefBackend* backend_;
    nativeweb::detail::BridgeRuntime runtime_;
    bool success_;
    bool finished_;
    std::string failure_;
};

std::string getUrl(int argc, char* argv[])
{
    CefRefPtr<CefCommandLine> commandLine =
        CefCommandLine::CreateCommandLine();

    commandLine->InitFromArgv(argc, argv);

    if (commandLine->HasSwitch("url"))
        return commandLine->GetSwitchValue("url").ToString();

    return "about:blank";
}

} // namespace

int main(int argc, char* argv[])
{
    CefMainArgs mainArgs(argc, argv);

    CefRefPtr<nativeweb::detail::CefRendererApp> app(
        new nativeweb::detail::CefRendererApp());

    const int exitCode =
        CefExecuteProcess(mainArgs, app, 0);

    if (exitCode >= 0)
        return exitCode;

    CefSettings settings;
    settings.no_sandbox = true;
    settings.windowless_rendering_enabled = true;
    settings.log_severity = LOGSEVERITY_WARNING;

    IntegrationListener listener;
    nativeweb::detail::CefBackend backend;
    listener.setBackend(&backend);
    backend.setListener(&listener);

    const std::string url = getUrl(argc, argv);

    app->setBrowserReadyCallback([&backend, url]() {
        nativeweb::detail::BrowserCreateParams params;
        params.parent = 0;
        params.source = url;
        backend.create(params);
    });

    if (!CefInitialize(
            mainArgs,
            settings,
            app,
            0))
    {
        std::cerr << "CefInitialize failed" << std::endl;
        return 2;
    }

    CefRunMessageLoop();

    CefShutdown();

    if (!listener.success())
    {
        std::cerr << "NativeWeb CEF bridge integration failed";
        if (!listener.failure().empty())
            std::cerr << ": " << listener.failure();
        std::cerr << std::endl;
        return 3;
    }

    std::cout << "NativeWeb CEF bridge integration: PASS"
              << std::endl;
    return 0;
}
