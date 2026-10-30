#include "../include/CefPrototypeApi.h"
#include "CefRuntime.h"
#include "CefTextureHost.h"

#include <windows.h>
#include <atomic>
#include <algorithm>
#include <cstring>
#include <fstream>
#include <mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "include/cef_request_context.h"

namespace {
std::mutex g_api_mutex;
CefRefPtr<CefTextureHost> g_host; // legacy
std::unordered_map<uint64_t, CefRefPtr<CefTextureHost>> g_hosts;
std::unordered_map<uint64_t, uint64_t> g_surface_by_host;
std::atomic<uint64_t> g_next_host_handle{1};
std::unordered_map<uint64_t, CefRefPtr<CefRequestContext>> g_profiles;
std::atomic<uint64_t> g_next_profile_handle{1};

void AppendNativeLog(const wchar_t* subprocess_path, const char* message) {
    if (!subprocess_path || !*subprocess_path || !message) return;
    std::wstring path(subprocess_path);
    const auto slash = path.find_last_of(L"\\/");
    if (slash != std::wstring::npos) path.resize(slash + 1); else path.clear();
    path += L"cef_native_init.log";
    std::ofstream out(path, std::ios::app);
    if (out) out << message << std::endl;
}

int32_t ToStatus(CefPrototypeResult result) {
    switch (result) {
        case CefPrototypeResult::Ok: return CEF_PROTO_OK;
        case CefPrototypeResult::AlreadyInitialized: return CEF_PROTO_ALREADY_INITIALIZED;
        case CefPrototypeResult::InvalidArgument: return CEF_PROTO_INVALID_ARGUMENT;
        case CefPrototypeResult::CefInitializeFailed: return CEF_PROTO_INITIALIZE_FAILED;
        case CefPrototypeResult::BrowserCreateFailed: return CEF_PROTO_BROWSER_CREATE_FAILED;
        default: return CEF_PROTO_INITIALIZE_FAILED;
    }
}

CefRefPtr<CefTextureHost> FindHost(uint64_t handle) {
    std::lock_guard<std::mutex> lock(g_api_mutex);
    const auto it = g_hosts.find(handle);
    return it == g_hosts.end() ? nullptr : it->second;
}

uint64_t FindSurfaceId(uint64_t handle) {
    std::lock_guard<std::mutex> lock(g_api_mutex);
    const auto it = g_surface_by_host.find(handle);
    return it == g_surface_by_host.end() ? 0 : it->second;
}

void RemoveHost(uint64_t handle) {
    uint64_t surface_id = 0;
    {
        std::lock_guard<std::mutex> lock(g_api_mutex);
        const auto s = g_surface_by_host.find(handle);
        if (s != g_surface_by_host.end()) {
            surface_id = s->second;
            g_surface_by_host.erase(s);
        }
        g_hosts.erase(handle);
    }
    if (surface_id != 0) CefTextureProbe_DestroySurface(surface_id);
}
}

