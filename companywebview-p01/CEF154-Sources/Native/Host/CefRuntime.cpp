#include "CefRuntime.h"
#include "CefTextureHost.h"
#include "../include/CefTextureProbeApi.h"

#include <windows.h>
#include <fstream>
#include <string>

#include "include/cef_app.h"
#include "include/cef_browser.h"
#include "include/cef_command_line.h"
#include "include/cef_sandbox_win.h"

namespace {
bool g_initialized = false;
HMODULE g_libcef_module = nullptr;
bool g_adapter_override_enabled = false;
LUID g_adapter_override{};
LUID g_configured_adapter{};
bool g_configured_adapter_enabled = false;

bool FileExists(const std::wstring& path) {
    return GetFileAttributesW(path.c_str()) != INVALID_FILE_ATTRIBUTES;
}

void AppendRuntimeLog(const std::wstring& subprocess_path, const char* message) {
    if (subprocess_path.empty() || !message) return;
    std::wstring path = subprocess_path;
    const auto slash = path.find_last_of(L"\\/");
    if (slash != std::wstring::npos) path.resize(slash + 1); else path.clear();
    path += L"cef_native_init.log";
    std::ofstream out(path, std::ios::app);
    if (out) out << message << std::endl;
}

void AppendRuntimeLogPath(const std::wstring& subprocess_path,
                          const char* label,
                          const std::wstring& value) {
    if (subprocess_path.empty() || !label) return;
    std::wstring path = subprocess_path;
    const auto slash = path.find_last_of(L"\\/");
    if (slash != std::wstring::npos) path.resize(slash + 1); else path.clear();
    path += L"cef_native_init.log";

    int utf8_size = WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::string utf8;
    if (utf8_size > 1) {
        utf8.resize(static_cast<size_t>(utf8_size - 1));
        WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, utf8.data(), utf8_size, nullptr, nullptr);
    }

    std::ofstream out(path, std::ios::app);
    if (out) out << label << utf8 << std::endl;
}

class PrototypeCefApp : public CefApp, public CefBrowserProcessHandler {
public:
    CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override { return this; }
    void OnBeforeCommandLineProcessing(const CefString&, CefRefPtr<CefCommandLine> command_line) override {
        if (!g_configured_adapter_enabled) return;
        command_line->AppendSwitchWithValue("use-angle", "d3d11");
        const std::string luid = std::to_string(g_configured_adapter.HighPart) + "," + std::to_string(g_configured_adapter.LowPart);
        command_line->AppendSwitchWithValue("use-adapter-luid", luid);
    }
    IMPLEMENT_REFCOUNTING(PrototypeCefApp);
};

}

void AppendRuntimeLogValue(const std::wstring& subprocess_path, const char* label, unsigned long value) {
    if (subprocess_path.empty() || !label) return;
    std::wstring path = subprocess_path;
    const auto slash = path.find_last_of(L"\\/");
    if (slash != std::wstring::npos) path.resize(slash + 1); else path.clear();
    path += L"cef_native_init.log";
    std::ofstream out(path, std::ios::app);
    if (out) out << label << value << std::endl;
}

bool EnsureLibCefLoaded(const std::wstring& subprocess_path) {
    if (g_libcef_module) return true;

    const auto slash = subprocess_path.find_last_of(L"\\/");
    if (slash == std::wstring::npos) {
        AppendRuntimeLog(subprocess_path, "EnsureLibCefLoaded: invalid subprocess path");
        return false;
    }

    const std::wstring runtime_dir = subprocess_path.substr(0, slash);
    const std::wstring libcef_path = runtime_dir + L"\\libcef.dll";

    AppendRuntimeLog(subprocess_path, "EnsureLibCefLoaded: before LoadLibraryExW(libcef.dll)");
    SetLastError(ERROR_SUCCESS);
    g_libcef_module = LoadLibraryExW(
        libcef_path.c_str(),
        nullptr,
        LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);

    if (!g_libcef_module) {
        AppendRuntimeLogValue(subprocess_path, "EnsureLibCefLoaded: LoadLibraryExW failed, GetLastError=", GetLastError());
        return false;
    }

    AppendRuntimeLog(subprocess_path, "EnsureLibCefLoaded: success");
    return true;
}

