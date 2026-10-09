#include "browser/webview2/webview2_backend.hpp"
#include "nativeweb/error.hpp"
#include "nativeweb/webview.hpp"

#include <atomic>
#include <chrono>
#include <future>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <thread>

#include <windows.h>

namespace {

struct Apple
{
    explicit Apple(int value) : base(value) {}
    int add(int a, int b) { return base + a + b; }
    int sub(int a, int b) const { return base + a - b; }
    std::string name() const { return "apple"; }
    int base;
};

struct Camera
{
    explicit Camera(int value) : base(value) {}
    int base;
};

class IntegrationListener : public nativeweb::WebViewListener
{
public:
    explicit IntegrationListener(nativeweb::WebView& webview)
        : webview_(webview),
          success_(false),
          cppCallsStarted_(false),
          cppCallsEvaluated_(false),
          cppCallsSuccess_(false),
          pendingDestroyStarted_(false),
          browserThreadKnown_(false),
          activeConcurrentCalls_(0),
          maxConcurrentCalls_(0)
    {
        webview_.bind("math.add", [](int a, int b) { return a + b; });

        webview_.bind("apple", new Apple(10))
            .method("add", &Apple::add)
            .method("sub", &Apple::sub)
            .method("name", &Apple::name);

        webview_.bind("echo.object", [](const VariantDict& value) { return value; });
        webview_.bind("echo.array", [](const VariantList& value) { return value; });

        webview_.bind("test.emit", [this](const VariantDict& payload) {
            webview_.emit("test.event", Any(payload));
            return true;
        });

        webview_.bind("test.binary", []() {
            nativeweb::Binary bytes;
            bytes.push_back(0);
            bytes.push_back(127);
            bytes.push_back(255);
            return bytes;
        });

        webview_.bind("camera.open", [this]() {
            std::shared_ptr<Camera> camera(new Camera(40));

            const nativeweb::NativeObjectHandle handle =
                webview_.addObject(camera, "Camera");

            webview_.bindObjectMethod(handle, "add", [camera](int value) {
                return camera->base + value;
            });

            webview_.bindObjectMethod(handle, "name", [camera]() {
                return std::string("camera");
            });

            return handle;
        });

        webview_.bind("camera.accept", [](const nativeweb::NativeObjectHandle& handle) {
            return handle.valid() && handle.type == "Camera";
        });

        webview_.bind("test.isWorkerThread", [this]() {
            return
                browserThreadKnown_.load() &&
                std::this_thread::get_id() != browserThreadId_;
        });

        webview_.bind("test.concurrentProbe", [this](int value) {
            const int active =
                activeConcurrentCalls_.fetch_add(1) + 1;

            int observed = maxConcurrentCalls_.load();

            while (
                active > observed &&
                !maxConcurrentCalls_.compare_exchange_weak(observed, active))
            {
            }

            std::this_thread::sleep_for(std::chrono::milliseconds(80));
            activeConcurrentCalls_.fetch_sub(1);
            return value;
        });

        webview_.bind("test.maxConcurrency", [this]() {
            return maxConcurrentCalls_.load();
        });

        webview_.bind("test.rejectExpected", []() -> int {
            throw nativeweb::Error(
                "expected_error",
                "expected structured rejection");
        });

        webview_.bind("test.checkpoint", [](const std::string& name) {
            std::cout
                << "checkpoint: "
                << name
                << std::endl;
            return true;
        });

        webview_.bind("test.throw", []() -> int {
            throw std::runtime_error("expected native exception");
        });

        webview_.bind("test.beginCppCalls", [this]() {
            beginCppCalls();
            return true;
        });

        webview_.bind("test.cppCallsStatus", [this]() {
            return cppCallsStatus();
        });

        webview_.bind("test.beginPendingDestroy", [this]() {
            if (!pendingDestroyStarted_)
            {
                pendingDestroyResult_ =
                    webview_.execute<int>("ui.neverResolve");
                pendingDestroyStarted_ = true;
            }

            return true;
        });

        webview_.bind("test.destroyWithPending", [this]() {
            if (!pendingDestroyStarted_)
            {
                failure_ = "Pending-destroy call was not started";
                success_ = false;
                webview_.destroy();
                return false;
            }

            webview_.destroy();

            const std::future_status status =
                pendingDestroyResult_.wait_for(
                    std::chrono::seconds(2));

            bool rejected = false;

            if (status == std::future_status::ready)
            {
                try
                {
                    (void)pendingDestroyResult_.get();

                    if (failure_.empty())
                        failure_ = "Pending JS call resolved during WebView destroy";
                }
                catch (const nativeweb::Error& error)
                {
                    rejected =
                        error.code() == "webview_destroyed";

                    if (!rejected && failure_.empty())
                    {
                        failure_ =
                            std::string("Unexpected pending-call destroy error: ") +
                            error.code() + ": " + error.what();
                    }
                }
                catch (const std::exception& error)
                {
                    if (failure_.empty())
                    {
                        failure_ =
                            std::string("Unexpected pending-call destroy exception: ") +
                            error.what();
                    }
                }
            }
            else if (failure_.empty())
            {
                failure_ =
                    "Pending C++->JS future did not finish after WebView destroy";
            }

            success_ =
                success_ &&
                rejected &&
                failure_.empty();

            return rejected;
        });

        webview_.bind("test.done", [this](int result) {
            const VariantDict status = cppCallsStatus();

            const bool cppDone =
                AnyCast<bool>(status.find("done")->second);

            const bool cppSuccess =
                AnyCast<bool>(status.find("success")->second);

            success_ =
                result == 7 &&
                cppDone &&
                cppSuccess &&
                failure_.empty();

            if (!success_ && failure_.empty())
                failure_ = "Public WebView regression returned an unexpected result";

            return success_;
        });

        webview_.bind("test.fail", [this](const std::string& message) {
            std::cerr
                << "bridge-fail: "
                << message
                << std::endl;
            failure_ = message;
            success_ = false;
            webview_.destroy();
            return false;
        });
    }

