#pragma once

#include <atomic>
#include <string>
#include <cstdint>
#include <mutex>
#include <deque>
#include <unordered_map>
#include <unordered_set>
#include <memory>
#include "include/wrapper/cef_message_router.h"

#include "include/cef_app.h"
#include "include/cef_client.h"
#include "include/cef_render_handler.h"
#include "include/cef_display_handler.h"
#include "include/cef_permission_handler.h"
#include "include/cef_jsdialog_handler.h"
#include "include/cef_dialog_handler.h"
#include "include/cef_download_handler.h"
#include "include/cef_request_handler.h"
#include "include/cef_load_handler.h"

class CefTextureHost final : public CefClient,
                             public CefLifeSpanHandler,
                             public CefRenderHandler,
                             public CefDisplayHandler,
                             public CefLoadHandler,
                             public CefRequestHandler,
                             public CefDownloadHandler,
                             public CefDialogHandler,
                             public CefJSDialogHandler,
                             public CefPermissionHandler {
public:
    CefTextureHost(int width, int height, uint64_t surface_id = 0);
    ~CefTextureHost() override;

    bool OnProcessMessageReceived(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                  CefProcessId source, CefRefPtr<CefProcessMessage> message) override;
    CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
    CefRefPtr<CefRenderHandler> GetRenderHandler() override { return this; }
    CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
    CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }
    CefRefPtr<CefRequestHandler> GetRequestHandler() override { return this; }
    CefRefPtr<CefDownloadHandler> GetDownloadHandler() override { return this; }
    CefRefPtr<CefDialogHandler> GetDialogHandler() override { return this; }
    CefRefPtr<CefJSDialogHandler> GetJSDialogHandler() override { return this; }
    CefRefPtr<CefPermissionHandler> GetPermissionHandler() override { return this; }

    void GetViewRect(CefRefPtr<CefBrowser> browser, CefRect& rect) override;
    void OnPaint(CefRefPtr<CefBrowser> browser,
                 PaintElementType type,
                 const RectList& dirty_rects,
                 const void* buffer,
                 int width,
                 int height) override;
    void OnAcceleratedPaint(CefRefPtr<CefBrowser> browser,
                            PaintElementType type,
                            const RectList& dirty_rects,
                            const CefAcceleratedPaintInfo& info) override;

    void OnAfterCreated(CefRefPtr<CefBrowser> browser) override;
    void OnBeforeClose(CefRefPtr<CefBrowser> browser) override;
    void OnTitleChange(CefRefPtr<CefBrowser> browser, const CefString& title) override;

    void OnAddressChange(CefRefPtr<CefBrowser> browser,
                         CefRefPtr<CefFrame> frame,
                         const CefString& url) override;
    void OnLoadingStateChange(CefRefPtr<CefBrowser> browser,
                              bool isLoading,
                              bool canGoBack,
                              bool canGoForward) override;
    void OnLoadStart(CefRefPtr<CefBrowser> browser,
                     CefRefPtr<CefFrame> frame,
                     CefLoadHandler::TransitionType transition_type) override;
    void OnLoadEnd(CefRefPtr<CefBrowser> browser,
                   CefRefPtr<CefFrame> frame,
                   int httpStatusCode) override;
    void OnLoadError(CefRefPtr<CefBrowser> browser,
                     CefRefPtr<CefFrame> frame,
                     CefLoadHandler::ErrorCode errorCode,
                     const CefString& errorText,
                     const CefString& failedUrl) override;
    bool OnBeforeBrowse(CefRefPtr<CefBrowser> browser,
                        CefRefPtr<CefFrame> frame,
                        CefRefPtr<CefRequest> request,
                        bool user_gesture,
                        bool is_redirect) override;
    void OnRenderProcessTerminated(CefRefPtr<CefBrowser> browser,
                                   CefRequestHandler::TerminationStatus status,
                                   int error_code,
                                   const CefString& error_string) override;
    bool OnBeforePopup(CefRefPtr<CefBrowser> browser,
                       CefRefPtr<CefFrame> frame,
                       int popup_id,
                       const CefString& target_url,
                       const CefString& target_frame_name,
                       CefLifeSpanHandler::WindowOpenDisposition target_disposition,
                       bool user_gesture,
                       const CefPopupFeatures& popupFeatures,
                       CefWindowInfo& windowInfo,
                       CefRefPtr<CefClient>& client,
                       CefBrowserSettings& settings,
                       CefRefPtr<CefDictionaryValue>& extra_info,
                       bool* no_javascript_access) override;
    bool CanDownload(CefRefPtr<CefBrowser> browser,
                     const CefString& url,
                     const CefString& request_method) override;
    bool OnBeforeDownload(CefRefPtr<CefBrowser> browser,
                          CefRefPtr<CefDownloadItem> download_item,
                          const CefString& suggested_name,
                          CefRefPtr<CefBeforeDownloadCallback> callback) override;
    void OnDownloadUpdated(CefRefPtr<CefBrowser> browser,
                           CefRefPtr<CefDownloadItem> download_item,
                           CefRefPtr<CefDownloadItemCallback> callback) override;
    bool OnFileDialog(CefRefPtr<CefBrowser> browser,
                      CefDialogHandler::FileDialogMode mode,
                      const CefString& title,
                      const CefString& default_file_path,
                      const std::vector<CefString>& accept_filters,
                      const std::vector<CefString>& accept_extensions,
                      const std::vector<CefString>& accept_descriptions,
                      CefRefPtr<CefFileDialogCallback> callback) override;
    bool OnJSDialog(CefRefPtr<CefBrowser> browser,
                    const CefString& origin_url,
                    CefJSDialogHandler::JSDialogType dialog_type,
                    const CefString& message_text,
                    const CefString& default_prompt_text,
                    CefRefPtr<CefJSDialogCallback> callback,
                    bool& suppress_message) override;
    bool OnRequestMediaAccessPermission(
        CefRefPtr<CefBrowser> browser,
        CefRefPtr<CefFrame> frame,
        const CefString& requesting_origin,
        uint32_t requested_permissions,
        CefRefPtr<CefMediaAccessCallback> callback) override;

    void ConfigureCompatibilityPaths(const std::wstring& download_path,
                                     const std::wstring& upload_path);
    void SetMediaPermissionPolicy(int policy);
    void ReloadPage();
    void StopLoad();
    void GoBack();
    void GoForward();
    int ExecuteDevToolsMethod(const std::string& method);
    std::string GetTitle() const;

    void Resize(int width, int height);
    void LoadUrl(const std::string& url);
    void Close();
    void SendExternalBeginFrame();
    void Invalidate();
    int GetWindowlessFrameRate() const;

    void SetFocus(bool focused);
    void SendMouseMove(int x, int y, bool mouse_leave);
    void SendMouseClick(int x, int y, int button, bool mouse_up, int click_count);
    void SendMouseWheel(int x, int y, int delta_x, int delta_y);
    void SendKey(int windows_key_code, bool key_up);
    void SendChar(uint16_t utf16_code_unit);
    void ImeSetCompositionText(const std::wstring& text);
    void ImeCommitTextValue(const std::wstring& text);
    void ImeFinish();
    void ImeCancel();
    void SendTouchTap(int x, int y);

    void GetCompatibilityStats(
        int& before_browse, int& redirect, int& address_change,
        int& load_start, int& load_end, int& load_error, int& is_loading,
        int& can_back, int& can_forward,
        int& popup_requested, int& popup_canceled,
        int& download_before, int& download_complete, int& download_canceled,
        int& file_dialog, int& file_dialog_completed,
        int& js_alert, int& js_confirm, int& js_prompt,
        int& media_permission, int& render_terminated,
        int& devtools_probe_id,
        int& page_code, int& page_cookie, int& page_local_storage,
        int& page_session_storage, int& page_popup, int& page_dialog,
        int& page_upload, int& page_media_denied, int& page_webrtc,
        int& page_media_element) const;

    // Bridge ABI: called on the same thread that pumps CefDoMessageLoopWork.
    // 0 is the legacy singleton; a host can also be addressed by its native handle.
    int BridgeOpen(const std::string& exact_url);
    int BridgePeek(uint32_t* bytes);
    int BridgeRead(uint8_t* destination, uint32_t capacity, uint32_t* bytes);
    int BridgeComplete(uint64_t request_id, uint32_t navigation_id,
                       const uint8_t* payload, uint32_t bytes, bool error);
    uint32_t BridgeGeneration() const { return bridge_navigation_; }
    int BridgeDispatch(const std::string& command_json);
    int BridgeCancelOutbound(const std::string& id);
    int BridgeResultPeek(uint32_t* bytes);
    int BridgeResultRead(uint8_t* destination, uint32_t capacity, uint32_t* bytes);
    void BridgeCancelAll(const char* reason);
    bool BridgeQuery(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                     int64_t query_id, const CefString& request,
                     CefRefPtr<CefMessageRouterBrowserSide::Callback> callback);
    void BridgeQueryCanceled(int64_t query_id);

    bool IsCreated() const { return created_.load(std::memory_order_acquire); }
    bool IsClosed() const { return closed_.load(std::memory_order_acquire); }