extern "C" {

// Keep RPC exports distinct; an old native cache cannot accidentally claim support.
CEF_PROTO_API uint32_t CWV_Bridge_Version() { return 2; }
CEF_PROTO_API int32_t CWV_Bridge_Open(uint64_t handle, const uint8_t* url, uint32_t bytes, uint32_t version) {
    if (version != 2 || !url || bytes == 0 || bytes > 4096) return -1;
    CefRefPtr<CefTextureHost> host;
    if (handle == 0) { std::lock_guard<std::mutex> lock(g_api_mutex); host = g_host; }
    else host = FindHost(handle);
    return host ? host->BridgeOpen(std::string(reinterpret_cast<const char*>(url), bytes)) : -2;
}
CEF_PROTO_API int32_t CWV_Bridge_Peek(uint64_t handle, uint32_t* bytes) {
    CefRefPtr<CefTextureHost> host;
    if (handle == 0) { std::lock_guard<std::mutex> lock(g_api_mutex); host = g_host; }
    else host = FindHost(handle);
    return host ? host->BridgePeek(bytes) : -2;
}
CEF_PROTO_API int32_t CWV_Bridge_Read(uint64_t handle, uint8_t* dst, uint32_t cap, uint32_t* bytes) {
    CefRefPtr<CefTextureHost> host;
    if (handle == 0) { std::lock_guard<std::mutex> lock(g_api_mutex); host = g_host; }
    else host = FindHost(handle);
    return host ? host->BridgeRead(dst, cap, bytes) : -2;
}
CEF_PROTO_API int32_t CWV_Bridge_Complete(uint64_t handle, uint64_t id, uint32_t nav,
    const uint8_t* data, uint32_t count, int32_t error) {
    CefRefPtr<CefTextureHost> host;
    if (handle == 0) { std::lock_guard<std::mutex> lock(g_api_mutex); host = g_host; }
    else host = FindHost(handle);
    return host ? host->BridgeComplete(id, nav, data, count, error != 0) : -2;
}
CEF_PROTO_API uint32_t CWV_Bridge_Generation(uint64_t handle) {
    CefRefPtr<CefTextureHost> host;
    if (handle == 0) { std::lock_guard<std::mutex> lock(g_api_mutex); host = g_host; }
    else host = FindHost(handle);
    return host ? host->BridgeGeneration() : 0;
}

CEF_PROTO_API int32_t CWV_Bridge_Dispatch(uint64_t handle, const uint8_t* json, uint32_t count) {
    if (!json || count == 0 || count > 65536) return -1;
    CefRefPtr<CefTextureHost> host;
    if (handle == 0) { std::lock_guard<std::mutex> lock(g_api_mutex); host = g_host; }
    else host = FindHost(handle);
    return host ? host->BridgeDispatch(std::string(reinterpret_cast<const char*>(json), count)) : -2;
}
CEF_PROTO_API int32_t CWV_Bridge_CancelOutbound(uint64_t handle, const uint8_t* data, uint32_t count) {
    if (!data || count == 0 || count > 20) return -1;
    CefRefPtr<CefTextureHost> host;
    if (handle == 0) { std::lock_guard<std::mutex> lock(g_api_mutex); host = g_host; }
    else host = FindHost(handle);
    return host ? host->BridgeCancelOutbound(std::string(reinterpret_cast<const char*>(data), count)) : -2;
}
CEF_PROTO_API int32_t CWV_Bridge_ResultPeek(uint64_t handle, uint32_t* count) {
    CefRefPtr<CefTextureHost> host;
    if (handle == 0) { std::lock_guard<std::mutex> lock(g_api_mutex); host = g_host; }
    else host = FindHost(handle);
    return host ? host->BridgeResultPeek(count) : -2;
}
CEF_PROTO_API int32_t CWV_Bridge_ResultRead(uint64_t handle, uint8_t* dst, uint32_t cap, uint32_t* count) {
    CefRefPtr<CefTextureHost> host;
    if (handle == 0) { std::lock_guard<std::mutex> lock(g_api_mutex); host = g_host; }
    else host = FindHost(handle);
    return host ? host->BridgeResultRead(dst, cap, count) : -2;
}

CEF_PROTO_API void CefPrototype_SetAdapterLuidOverride(int32_t enabled, int32_t high, uint32_t low) { CefPrototypeSetAdapterLuidOverride(enabled != 0, high, low); }
CEF_PROTO_API void CefPrototype_GetConfiguredAdapterLuid(int32_t* high, uint32_t* low, int32_t* enabled) { int32_t h=0; uint32_t l=0; bool e=false; CefPrototypeGetConfiguredAdapterLuid(h,l,e); if(high)*high=h; if(low)*low=l; if(enabled)*enabled=e?1:0; }

CEF_PROTO_API int32_t CefPrototype_Initialize(
    const wchar_t* subprocess_path, const wchar_t* cache_path) {
    if (!subprocess_path || !*subprocess_path) return CEF_PROTO_INVALID_ARGUMENT;
    AppendNativeLog(subprocess_path, "CefPrototype_Initialize: enter");
    const auto result = CefPrototypeInitialize(
        subprocess_path, cache_path ? cache_path : L"");
    AppendNativeLog(subprocess_path, result == CefPrototypeResult::Ok ?
        "CefPrototype_Initialize: success" : "CefPrototype_Initialize: completed");
    return ToStatus(result);
}


CEF_PROTO_API uint64_t CefPrototype_CreateProfile(const wchar_t* cache_path) {
    CefRequestContextSettings settings;
    if (cache_path && *cache_path) {
        CefString(&settings.cache_path) = cache_path;
        settings.persist_session_cookies = true;
    }
    auto context = CefRequestContext::CreateContext(settings, nullptr);
    if (!context) return 0;
    const uint64_t handle = g_next_profile_handle.fetch_add(1, std::memory_order_acq_rel);
    std::lock_guard<std::mutex> lock(g_api_mutex);
    g_profiles.emplace(handle, context);
    return handle;
}

CEF_PROTO_API int32_t CefPrototype_DestroyProfile(uint64_t profile_handle) {
    if (profile_handle == 0) return CEF_PROTO_INVALID_ARGUMENT;
    std::lock_guard<std::mutex> lock(g_api_mutex);
    const auto it = g_profiles.find(profile_handle);
    if (it == g_profiles.end()) return CEF_PROTO_PROFILE_NOT_FOUND;
    g_profiles.erase(it);
    return CEF_PROTO_OK;
}

CEF_PROTO_API int32_t CefPrototype_CreateBrowserWithProfile(
    const char* url, int32_t width, int32_t height,
    int32_t target_frame_rate, int32_t external_begin_frame_enabled,
    uint64_t profile_handle) {
    if (!url || !*url || width <= 0 || height <= 0 || target_frame_rate <= 0 || profile_handle == 0)
        return CEF_PROTO_INVALID_ARGUMENT;
    std::lock_guard<std::mutex> lock(g_api_mutex);
    const auto it = g_profiles.find(profile_handle);
    if (it == g_profiles.end()) return CEF_PROTO_PROFILE_NOT_FOUND;
    return ToStatus(CefPrototypeCreateBrowser(
        url, width, height, target_frame_rate, external_begin_frame_enabled != 0,
        g_host, 0, it->second));
}

// Legacy API
CEF_PROTO_API int32_t CefPrototype_CreateBrowser(
    const char* url, int32_t width, int32_t height,
    int32_t target_frame_rate, int32_t external_begin_frame_enabled) {
    if (!url || !*url || width <= 0 || height <= 0 || target_frame_rate <= 0)
        return CEF_PROTO_INVALID_ARGUMENT;
    std::lock_guard<std::mutex> lock(g_api_mutex);
    return ToStatus(CefPrototypeCreateBrowser(
        url, width, height, target_frame_rate,
        external_begin_frame_enabled != 0, g_host, 0));
}
CEF_PROTO_API void CefPrototype_SendExternalBeginFrame() {
    std::lock_guard<std::mutex> lock(g_api_mutex);
    if (g_host) g_host->SendExternalBeginFrame();
}
CEF_PROTO_API void CefPrototype_Invalidate() {
    std::lock_guard<std::mutex> lock(g_api_mutex);
    if (g_host) g_host->Invalidate();
}
CEF_PROTO_API int32_t CefPrototype_GetWindowlessFrameRate() {
    std::lock_guard<std::mutex> lock(g_api_mutex);
    return g_host ? g_host->GetWindowlessFrameRate() : 0;
}
CEF_PROTO_API void CefPrototype_Resize(int32_t width, int32_t height) {
    std::lock_guard<std::mutex> lock(g_api_mutex);
    if (g_host) g_host->Resize(width, height);
}
CEF_PROTO_API void CefPrototype_LoadUrl(const char* url) {
    if (!url) return;
    std::lock_guard<std::mutex> lock(g_api_mutex);
    if (g_host) g_host->LoadUrl(url);
}
CEF_PROTO_API void CefPrototype_CloseBrowser() {
    std::lock_guard<std::mutex> lock(g_api_mutex);
    if (g_host) g_host->Close();
}
CEF_PROTO_API int32_t CefPrototype_CloseBrowserAndWait(int32_t timeout_ms) {
    if (timeout_ms < 0) return CEF_PROTO_INVALID_ARGUMENT;
    {
        std::lock_guard<std::mutex> lock(g_api_mutex);
        if (!g_host) return CEF_PROTO_OK;
        if (!g_host->IsClosed()) g_host->Close();
    }
    const ULONGLONG deadline = GetTickCount64() + static_cast<ULONGLONG>(timeout_ms);
    while (true) {
        CefPrototypeDoMessageLoopWork();
        {
            std::lock_guard<std::mutex> lock(g_api_mutex);
            if (!g_host || g_host->IsClosed()) {
                g_host = nullptr;
                return CEF_PROTO_OK;
            }
        }
        if (GetTickCount64() >= deadline) return CEF_PROTO_BROWSER_STILL_CLOSING;
        Sleep(1);
    }
}
CEF_PROTO_API int32_t CefPrototype_IsBrowserClosed() {
    std::lock_guard<std::mutex> lock(g_api_mutex);
    return (!g_host || g_host->IsClosed()) ? 1 : 0;
}

// Multi-host API
CEF_PROTO_API uint64_t CefPrototype_CreateBrowserHandle(
    const char* url, int32_t width, int32_t height,
    int32_t target_frame_rate, int32_t external_begin_frame_enabled) {
    if (!url || !*url || width <= 0 || height <= 0 || target_frame_rate <= 0)
        return 0;

    const uint64_t surface_id = CefTextureProbe_CreateSurface();
    if (surface_id == 0) return 0;

    CefRefPtr<CefTextureHost> host;
    const auto result = CefPrototypeCreateBrowser(
        url, width, height, target_frame_rate,
        external_begin_frame_enabled != 0, host, surface_id);
    if (result != CefPrototypeResult::Ok || !host) {
        CefTextureProbe_DestroySurface(surface_id);
        return 0;
    }

    const uint64_t handle = g_next_host_handle.fetch_add(1, std::memory_order_acq_rel);
    {
        std::lock_guard<std::mutex> lock(g_api_mutex);
        g_hosts.emplace(handle, host);
        g_surface_by_host.emplace(handle, surface_id);
    }
    return handle;
}

CEF_PROTO_API int32_t CefPrototype_CloseBrowserHandleAndWait(
    uint64_t host_handle, int32_t timeout_ms) {
    if (host_handle == 0 || timeout_ms < 0) return CEF_PROTO_INVALID_ARGUMENT;
    auto host = FindHost(host_handle);
    if (!host) return CEF_PROTO_HOST_NOT_FOUND;
    const ULONGLONG deadline = GetTickCount64() + static_cast<ULONGLONG>(timeout_ms);
    // CreateBrowser is asynchronous. Closing before OnAfterCreated can mark a host
    // closed while CEF still holds the pending CreateBrowser callback, leaking a browser.
    while (!host->IsCreated() && !host->IsClosed()) {
        CefPrototypeDoMessageLoopWork();
        if (GetTickCount64() >= deadline) return CEF_PROTO_BROWSER_STILL_CLOSING;
        Sleep(1);
    }
    if (!host->IsClosed()) host->Close();
    while (true) {
        CefPrototypeDoMessageLoopWork();
        host = FindHost(host_handle);
        if (!host || host->IsClosed()) {
            RemoveHost(host_handle);
            return CEF_PROTO_OK;
        }
        if (GetTickCount64() >= deadline) return CEF_PROTO_BROWSER_STILL_CLOSING;
        Sleep(1);
    }
}

CEF_PROTO_API void CefPrototype_ResizeHandle(
    uint64_t host_handle, int32_t width, int32_t height) {
    auto host = FindHost(host_handle);
    if (host) host->Resize(width, height);
}
CEF_PROTO_API void CefPrototype_LoadUrlHandle(uint64_t host_handle, const char* url) {
    if (!url) return;
    auto host = FindHost(host_handle);
    if (host) host->LoadUrl(url);
}
CEF_PROTO_API int32_t CefPrototype_IsBrowserClosedHandle(uint64_t host_handle) {
    auto host = FindHost(host_handle);
    return (!host || host->IsClosed()) ? 1 : 0;
}
CEF_PROTO_API int32_t CefPrototype_IsBrowserReadyHandle(uint64_t host_handle) {
    auto host = FindHost(host_handle);
    return (host && host->IsCreated() && !host->IsClosed()) ? 1 : 0;
}
CEF_PROTO_API int32_t CefPrototype_GetWindowlessFrameRateHandle(uint64_t host_handle) {
    auto host = FindHost(host_handle);
    return host ? host->GetWindowlessFrameRate() : 0;
}
CEF_PROTO_API void* CefPrototype_GetUnityTextureHandle(uint64_t host_handle) {
    const uint64_t surface_id = FindSurfaceId(host_handle);
    return surface_id ? CefTextureProbe_GetUnityTextureForSurface(surface_id) : nullptr;
}
CEF_PROTO_API CefTextureProbeStats CefPrototype_GetTextureStatsHandle(uint64_t host_handle) {
    const uint64_t surface_id = FindSurfaceId(host_handle);
    if (!surface_id) {
        CefTextureProbeStats stats{};
        stats.last_status = CEF_TEX_SURFACE_NOT_FOUND;
        return stats;
    }
    return CefTextureProbe_GetStatsForSurface(surface_id);
}
// Per-handle navigation uses independent CefTextureHost objects; no legacy g_host routing.
CEF_PROTO_API void CefPrototype_CompatibilityReloadHandle(uint64_t host_handle) {
    auto host=FindHost(host_handle); if(host)host->ReloadPage();
}
CEF_PROTO_API void CefPrototype_CompatibilityStopHandle(uint64_t host_handle) {
    auto host=FindHost(host_handle); if(host)host->StopLoad();
}
CEF_PROTO_API void CefPrototype_CompatibilityGoBackHandle(uint64_t host_handle) {
    auto host=FindHost(host_handle); if(host)host->GoBack();
}
CEF_PROTO_API void CefPrototype_CompatibilityGoForwardHandle(uint64_t host_handle) {
    auto host=FindHost(host_handle); if(host)host->GoForward();
}

CEF_PROTO_API int32_t CefPrototype_GetHostCount() {
    std::lock_guard<std::mutex> lock(g_api_mutex);
    return static_cast<int32_t>(g_hosts.size());
}

// Multi-host interaction: route every event by explicit browser handle, never g_host.
CEF_PROTO_API void CefPrototype_InteractionSetFocusHandle(uint64_t h,int32_t focused) {
    auto host=FindHost(h); if(host)host->SetFocus(focused!=0);
}
CEF_PROTO_API void CefPrototype_InteractionMouseMoveHandle(uint64_t h,int32_t x,int32_t y,int32_t leave) {
    auto host=FindHost(h); if(host)host->SendMouseMove(x,y,leave!=0);
}
CEF_PROTO_API void CefPrototype_InteractionMouseClickHandle(uint64_t h,int32_t x,int32_t y,int32_t button,int32_t up,int32_t count) {
    auto host=FindHost(h); if(host)host->SendMouseClick(x,y,button,up!=0,count);
}
CEF_PROTO_API void CefPrototype_InteractionMouseWheelHandle(uint64_t h,int32_t x,int32_t y,int32_t dx,int32_t dy) {
    auto host=FindHost(h); if(host)host->SendMouseWheel(x,y,dx,dy);
}
CEF_PROTO_API void CefPrototype_InteractionSendKeyHandle(uint64_t h,int32_t key,int32_t up) {
    auto host=FindHost(h); if(host)host->SendKey(key,up!=0);
}
CEF_PROTO_API void CefPrototype_InteractionSendCharHandle(uint64_t h,uint32_t ch) {
    auto host=FindHost(h); if(host)host->SendChar(static_cast<uint16_t>(ch));
}
CEF_PROTO_API void CefPrototype_InteractionImeSetCompositionHandle(uint64_t h,const wchar_t* text) {
    auto host=FindHost(h); if(host)host->ImeSetCompositionText(text ? std::wstring(text) : std::wstring());
}
CEF_PROTO_API void CefPrototype_InteractionImeCommitTextHandle(uint64_t h,const wchar_t* text) {
    auto host=FindHost(h); if(host && text)host->ImeCommitTextValue(std::wstring(text));
}
CEF_PROTO_API void CefPrototype_InteractionImeFinishHandle(uint64_t h) {
    auto host=FindHost(h); if(host)host->ImeFinish();
}
CEF_PROTO_API void CefPrototype_InteractionImeCancelHandle(uint64_t h) {
    auto host=FindHost(h); if(host)host->ImeCancel();
}
CEF_PROTO_API void CefPrototype_InteractionTouchTapHandle(uint64_t h,int32_t x,int32_t y) {
    auto host=FindHost(h); if(host)host->SendTouchTap(x,y);
}

CEF_PROTO_API void CefPrototype_InteractionSetFocus(int32_t focused){ std::lock_guard<std::mutex> lock(g_api_mutex); if(g_host) g_host->SetFocus(focused!=0); }
CEF_PROTO_API void CefPrototype_InteractionMouseMove(int32_t x,int32_t y,int32_t leave){ std::lock_guard<std::mutex> lock(g_api_mutex); if(g_host) g_host->SendMouseMove(x,y,leave!=0); }
CEF_PROTO_API void CefPrototype_InteractionMouseClick(int32_t x,int32_t y,int32_t button,int32_t up,int32_t count){ std::lock_guard<std::mutex> lock(g_api_mutex); if(g_host) g_host->SendMouseClick(x,y,button,up!=0,count); }
CEF_PROTO_API void CefPrototype_InteractionMouseWheel(int32_t x,int32_t y,int32_t dx,int32_t dy){ std::lock_guard<std::mutex> lock(g_api_mutex); if(g_host) g_host->SendMouseWheel(x,y,dx,dy); }
CEF_PROTO_API void CefPrototype_InteractionSendKey(int32_t key,int32_t up){ std::lock_guard<std::mutex> lock(g_api_mutex); if(g_host) g_host->SendKey(key,up!=0); }
CEF_PROTO_API void CefPrototype_InteractionSendChar(uint32_t ch){ std::lock_guard<std::mutex> lock(g_api_mutex); if(g_host) g_host->SendChar((uint16_t)ch); }
CEF_PROTO_API void CefPrototype_InteractionImeSetComposition(const wchar_t* text){ std::lock_guard<std::mutex> lock(g_api_mutex); if(g_host) g_host->ImeSetCompositionText(text?std::wstring(text):std::wstring()); }
CEF_PROTO_API void CefPrototype_InteractionImeCommitText(const wchar_t* text){ std::lock_guard<std::mutex> lock(g_api_mutex); if(g_host&&text) g_host->ImeCommitTextValue(std::wstring(text)); }
CEF_PROTO_API void CefPrototype_InteractionImeFinish(){ std::lock_guard<std::mutex> lock(g_api_mutex); if(g_host) g_host->ImeFinish(); }
CEF_PROTO_API void CefPrototype_InteractionImeCancel(){ std::lock_guard<std::mutex> lock(g_api_mutex); if(g_host) g_host->ImeCancel(); }
CEF_PROTO_API void CefPrototype_InteractionTouchTap(int32_t x,int32_t y){ std::lock_guard<std::mutex> lock(g_api_mutex); if(g_host) g_host->SendTouchTap(x,y); }

CEF_PROTO_API void CefPrototype_CompatibilityConfigurePaths(
    const wchar_t* download_path, const wchar_t* upload_path) {
    CefRefPtr<CefTextureHost> host;
    { std::lock_guard<std::mutex> lock(g_api_mutex); host = g_host; }
    if (host) host->ConfigureCompatibilityPaths(
        download_path ? std::wstring(download_path) : std::wstring(),
        upload_path ? std::wstring(upload_path) : std::wstring());
}
CEF_PROTO_API void CefPrototype_SetMediaPermissionPolicy(int32_t policy) {
    CefRefPtr<CefTextureHost> host;
    { std::lock_guard<std::mutex> lock(g_api_mutex); host = g_host; }
    if (host) host->SetMediaPermissionPolicy(policy);
}

CEF_PROTO_API CefCompatibilityStats CefPrototype_GetCompatibilityStats() {
    CefCompatibilityStats o{};
    CefRefPtr<CefTextureHost> host;
    { std::lock_guard<std::mutex> lock(g_api_mutex); host = g_host; }
    if (!host) return o;
    host->GetCompatibilityStats(
        o.before_browse,o.redirect,o.address_change,
        o.load_start,o.load_end,o.load_error,o.is_loading,o.can_back,o.can_forward,
        o.popup_requested,o.popup_canceled,
        o.download_before,o.download_complete,o.download_canceled,
        o.file_dialog,o.file_dialog_completed,
        o.js_alert,o.js_confirm,o.js_prompt,
        o.media_permission,o.render_terminated,o.devtools_probe_id,
        o.page_code,o.page_cookie,o.page_local_storage,o.page_session_storage,
        o.page_popup,o.page_dialog,o.page_upload,o.page_media_denied,
        o.page_webrtc,o.page_media_element);
    return o;
}
CEF_PROTO_API void CefPrototype_CompatibilityReload(){
    CefRefPtr<CefTextureHost> h; {std::lock_guard<std::mutex> lock(g_api_mutex);h=g_host;} if(h)h->ReloadPage();
}
CEF_PROTO_API void CefPrototype_CompatibilityStop(){
    CefRefPtr<CefTextureHost> h; {std::lock_guard<std::mutex> lock(g_api_mutex);h=g_host;} if(h)h->StopLoad();
}
CEF_PROTO_API void CefPrototype_CompatibilityGoBack(){
    CefRefPtr<CefTextureHost> h; {std::lock_guard<std::mutex> lock(g_api_mutex);h=g_host;} if(h)h->GoBack();
}
CEF_PROTO_API void CefPrototype_CompatibilityGoForward(){
    CefRefPtr<CefTextureHost> h; {std::lock_guard<std::mutex> lock(g_api_mutex);h=g_host;} if(h)h->GoForward();
}

CEF_PROTO_API int32_t CefPrototype_ExecuteDevToolsMethod(const char* method) {
    if (!method || !*method) return 0;
    CefRefPtr<CefTextureHost> h;
    { std::lock_guard<std::mutex> lock(g_api_mutex); h = g_host; }
    return h ? h->ExecuteDevToolsMethod(method) : 0;
}

static int32_t CopyTitleUtf8(CefRefPtr<CefTextureHost> host, char* buffer, int32_t capacity) {
    if (!host || !buffer || capacity <= 0) return 0;
    const std::string title = host->GetTitle();
    const int32_t count = static_cast<int32_t>((std::min)(title.size(), static_cast<size_t>(capacity - 1)));
    if (count > 0) memcpy(buffer, title.data(), static_cast<size_t>(count));
    buffer[count] = '\0';
    return count;
}

CEF_PROTO_API int32_t CefPrototype_GetTitleUtf8(char* buffer, int32_t capacity) {
    CefRefPtr<CefTextureHost> h;
    { std::lock_guard<std::mutex> lock(g_api_mutex); h = g_host; }
    return CopyTitleUtf8(h, buffer, capacity);
}

CEF_PROTO_API int32_t CefPrototype_GetTitleUtf8Handle(uint64_t host_handle, char* buffer, int32_t capacity) {
    return CopyTitleUtf8(FindHost(host_handle), buffer, capacity);
}

CEF_PROTO_API void CefPrototype_DoMessageLoopWork() {
    CefPrototypeDoMessageLoopWork();
}

CEF_PROTO_API int32_t CefPrototype_ShutdownBlocking(int32_t timeout_ms) {
    if (timeout_ms < 0) return CEF_PROTO_INVALID_ARGUMENT;

    // Request all browsers (new handle API + legacy host) to close first.
    {
        std::lock_guard<std::mutex> lock(g_api_mutex);
        if (g_host && !g_host->IsClosed()) g_host->Close();
        // A host can still be pending the asynchronous OnAfterCreated callback.
        // Do not call Close() on an uncreated host. It will be closed below once ready.
    }

    std::unordered_set<uint64_t> close_requested;
    const ULONGLONG deadline = GetTickCount64() + static_cast<ULONGLONG>(timeout_ms);
    while (true) {
        CefPrototypeDoMessageLoopWork();
        bool all_closed = true;
        std::vector<CefRefPtr<CefTextureHost>> ready_to_close;
        {
            std::lock_guard<std::mutex> lock(g_api_mutex);
            if (g_host && !g_host->IsClosed()) all_closed = false;
            for (const auto& kv : g_hosts) {
                auto& host = kv.second;
                if (!host || host->IsClosed()) continue;
                all_closed = false;
                if (host->IsCreated() && close_requested.insert(kv.first).second)
                    ready_to_close.push_back(host);
            }
        }
        // Never hold the host-map lock while invoking client callbacks.
        for (const auto& host : ready_to_close) host->Close();
        if (all_closed) break;
        if (GetTickCount64() >= deadline) return CEF_PROTO_BROWSER_STILL_CLOSING;
        Sleep(1);
    }

    std::vector<uint64_t> surfaces;
    {
        std::lock_guard<std::mutex> lock(g_api_mutex);
        g_host = nullptr;
        for (const auto& kv : g_surface_by_host) surfaces.push_back(kv.second);
        g_hosts.clear();
        g_surface_by_host.clear();
        g_profiles.clear();
    }
    for (const auto surface : surfaces) CefTextureProbe_DestroySurface(surface);

    CefPrototypeShutdown();
    CefTextureProbe_Shutdown();
    return CEF_PROTO_OK;
}

}