    bool success() const { return success_; }
    const std::string& failure() const { return failure_; }

    void onCreated() override
    {
        browserThreadId_ = std::this_thread::get_id();
        browserThreadKnown_.store(true);

        if (
            webview_.engine() != nativeweb::Engine::WebView2 ||
            !webview_.capabilities().supports(nativeweb::Capability::Binary) ||
            !webview_.capabilities().supports(nativeweb::Capability::Events))
        {
            failure_ = "WebView2 engine/capability contract failed";
            success_ = false;
        }
    }

    void onLoadStarted(const std::string& source) override
    {
        std::cout << "load-start: " << source << std::endl;
    }

    void onLoadFinished(const std::string& source) override
    {
        std::cout << "load-finish: " << source << std::endl;
    }

    void onClosed() override
    {
        PostQuitMessage(0);
    }

private:
    void beginCppCalls()
    {
        if (cppCallsStarted_)
            return;

        cppSyncResult_ = webview_.execute<int>("ui.multiply", 6, 7);
        cppAsyncResult_ = webview_.execute<int>("ui.multiplyAsync", 6, 7);
        cppRejectResult_ = webview_.execute<int>("ui.rejectAsync");
        cppCallsStarted_ = true;
    }

    VariantDict cppCallsStatus()
    {
        VariantDict status;
        status["started"] = cppCallsStarted_;
        status["done"] = false;
        status["success"] = false;
        status["message"] = failure_;

        if (!cppCallsStarted_)
            return status;

        if (!cppCallsEvaluated_)
        {
            const std::future_status syncStatus =
                cppSyncResult_.wait_for(std::chrono::milliseconds(0));

            const std::future_status asyncStatus =
                cppAsyncResult_.wait_for(std::chrono::milliseconds(0));

            const std::future_status rejectStatus =
                cppRejectResult_.wait_for(std::chrono::milliseconds(0));

            if (
                syncStatus != std::future_status::ready ||
                asyncStatus != std::future_status::ready ||
                rejectStatus != std::future_status::ready)
            {
                return status;
            }

            bool syncSuccess = false;
            bool asyncSuccess = false;
            bool rejectSuccess = false;

            try
            {
                syncSuccess = cppSyncResult_.get() == 42;
            }
            catch (const std::exception& error)
            {
                failure_ =
                    std::string("C++ to sync JS call failed: ") +
                    error.what();
            }

            try
            {
                asyncSuccess = cppAsyncResult_.get() == 42;
            }
            catch (const std::exception& error)
            {
                failure_ =
                    std::string("C++ to async JS call failed: ") +
                    error.what();
            }

            try
            {
                (void)cppRejectResult_.get();

                if (failure_.empty())
                    failure_ = "Rejected JavaScript Promise resolved unexpectedly";
            }
            catch (const nativeweb::Error& error)
            {
                rejectSuccess =
                    error.code() == "js_promise_rejected" &&
                    std::string(error.what()).find(
                        "expected js rejection") != std::string::npos;

                if (!rejectSuccess && failure_.empty())
                {
                    failure_ =
                        std::string("Unexpected JavaScript rejection mapping: ") +
                        error.code() + ": " + error.what();
                }
            }
            catch (const std::exception& error)
            {
                if (failure_.empty())
                {
                    failure_ =
                        std::string("Unexpected C++ exception for JS rejection: ") +
                        error.what();
                }
            }

            cppCallsSuccess_ =
                syncSuccess &&
                asyncSuccess &&
                rejectSuccess &&
                failure_.empty();

            cppCallsEvaluated_ = true;
        }

        status["done"] = cppCallsEvaluated_;
        status["success"] = cppCallsSuccess_;
        status["message"] = failure_;
        return status;
    }