private:
    class BridgeQueryHandler;
    struct BridgePending {
        uint32_t navigation;
        int64_t query_id;
        CefRefPtr<CefMessageRouterBrowserSide::Callback> callback;
    };
    struct BridgeQueued {
        uint64_t id;
        std::string json;
    };
    std::unique_ptr<BridgeQueryHandler> bridge_handler_;
    CefRefPtr<CefMessageRouterBrowserSide> bridge_router_;
    std::unordered_map<uint64_t, BridgePending> bridge_pending_;
    std::deque<BridgeQueued> bridge_queue_;
    std::deque<std::string> bridge_result_queue_;
    std::unordered_map<std::string, uint32_t> bridge_outbound_pending_;
    std::string bridge_allowed_url_; // exact local file / random-token loopback URL; default denies all.
    uint64_t bridge_next_id_ = 1;
    uint32_t bridge_navigation_ = 1;
    bool bridge_closed_ = false;
    std::atomic<int> width_;
    std::atomic<int> height_;
    std::atomic<bool> created_{false};
    std::atomic<bool> closed_{false};
    std::atomic<int> compat_before_browse_{0};
    std::atomic<int> compat_redirect_{0};
    std::atomic<int> compat_address_change_{0};
    std::atomic<int> compat_load_start_{0};
    std::atomic<int> compat_load_end_{0};
    std::atomic<int> compat_load_error_{0};
    std::atomic<int> compat_is_loading_{0};
    std::atomic<int> compat_can_back_{0};
    std::atomic<int> compat_can_forward_{0};
    std::atomic<int> compat_popup_requested_{0};
    std::atomic<int> compat_popup_canceled_{0};
    std::atomic<int> compat_download_before_{0};
    std::atomic<int> compat_download_complete_{0};
    std::atomic<int> compat_download_canceled_{0};
    std::atomic<int> compat_file_dialog_{0};
    std::atomic<int> compat_file_dialog_completed_{0};
    std::atomic<int> compat_js_alert_{0};
    std::atomic<int> compat_js_confirm_{0};
    std::atomic<int> compat_js_prompt_{0};
    std::atomic<int> compat_media_permission_{0};
    std::atomic<int> media_permission_policy_{0}; // 0=deny, 1=allow requested device audio/video
    std::atomic<int> compat_render_terminated_{0};
    std::atomic<int> compat_devtools_probe_id_{0};
    std::wstring compat_download_path_;
    std::wstring compat_upload_path_;

    mutable std::mutex title_mutex_;
    std::string title_;

    CefRefPtr<CefBrowser> browser_;
    const uint64_t surface_id_;

    IMPLEMENT_REFCOUNTING(CefTextureHost);
    DISALLOW_COPY_AND_ASSIGN(CefTextureHost);
};
