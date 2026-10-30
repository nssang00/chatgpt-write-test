#pragma once
#include <stdint.h>
#include "CefTextureProbeApi.h"

#ifdef _WIN32
  #ifdef CEF_TEXTURE_PROBE_EXPORTS
    #define CEF_PROTO_API __declspec(dllexport)
  #else
    #define CEF_PROTO_API __declspec(dllimport)
  #endif
#else
  #define CEF_PROTO_API
#endif

extern "C" {

struct CefCompatibilityStats {
    int32_t before_browse, redirect, address_change;
    int32_t load_start, load_end, load_error, is_loading, can_back, can_forward;
    int32_t popup_requested, popup_canceled;
    int32_t download_before, download_complete, download_canceled;
    int32_t file_dialog, file_dialog_completed;
    int32_t js_alert, js_confirm, js_prompt;
    int32_t media_permission, render_terminated, devtools_probe_id;
    int32_t page_code, page_cookie, page_local_storage, page_session_storage;
    int32_t page_popup, page_dialog, page_upload, page_media_denied;
    int32_t page_webrtc, page_media_element;
};

struct CefInteractionStats {
    int32_t mouse_move, mouse_down, mouse_up, wheel, key_down, key_up, input, focus, touch, text_ok, drag;
    int32_t composition_start, composition_update, composition_end;
};


enum CefPrototypeStatus : int32_t {
    CEF_PROTO_OK = 0,
    CEF_PROTO_ALREADY_INITIALIZED = 1,
    CEF_PROTO_INVALID_ARGUMENT = 2,
    CEF_PROTO_INITIALIZE_FAILED = 3,
    CEF_PROTO_BROWSER_CREATE_FAILED = 4,
    CEF_PROTO_NOT_INITIALIZED = 5,
    CEF_PROTO_BROWSER_STILL_CLOSING = 6,
    CEF_PROTO_HOST_NOT_FOUND = 7,
    CEF_PROTO_PROFILE_NOT_FOUND = 8,
};

CEF_PROTO_API void CefPrototype_SetAdapterLuidOverride(int32_t enabled, int32_t high, uint32_t low);
CEF_PROTO_API void CefPrototype_GetConfiguredAdapterLuid(int32_t* high, uint32_t* low, int32_t* enabled);
CEF_PROTO_API int32_t CefPrototype_Initialize(const wchar_t* subprocess_path,
                                              const wchar_t* cache_path);

// Profile/request-context API. Empty cache_path creates an in-memory private profile.
CEF_PROTO_API uint64_t CefPrototype_CreateProfile(const wchar_t* cache_path);
CEF_PROTO_API int32_t CefPrototype_DestroyProfile(uint64_t profile_handle);
CEF_PROTO_API int32_t CefPrototype_CreateBrowserWithProfile(
    const char* url, int32_t width, int32_t height,
    int32_t target_frame_rate, int32_t external_begin_frame_enabled,
    uint64_t profile_handle);

// Legacy single-host API retained for the previous stability harness.
CEF_PROTO_API int32_t CefPrototype_CreateBrowser(const char* url, int32_t width,
    int32_t height, int32_t target_frame_rate, int32_t external_begin_frame_enabled);
CEF_PROTO_API void CefPrototype_SendExternalBeginFrame();
CEF_PROTO_API void CefPrototype_Invalidate();
CEF_PROTO_API int32_t CefPrototype_GetWindowlessFrameRate();
CEF_PROTO_API void CefPrototype_Resize(int32_t width, int32_t height);
CEF_PROTO_API void CefPrototype_LoadUrl(const char* url);
CEF_PROTO_API void CefPrototype_CloseBrowser();
CEF_PROTO_API int32_t CefPrototype_CloseBrowserAndWait(int32_t timeout_ms);
CEF_PROTO_API int32_t CefPrototype_IsBrowserClosed();

// Multi-host validation API. Runtime initialization/message pumping/shutdown is
// process-global; browser host and texture surface state are handle-scoped.
CEF_PROTO_API uint64_t CefPrototype_CreateBrowserHandle(const char* url,
    int32_t width, int32_t height, int32_t target_frame_rate,
    int32_t external_begin_frame_enabled);
CEF_PROTO_API int32_t CefPrototype_CloseBrowserHandleAndWait(
    uint64_t host_handle, int32_t timeout_ms);
CEF_PROTO_API void CefPrototype_ResizeHandle(
    uint64_t host_handle, int32_t width, int32_t height);
CEF_PROTO_API void CefPrototype_LoadUrlHandle(uint64_t host_handle, const char* url);
CEF_PROTO_API int32_t CefPrototype_IsBrowserClosedHandle(uint64_t host_handle);
CEF_PROTO_API int32_t CefPrototype_IsBrowserReadyHandle(uint64_t host_handle);
CEF_PROTO_API int32_t CefPrototype_GetWindowlessFrameRateHandle(uint64_t host_handle);
CEF_PROTO_API void* CefPrototype_GetUnityTextureHandle(uint64_t host_handle);
CEF_PROTO_API CefTextureProbeStats CefPrototype_GetTextureStatsHandle(uint64_t host_handle);
CEF_PROTO_API int32_t CefPrototype_GetHostCount();
CEF_PROTO_API void CefPrototype_CompatibilityReloadHandle(uint64_t host_handle);
CEF_PROTO_API void CefPrototype_CompatibilityStopHandle(uint64_t host_handle);
CEF_PROTO_API void CefPrototype_CompatibilityGoBackHandle(uint64_t host_handle);
CEF_PROTO_API void CefPrototype_CompatibilityGoForwardHandle(uint64_t host_handle);



// Multi-host input: explicit CEF host handle; main CEF UI thread only.
CEF_PROTO_API void CefPrototype_InteractionSetFocusHandle(uint64_t host_handle,int32_t focused);
CEF_PROTO_API void CefPrototype_InteractionMouseMoveHandle(uint64_t host_handle,int32_t x,int32_t y,int32_t leave);
CEF_PROTO_API void CefPrototype_InteractionMouseClickHandle(uint64_t host_handle,int32_t x,int32_t y,int32_t button,int32_t up,int32_t count);
CEF_PROTO_API void CefPrototype_InteractionMouseWheelHandle(uint64_t host_handle,int32_t x,int32_t y,int32_t dx,int32_t dy);
CEF_PROTO_API void CefPrototype_InteractionSendKeyHandle(uint64_t host_handle,int32_t key,int32_t up);
CEF_PROTO_API void CefPrototype_InteractionSendCharHandle(uint64_t host_handle,uint32_t ch);
CEF_PROTO_API void CefPrototype_InteractionImeSetCompositionHandle(uint64_t host_handle,const wchar_t* text);
CEF_PROTO_API void CefPrototype_InteractionImeCommitTextHandle(uint64_t host_handle,const wchar_t* text);
CEF_PROTO_API void CefPrototype_InteractionImeFinishHandle(uint64_t host_handle);
CEF_PROTO_API void CefPrototype_InteractionImeCancelHandle(uint64_t host_handle);
CEF_PROTO_API void CefPrototype_InteractionTouchTapHandle(uint64_t host_handle,int32_t x,int32_t y);

CEF_PROTO_API void CefPrototype_InteractionSetFocus(int32_t focused);
CEF_PROTO_API void CefPrototype_InteractionMouseMove(int32_t x,int32_t y,int32_t mouse_leave);
CEF_PROTO_API void CefPrototype_InteractionMouseClick(int32_t x,int32_t y,int32_t button,int32_t mouse_up,int32_t click_count);
CEF_PROTO_API void CefPrototype_InteractionMouseWheel(int32_t x,int32_t y,int32_t dx,int32_t dy);
CEF_PROTO_API void CefPrototype_InteractionSendKey(int32_t windows_key_code, int32_t key_up);
CEF_PROTO_API void CefPrototype_InteractionSendChar(uint32_t utf16_code_unit);
CEF_PROTO_API void CefPrototype_InteractionImeSetComposition(const wchar_t* text);
CEF_PROTO_API void CefPrototype_InteractionImeCommitText(const wchar_t* text);
CEF_PROTO_API void CefPrototype_InteractionImeFinish();
CEF_PROTO_API void CefPrototype_InteractionImeCancel();
CEF_PROTO_API void CefPrototype_InteractionTouchTap(int32_t x,int32_t y);

CEF_PROTO_API void CefPrototype_CompatibilityConfigurePaths(
    const wchar_t* download_path, const wchar_t* upload_path);
// Runtime media policy. 0 denies device capture, 1 allows requested camera/microphone capture.
CEF_PROTO_API void CefPrototype_SetMediaPermissionPolicy(int32_t policy);
CEF_PROTO_API CefCompatibilityStats CefPrototype_GetCompatibilityStats();
CEF_PROTO_API void CefPrototype_CompatibilityReload();
CEF_PROTO_API void CefPrototype_CompatibilityStop();
CEF_PROTO_API void CefPrototype_CompatibilityGoBack();
CEF_PROTO_API void CefPrototype_CompatibilityGoForward();
CEF_PROTO_API int32_t CefPrototype_ExecuteDevToolsMethod(const char* method);
CEF_PROTO_API int32_t CefPrototype_GetTitleUtf8(char* buffer, int32_t capacity);
CEF_PROTO_API int32_t CefPrototype_GetTitleUtf8Handle(uint64_t host_handle, char* buffer, int32_t capacity);

// RPC v2, Windows UI thread only. host_handle==0 selects the legacy singleton.
// Return 0 success; negative error. No terminating NUL is required for buffers.
CEF_PROTO_API int32_t CWV_Bridge_Open(uint64_t host_handle, const uint8_t* exact_file_url, uint32_t count, uint32_t protocol_version);
CEF_PROTO_API int32_t CWV_Bridge_Peek(uint64_t host_handle, uint32_t* required_bytes);
CEF_PROTO_API int32_t CWV_Bridge_Read(uint64_t host_handle, uint8_t* destination, uint32_t capacity, uint32_t* actual_bytes);
CEF_PROTO_API int32_t CWV_Bridge_Complete(uint64_t host_handle, uint64_t request_id, uint32_t navigation_id,
                                          const uint8_t* result_utf8, uint32_t count, int32_t is_error);
CEF_PROTO_API uint32_t CWV_Bridge_Generation(uint64_t host_handle);
CEF_PROTO_API uint32_t CWV_Bridge_Version();
// Protocol v2 extends v1 with Unity->JS commands and reverse Promise response queue.
CEF_PROTO_API int32_t CWV_Bridge_Dispatch(uint64_t host_handle, const uint8_t* json, uint32_t count);
CEF_PROTO_API int32_t CWV_Bridge_CancelOutbound(uint64_t host_handle, const uint8_t* request_id, uint32_t count);
CEF_PROTO_API int32_t CWV_Bridge_ResultPeek(uint64_t host_handle, uint32_t* required_bytes);
CEF_PROTO_API int32_t CWV_Bridge_ResultRead(uint64_t host_handle, uint8_t* destination, uint32_t capacity, uint32_t* actual_bytes);

CEF_PROTO_API void CefPrototype_DoMessageLoopWork();
CEF_PROTO_API int32_t CefPrototype_ShutdownBlocking(int32_t timeout_ms);

}
