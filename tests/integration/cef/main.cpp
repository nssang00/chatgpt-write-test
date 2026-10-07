#include "browser/cef/cef_backend.hpp"
#include "browser/cef/cef_renderer_app.hpp"
#include "core/bridge_message.hpp"
#include "core/bridge_runtime.hpp"
#include "include/cef_app.h"
#include "include/cef_command_line.h"
#include "nativeweb/error.hpp"

#include <future>
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
          finished_(false),
          jsFinished_(false),
          cppToJsStarted_(false),
          cppSyncFinished_(false),
          cppAsyncFinished_(false),
          cppRejectFinished_(false),
          cppSyncSuccess_(false),
          cppAsyncSuccess_(false),
          cppRejectSuccess_(false),
          cppSyncCallId_(0),
          cppAsyncCallId_(0),
          cppRejectCallId_(0)
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
            "test.emit",
            nativeweb::detail::makeDynamicFunction(
                [this](const VariantDict& payload) {
                    if (backend_)
                    {
                        backend_->postBridgeMessage(
                            runtime_.eventMessage(
                                "test.event",
                                Any(payload)));
                    }

                    return true;
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
                    jsFinished_ = (result == 7);

                    if (!jsFinished_)
                        failure_ = "JavaScript-side regression failed";

                    return jsFinished_;
                }));

        runtime_.bind(
            "test.fail",
            nativeweb::detail::makeDynamicFunction(
                [this](const std::string& message) {
                    failure_ = message;
                    success_ = false;
                    jsFinished_ = true;
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

        if (backend_ &&
            !cppToJsStarted_ &&
            source.find("reloaded=1") != std::string::npos)
        {
            VariantList args;
            args.push_back(Any(6));
            args.push_back(Any(7));

            nativeweb::detail::OutboundCall syncCall =
                runtime_.call(
                    "ui.multiply",
                    args);

            cppSyncCallId_ = syncCall.id;
            cppSyncResult_ =
                std::move(syncCall.result);

            nativeweb::detail::OutboundCall asyncCall =
                runtime_.call(
                    "ui.multiplyAsync",
                    args);

            cppAsyncCallId_ = asyncCall.id;
            cppAsyncResult_ =
                std::move(asyncCall.result);

            nativeweb::detail::OutboundCall rejectCall =
                runtime_.call(
                    "ui.rejectAsync",
                    VariantList());

            cppRejectCallId_ = rejectCall.id;
            cppRejectResult_ =
                std::move(rejectCall.result);

            cppToJsStarted_ = true;

            backend_->postBridgeMessage(
                syncCall.message);

            backend_->postBridgeMessage(
                asyncCall.message);

            backend_->postBridgeMessage(
                rejectCall.message);
        }
    }

    void onBridgeMessage(const Any& message) override
    {
        const nativeweb::detail::BridgeMessage parsed =
            nativeweb::detail::parseBridgeMessage(message);

        const Any response = runtime_.receive(message);

        if (backend_ && !response.empty())
            backend_->postBridgeMessage(response);

        if (cppToJsStarted_ &&
            (parsed.type ==
                 nativeweb::detail::BridgeMessageType::Response ||
             parsed.type ==
                 nativeweb::detail::BridgeMessageType::Error))
        {
            if (!cppSyncFinished_ &&
                parsed.requestId == cppSyncCallId_)
            {
                try
                {
                    cppSyncSuccess_ =
                        AnyCast<int>(
                            cppSyncResult_.get()) == 42;
                }
                catch (const std::exception& error)
                {
                    failure_ =
                        std::string("C++ to sync JS call failed: ") +
                        error.what();
                    cppSyncSuccess_ = false;
                }

                cppSyncFinished_ = true;
            }

            if (!cppAsyncFinished_ &&
                parsed.requestId == cppAsyncCallId_)
            {
                try
                {
                    cppAsyncSuccess_ =
                        AnyCast<int>(
                            cppAsyncResult_.get()) == 42;
                }
                catch (const std::exception& error)
                {
                    failure_ =
                        std::string("C++ to async JS call failed: ") +
                        error.what();
                    cppAsyncSuccess_ = false;
                }

                cppAsyncFinished_ = true;
            }

            if (!cppRejectFinished_ &&
                parsed.requestId == cppRejectCallId_)
            {
                try
                {
                    (void)cppRejectResult_.get();
                    cppRejectSuccess_ = false;
                    failure_ =
                        "Rejected JavaScript Promise resolved unexpectedly";
                }
                catch (const nativeweb::Error& error)
                {
                    cppRejectSuccess_ =
                        error.code() == "js_promise_rejected" &&
                        std::string(error.what()).find(
                            "expected js rejection") !=
                            std::string::npos;

                    if (!cppRejectSuccess_)
                    {
                        failure_ =
                            std::string(
                                "Unexpected JavaScript rejection mapping: ") +
                            error.code() +
                            ": " +
                            error.what();
                    }
                }
                catch (const std::exception& error)
                {
                    cppRejectSuccess_ = false;
                    failure_ =
                        std::string(
                            "Unexpected C++ exception for JS rejection: ") +
                        error.what();
                }

                cppRejectFinished_ = true;
            }
        }

        if (!failure_.empty())
        {
            success_ = false;
            finished_ = true;
        }
        else if (jsFinished_ &&
                 cppSyncFinished_ &&
                 cppAsyncFinished_ &&
                 cppRejectFinished_)
        {
            success_ =
                cppSyncSuccess_ &&
                cppAsyncSuccess_ &&
                cppRejectSuccess_;

            finished_ = true;

            if (!success_)
                failure_ =
                    "C++ to JavaScript regression returned an unexpected result";
        }

        if (finished_ && backend_)
            backend_->destroy();

        if (parsed.type ==
            nativeweb::detail::BridgeMessageType::Request)
        {
            std::cout << "bridge-method: "
                      << parsed.method << std::endl;
        }
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
    bool jsFinished_;
    bool cppToJsStarted_;
    bool cppSyncFinished_;
    bool cppAsyncFinished_;
    bool cppRejectFinished_;
    bool cppSyncSuccess_;
    bool cppAsyncSuccess_;
    bool cppRejectSuccess_;
    nativeweb::detail::RequestId cppSyncCallId_;
    nativeweb::detail::RequestId cppAsyncCallId_;
    nativeweb::detail::RequestId cppRejectCallId_;
    std::future<Any> cppSyncResult_;
    std::future<Any> cppAsyncResult_;
    std::future<Any> cppRejectResult_;
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