void CefPrototypeSetAdapterLuidOverride(bool enabled, int32_t high, uint32_t low) {
    g_adapter_override_enabled = enabled; g_adapter_override.HighPart = high; g_adapter_override.LowPart = low;
}
void CefPrototypeGetConfiguredAdapterLuid(int32_t& high, uint32_t& low, bool& enabled) { high=g_configured_adapter.HighPart; low=g_configured_adapter.LowPart; enabled=g_configured_adapter_enabled; }

CefPrototypeResult CefPrototypeInitialize(const std::wstring& subprocess_path,
                                          const std::wstring& cache_path) {
    if (g_initialized) {
        return CefPrototypeResult::AlreadyInitialized;
    }
    if (subprocess_path.empty()) {
        return CefPrototypeResult::InvalidArgument;
    }

    AppendRuntimeLog(subprocess_path, "CefPrototypeInitialize: before explicit libcef preload");
    if (!EnsureLibCefLoaded(subprocess_path)) {
        return CefPrototypeResult::CefInitializeFailed;
    }

    AppendRuntimeLog(subprocess_path, "CefPrototypeInitialize: before CefMainArgs");
    CefMainArgs main_args(GetModuleHandle(nullptr));
    AppendRuntimeLog(subprocess_path, "CefPrototypeInitialize: before settings");

    // IMPORTANT: When a separate browser_subprocess_path is used, the browser
    // process does NOT call CefExecuteProcess(). CefExecuteProcess() belongs in
    // the dedicated subprocess executable's entry point. This matches CEF's
    // documented "Separate Sub-Process Executable" application structure.
    CefSettings settings;
    AppendRuntimeLog(subprocess_path, "CefPrototypeInitialize: CefSettings constructed");
    settings.no_sandbox = true; // Prototype only; product packaging must revisit sandboxing.
    AppendRuntimeLog(subprocess_path, "CefPrototypeInitialize: no_sandbox set");
    settings.windowless_rendering_enabled = true;
    AppendRuntimeLog(subprocess_path, "CefPrototypeInitialize: windowless_rendering_enabled set");

    // Unity already owns the application message loop. Keep the CEF browser UI
    // thread on Unity's main thread and pump it explicitly via CefDoMessageLoopWork.
    // This avoids a second browser UI thread touching Unity's D3D11 immediate
    // context and gives deterministic shutdown ordering for the prototype.
    settings.multi_threaded_message_loop = false;
    AppendRuntimeLog(subprocess_path, "CefPrototypeInitialize: multi_threaded_message_loop set");
    settings.external_message_pump = false;
    AppendRuntimeLog(subprocess_path, "CefPrototypeInitialize: external_message_pump set");

    AppendRuntimeLog(subprocess_path, "CefPrototypeInitialize: before browser_subprocess_path CefString");
    CefString(&settings.browser_subprocess_path) = subprocess_path;
    AppendRuntimeLog(subprocess_path, "CefPrototypeInitialize: browser_subprocess_path set");

    // Keep the prototype runtime self-contained beside the subprocess EXE.
    // Unity's browser process is Unity.exe, so relying on CEF's executable-dir
    // defaults would otherwise resolve resources relative to the Unity editor/player.
    const auto slash = subprocess_path.find_last_of(L"\\/");
    if (slash != std::wstring::npos) {
        const std::wstring runtime_dir = subprocess_path.substr(0, slash);
        AppendRuntimeLog(subprocess_path, "CefPrototypeInitialize: validating required runtime files");
        const std::wstring required[] = {
            runtime_dir + L"\\icudtl.dat",
            runtime_dir + L"\\resources.pak",
            runtime_dir + L"\\chrome_100_percent.pak",
            runtime_dir + L"\\locales\\en-US.pak",
            subprocess_path
        };
        for (const auto& p : required) {
            if (!FileExists(p)) {
                AppendRuntimeLog(subprocess_path, "CefPrototypeInitialize: required runtime file missing");
                AppendRuntimeLogPath(subprocess_path, "CefPrototypeInitialize: missing path=", p);
                return CefPrototypeResult::CefInitializeFailed;
            }
        }
        AppendRuntimeLog(subprocess_path, "CefPrototypeInitialize: before resource paths");
        CefString(&settings.resources_dir_path) = runtime_dir;
        CefString(&settings.locales_dir_path) = runtime_dir + L"\\locales";
        CefString(&settings.log_file) = runtime_dir + L"\\cef_debug.log";
        settings.log_severity = LOGSEVERITY_INFO;
        AppendRuntimeLog(subprocess_path, "CefPrototypeInitialize: resource/log paths set");
    }

    if (!cache_path.empty()) {
        AppendRuntimeLog(subprocess_path, "CefPrototypeInitialize: before root/cache paths");
        CefString(&settings.root_cache_path) = cache_path;
        CefString(&settings.cache_path) = cache_path + L"\\Default";
        AppendRuntimeLog(subprocess_path, "CefPrototypeInitialize: root/cache paths set");
    }

    auto gpuDiag = CefTextureProbe_GetGpuAdapterDiagnostics();
    g_configured_adapter_enabled = true;
    if (g_adapter_override_enabled) g_configured_adapter = g_adapter_override;
    else { g_configured_adapter.HighPart = gpuDiag.unity_luid_high; g_configured_adapter.LowPart = gpuDiag.unity_luid_low; }
    CefRefPtr<PrototypeCefApp> app = new PrototypeCefApp();
    AppendRuntimeLog(subprocess_path, "CefPrototypeInitialize: before CefInitialize");
    if (!CefInitialize(main_args, settings, app, nullptr)) {
        AppendRuntimeLog(subprocess_path, "CefPrototypeInitialize: CefInitialize returned false");
        return CefPrototypeResult::CefInitializeFailed;
    }
    AppendRuntimeLog(subprocess_path, "CefPrototypeInitialize: CefInitialize success");
    g_initialized = true;
    return CefPrototypeResult::Ok;
}