    nativeweb::WebView& webview_;
    bool success_;
    bool cppCallsStarted_;
    bool cppCallsEvaluated_;
    bool cppCallsSuccess_;
    bool pendingDestroyStarted_;
    std::future<int> cppSyncResult_;
    std::future<int> cppAsyncResult_;
    std::future<int> cppRejectResult_;
    std::future<int> pendingDestroyResult_;
    std::string failure_;

    std::thread::id browserThreadId_;
    std::atomic<bool> browserThreadKnown_;
    std::atomic<int> activeConcurrentCalls_;
    std::atomic<int> maxConcurrentCalls_;
};

LRESULT CALLBACK hostWindowProc(
    HWND window,
    UINT message,
    WPARAM wParam,
    LPARAM lParam)
{
    return DefWindowProcW(window, message, wParam, lParam);
}

HWND createHostWindow()
{
    const wchar_t* className =
        L"NativeWeb.WebView2.IntegrationHost";

    WNDCLASSW windowClass;
    ZeroMemory(&windowClass, sizeof(windowClass));

    windowClass.lpfnWndProc = &hostWindowProc;
    windowClass.hInstance = GetModuleHandleW(0);
    windowClass.lpszClassName = className;

    if (!RegisterClassW(&windowClass))
    {
        if (GetLastError() != ERROR_CLASS_ALREADY_EXISTS)
            return 0;
    }

    return CreateWindowExW(
        0,
        className,
        L"NativeWeb WebView2 Integration",
        WS_OVERLAPPEDWINDOW,
        CW_USEDEFAULT,
        CW_USEDEFAULT,
        800,
        600,
        0,
        0,
        GetModuleHandleW(0),
        0);
}

std::string getUrl(int argc, char* argv[])
{
    const std::string prefix = "--url=";

    for (int i = 1; i < argc; ++i)
    {
        const std::string value = argv[i];

        if (value.compare(0, prefix.size(), prefix) == 0)
            return value.substr(prefix.size());
    }

    return "about:blank";
}

} // namespace

int main(int argc, char* argv[])
{
    HWND window = createHostWindow();

    if (!window)
    {
        std::cerr << "Failed to create Win32 host window" << std::endl;
        return 2;
    }

    nativeweb::detail::registerWebView2BackendFactory();

    nativeweb::WebView webview;
    IntegrationListener listener(webview);
    webview.setListener(&listener);

    nativeweb::WebViewOptions options;
    options.engine = nativeweb::Engine::Auto;

    try
    {
        webview.create(
            reinterpret_cast<nativeweb::NativeWindowHandle>(window),
            getUrl(argc, argv),
            options);
    }
    catch (const std::exception& error)
    {
        std::cerr
            << "WebView2 create failed: "
            << error.what()
            << std::endl;

        DestroyWindow(window);
        return 3;
    }

    MSG message;

    while (GetMessageW(&message, 0, 0, 0) > 0)
    {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }

    DestroyWindow(window);

    if (!listener.success())
    {
        std::cerr << "NativeWeb WebView2 integration failed";

        if (!listener.failure().empty())
            std::cerr << ": " << listener.failure();

        std::cerr << std::endl;
        return 4;
    }

    std::cout
        << "NativeWeb WebView2 integration: PASS"
        << std::endl;

    return 0;
}