CefPrototypeResult CefPrototypeCreateBrowser(const std::string& url,
                                             int width,
                                             int height,
                                             int target_frame_rate,
                                             bool external_begin_frame_enabled,
                                             CefRefPtr<CefTextureHost>& host,
                                             uint64_t surface_id,
                                             CefRefPtr<CefRequestContext> request_context) {
    if (!g_initialized || width <= 0 || height <= 0) {
        return CefPrototypeResult::InvalidArgument;
    }

    host = new CefTextureHost(width, height, surface_id);

    CefWindowInfo window_info;
    window_info.SetAsWindowless(nullptr);
    window_info.shared_texture_enabled = true;
    window_info.external_begin_frame_enabled = external_begin_frame_enabled;

    CefBrowserSettings browser_settings;
    browser_settings.windowless_frame_rate = target_frame_rate;
    browser_settings.background_color = CefColorSetARGB(255, 255, 255, 255);

    const bool created = CefBrowserHost::CreateBrowser(
        window_info, host, url, browser_settings, nullptr, request_context);
    return created ? CefPrototypeResult::Ok
                   : CefPrototypeResult::BrowserCreateFailed;
}

void CefPrototypeDoMessageLoopWork() {
    if (g_initialized) {
        CefDoMessageLoopWork();
    }
}

void CefPrototypeShutdown() {
    if (!g_initialized) {
        return;
    }
    CefShutdown();
    g_initialized = false;
    if (g_libcef_module) {
        FreeLibrary(g_libcef_module);
        g_libcef_module = nullptr;
    }
}
