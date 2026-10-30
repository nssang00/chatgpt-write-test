#include "CefTextureHost.h"
#include <cstdio>
#include <windows.h>
#include <filesystem>
#include <vector>
#include <cstring>
#include <limits>
#include "include/cef_parser.h"
#include "../Bridge/CwvRouterConfig.h"

#include "include/cef_browser.h"
#include "include/cef_values.h"
#include "../include/CefTextureProbeApi.h"

class CefTextureHost::BridgeQueryHandler : public CefMessageRouterBrowserSide::Handler {
public:
    explicit BridgeQueryHandler(CefTextureHost* owner) : owner_(owner) {}
    bool OnQuery(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                 int64_t query_id, const CefString& request, bool persistent,
                 CefRefPtr<Callback> callback) override {
        if (persistent) { callback->Failure(-1, "ERR_UNSUPPORTED_PERSISTENT_QUERY"); return true; }
        return owner_->BridgeQuery(browser, frame, query_id, request, callback);
    }
    void OnQueryCanceled(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>, int64_t query_id) override {
        owner_->BridgeQueryCanceled(query_id);
    }
private:
    CefTextureHost* owner_;
};

CefTextureHost::CefTextureHost(int width, int height, uint64_t surface_id)
    : width_(width), height_(height), surface_id_(surface_id) {
    bridge_router_ = CefMessageRouterBrowserSide::Create(CwvRouterConfig());
    bridge_handler_.reset(new BridgeQueryHandler(this));
    bridge_router_->AddHandler(bridge_handler_.get(), true);
}
CefTextureHost::~CefTextureHost() {
    if (bridge_router_ && bridge_handler_) bridge_router_->RemoveHandler(bridge_handler_.get());
}

bool CefTextureHost::OnProcessMessageReceived(CefRefPtr<CefBrowser> browser,
    CefRefPtr<CefFrame> frame, CefProcessId source, CefRefPtr<CefProcessMessage> message) {
    return bridge_router_ && bridge_router_->OnProcessMessageReceived(browser, frame, source, message);
}

int CefTextureHost::BridgeOpen(const std::string& exact_url) {
    // Authorize an EXACT main-frame URL only: file:/// or a tokenized loopback asset URL.
    // The latter is a potentially trustworthy origin for PDF.js Worker/WASM. Never accept
    // arbitrary http:// hostnames or localhost aliases (DNS rebinding risk).
    bool local_file = exact_url.compare(0, 8, "file:///") == 0;
    bool local_asset = false;
    constexpr char kPrefix[] = "http://127.0.0.1:";
    if (exact_url.compare(0, sizeof(kPrefix) - 1, kPrefix) == 0) {
        auto port_start = sizeof(kPrefix) - 1;
        auto slash = exact_url.find('/', port_start);
        if (slash != std::string::npos && slash > port_start && slash - port_start <= 5) {
            uint32_t port = 0;
            bool digits = true;
            for (size_t i = port_start; i < slash; ++i) {
                if (exact_url[i] < '0' || exact_url[i] > '9') { digits = false; break; }
                port = port * 10 + static_cast<uint32_t>(exact_url[i] - '0');
            }
            // The local asset server generates a 24-byte random token (48 lowercase hex digits).
            const auto token_end = slash + 1 + 48;
            if (digits && port > 0 && port <= 65535 && token_end < exact_url.size() &&
                exact_url[token_end] == '/') {
                local_asset = true;
                for (size_t i = slash + 1; i < token_end; ++i) {
                    char c = exact_url[i];
                    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) {
                        local_asset = false; break;
                    }
                }
            }
        }
    }
    if (bridge_closed_ || exact_url.size() > 4096 ||
        !(local_file || local_asset) || exact_url.find('#') != std::string::npos)
        return -1;
    if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, exact_url.data(),
                            static_cast<int>(exact_url.size()), nullptr, 0) == 0) return -3;
    bridge_allowed_url_ = exact_url;
    return 0;
}

bool CefTextureHost::BridgeQuery(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame,
    int64_t query_id, const CefString& request,
    CefRefPtr<CefMessageRouterBrowserSide::Callback> callback) {
    if (bridge_closed_) { callback->Failure(-1, "ERR_WEBVIEW_CLOSED"); return true; }
    const std::string frame_url = frame ? frame->GetURL().ToString() : std::string();
    if (bridge_allowed_url_.empty() || !frame || !frame->IsMain() || frame_url != bridge_allowed_url_) {
        callback->Failure(-1, "ERR_UNAUTHORIZED_ORIGIN"); return true;
    }
    const std::string raw = request.ToString();
    if (raw.size() > 65536) { callback->Failure(-1, "ERR_PAYLOAD_TOO_LARGE"); return true; }
    auto value = CefParseJSON(raw, JSON_PARSER_RFC);
    if (!value || value->GetType() != VTYPE_DICTIONARY) {
        callback->Failure(-1, "ERR_INVALID_REQUEST"); return true;
    }
    auto dict = value->GetDictionary();
    if (!dict->HasKey("v") || dict->GetInt("v") != 1 ||
        dict->GetType("method") != VTYPE_STRING || dict->GetType("payloadJson") != VTYPE_STRING) {
        callback->Failure(-1, "ERR_INVALID_REQUEST"); return true;
    }
    const std::string method = dict->GetString("method").ToString();
    const std::string payload = dict->GetString("payloadJson").ToString();
    // Reserved reverse-RPC response: validated against a pending Unity->JS request.
    // Never forward this method to user-defined C# handlers.
    if (method == "__cwv.executeResult") {
        auto parsed = CefParseJSON(payload, JSON_PARSER_RFC);
        if (!parsed || parsed->GetType() != VTYPE_DICTIONARY) {
            callback->Failure(-1, "ERR_INVALID_RESPONSE"); return true;
        }
        auto response = parsed->GetDictionary();
        if (response->GetType("requestId") != VTYPE_STRING ||
            response->GetType("navigationId") != VTYPE_INT ||
            response->GetType("ok") != VTYPE_BOOL) {
            callback->Failure(-1, "ERR_INVALID_RESPONSE"); return true;
        }
        const std::string request_id = response->GetString("requestId").ToString();
        auto pending = bridge_outbound_pending_.find(request_id);
        if (pending == bridge_outbound_pending_.end() || pending->second != bridge_navigation_ ||
            response->GetInt("navigationId") != static_cast<int>(bridge_navigation_)) {
            callback->Failure(-1, "ERR_STALE_REQUEST"); return true;
        }
        if ((response->GetBool("ok") && response->GetType("resultJson") != VTYPE_STRING) ||
            (!response->GetBool("ok") && response->GetType("error") != VTYPE_STRING) ||
            payload.size() > 65536 || bridge_result_queue_.size() >= 256) {
            callback->Failure(-1, "ERR_INVALID_RESPONSE"); return true;
        }
        bridge_outbound_pending_.erase(pending);
        bridge_result_queue_.push_back(payload);
        callback->Success("null");
        return true;
    }
    if (method.empty() || method.size() > 128 || payload.size() > 65536 ||
        !CefParseJSON(payload, JSON_PARSER_RFC)) {
        callback->Failure(-1, "ERR_INVALID_REQUEST"); return true;
    }
    for (const char c : method) {
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
              (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-')) {
            callback->Failure(-1, "ERR_INVALID_METHOD"); return true;
        }
    }
    if (bridge_queue_.size() >= 256 || bridge_pending_.size() >= 256) {
        callback->Failure(-1, "ERR_QUEUE_FULL"); return true;
    }
    const uint64_t id = bridge_next_id_++;
    auto packet = CefDictionaryValue::Create();
    packet->SetInt("v", 1);
    packet->SetString("requestId", std::to_string(id));
    packet->SetInt("navigationId", static_cast<int>(bridge_navigation_));
    packet->SetString("method", method);
    packet->SetString("payloadJson", payload);
    auto json_value = CefValue::Create();
    json_value->SetDictionary(packet);
    std::string envelope = CefWriteJSON(json_value, JSON_WRITER_DEFAULT).ToString();
    if (envelope.size() > 196608) {
        callback->Failure(-1, "ERR_PAYLOAD_TOO_LARGE"); return true;
    }
    bridge_queue_.push_back({id, std::move(envelope)});
    bridge_pending_.emplace(id, BridgePending{bridge_navigation_, query_id, callback});
    return true;
}

void CefTextureHost::BridgeQueryCanceled(int64_t query_id) {
    for (auto it = bridge_pending_.begin(); it != bridge_pending_.end();) {
        if (it->second.query_id == query_id) {
            const uint64_t id = it->first;
            for (auto queued = bridge_queue_.begin(); queued != bridge_queue_.end();) {
                if (queued->id == id) queued = bridge_queue_.erase(queued);
                else ++queued;
            }
            it = bridge_pending_.erase(it);
        } else ++it;
    }
}

void CefTextureHost::BridgeCancelAll(const char* reason) {
    bridge_queue_.clear();
    bridge_result_queue_.clear();
    bridge_outbound_pending_.clear();
    auto pending = std::move(bridge_pending_);
    bridge_pending_.clear();
    for (auto& item : pending) item.second.callback->Failure(-1, reason);
}

int CefTextureHost::BridgePeek(uint32_t* bytes) {
    if (!bytes) return -1;
    *bytes = bridge_queue_.empty() ? 0 : static_cast<uint32_t>(bridge_queue_.front().json.size());
    return bridge_closed_ ? -2 : 0;
}
int CefTextureHost::BridgeRead(uint8_t* destination, uint32_t capacity, uint32_t* bytes) {
    if (!bytes) return -1;
    *bytes = bridge_queue_.empty() ? 0 : static_cast<uint32_t>(bridge_queue_.front().json.size());
    if (bridge_closed_) return -2;
    if (*bytes == 0) return 0;
    if (!destination || capacity < *bytes) return -3; // Do not pop on insufficient capacity.
    std::memcpy(destination, bridge_queue_.front().json.data(), *bytes);
    bridge_queue_.pop_front();
    return 0;
}
int CefTextureHost::BridgeCancelOutbound(const std::string& id) {
    return bridge_outbound_pending_.erase(id) != 0 ? 0 : -4;
}
int CefTextureHost::BridgeDispatch(const std::string& json) {
    if (bridge_closed_ || bridge_allowed_url_.empty() || json.empty() || json.size() > 65536 || !browser_) return -2;
    auto frame = browser_->GetMainFrame();
    if (!frame || frame->GetURL().ToString() != bridge_allowed_url_) return -3;
    auto parsed = CefParseJSON(json, JSON_PARSER_RFC);
    if (!parsed || parsed->GetType() != VTYPE_DICTIONARY) return -1;
    auto d = parsed->GetDictionary();
    if (d->GetType("kind") != VTYPE_STRING) return -1;
    const auto kind = d->GetString("kind").ToString();
    if (kind == "execute") {
        if (d->GetType("requestId") != VTYPE_STRING || d->GetType("navigationId") != VTYPE_INT ||
            d->GetType("method") != VTYPE_STRING || d->GetType("args") != VTYPE_LIST ||
            d->GetInt("navigationId") != static_cast<int>(bridge_navigation_)) return -1;
        std::string id = d->GetString("requestId").ToString();
        if (id.empty() || id.size() > 20 || bridge_outbound_pending_.size() >= 256 ||
            bridge_outbound_pending_.find(id) != bridge_outbound_pending_.end()) return -5;
        bridge_outbound_pending_.emplace(id, bridge_navigation_);
    } else if (kind == "message") {
        if (d->GetType("name") != VTYPE_STRING || !d->HasKey("payload")) return -1;
    } else if (kind == "script") {
        if (d->GetType("script") != VTYPE_STRING) return -1;
    } else return -1;
    // CefParseJSON/CefWriteJSON canonicalizes the incoming payload. A JavaScript
    // object literal is emitted as executable data, not string interpolation.
    const std::string safe_json = CefWriteJSON(parsed, JSON_WRITER_DEFAULT).ToString();
    const std::string script = "if(window.AppName){window.AppName.__receive(" + safe_json + ");}";
    frame->ExecuteJavaScript(script, frame->GetURL(), 0);
    return 0;
}
int CefTextureHost::BridgeResultPeek(uint32_t* bytes) {
    if (!bytes) return -1;
    *bytes = bridge_result_queue_.empty() ? 0 : static_cast<uint32_t>(bridge_result_queue_.front().size());
    return bridge_closed_ ? -2 : 0;
}
int CefTextureHost::BridgeResultRead(uint8_t* dst, uint32_t capacity, uint32_t* bytes) {
    if (!bytes) return -1;
    *bytes = bridge_result_queue_.empty() ? 0 : static_cast<uint32_t>(bridge_result_queue_.front().size());
    if (bridge_closed_) return -2;
    if (*bytes == 0) return 0;
    if (!dst || capacity < *bytes) return -3;
    std::memcpy(dst, bridge_result_queue_.front().data(), *bytes);
    bridge_result_queue_.pop_front();
    return 0;
}

int CefTextureHost::BridgeComplete(uint64_t id, uint32_t navigation,
    const uint8_t* utf8, uint32_t bytes, bool error) {
    auto it = bridge_pending_.find(id);
    if (it == bridge_pending_.end() || it->second.navigation != navigation ||
        navigation != bridge_navigation_ || bridge_closed_) return -4;
    if (!utf8 || bytes > 65536) return -5;
    if (bytes > 0 && MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                                         reinterpret_cast<const char*>(utf8), static_cast<int>(bytes),
                                         nullptr, 0) == 0) return -7;
    const std::string result(reinterpret_cast<const char*>(utf8), bytes);
    const bool valid_json = error || !!CefParseJSON(result, JSON_PARSER_RFC);
    const auto callback = it->second.callback;
    bridge_pending_.erase(it);
    if (!valid_json) callback->Failure(-1, "ERR_INVALID_RESPONSE");
    else if (error) callback->Failure(-1, result);
    else callback->Success(result);
    return 0;
}


void CefTextureHost::GetViewRect(CefRefPtr<CefBrowser>, CefRect& rect) {
    rect = CefRect(0, 0, width_.load(), height_.load());
}

void CefTextureHost::OnPaint(CefRefPtr<CefBrowser>,
                             PaintElementType,
                             const RectList&,
                             const void*,
                             int,
                             int) {
    // Shared textures should route view painting through OnAcceleratedPaint.
    // Count software frames so fallback is visible instead of silently accepted.
    if (surface_id_ != 0) CefTextureProbe_NotifySoftwareFrameForSurface(surface_id_);
    else CefTextureProbe_NotifySoftwareFrame();
}

void CefTextureHost::OnAcceleratedPaint(CefRefPtr<CefBrowser>,
                                        PaintElementType type,
                                        const RectList&,
                                        const CefAcceleratedPaintInfo& info) {
    if (type != PET_VIEW || !info.shared_texture_handle) {
        return;
    }

    // CEF owns the source resource and may recycle it as soon as this callback
    // returns. The copy therefore MUST complete inside this callback.
    if (surface_id_ != 0) CefTextureProbe_CopyAcceleratedFrameForSurface(surface_id_, info.shared_texture_handle);
    else CefTextureProbe_CopyAcceleratedFrame(info.shared_texture_handle);
}

void CefTextureHost::OnAfterCreated(CefRefPtr<CefBrowser> browser) {
    bridge_closed_ = false;
    browser_ = browser;
    closed_.store(false, std::memory_order_release);
    created_.store(true, std::memory_order_release);
}


void CefTextureHost::OnTitleChange(CefRefPtr<CefBrowser>, const CefString& title) {
    std::lock_guard<std::mutex> lock(title_mutex_);
    title_ = title.ToString();
}

std::string CefTextureHost::GetTitle() const {
    std::lock_guard<std::mutex> lock(title_mutex_);
    return title_;
}

void CefTextureHost::OnBeforeClose(CefRefPtr<CefBrowser> browser) {
    bridge_closed_ = true;
    BridgeCancelAll("ERR_WEBVIEW_CLOSED");
    if (bridge_router_) bridge_router_->OnBeforeClose(browser);
    if (bridge_router_ && bridge_handler_) bridge_router_->RemoveHandler(bridge_handler_.get());
    bridge_handler_.reset();
    bridge_router_ = nullptr;
    if (browser_ && browser_->IsSame(browser)) {
        browser_ = nullptr;
    }
    created_.store(false, std::memory_order_release);
    closed_.store(true, std::memory_order_release);
}


void CefTextureHost::ConfigureCompatibilityPaths(
    const std::wstring& download_path,
    const std::wstring& upload_path) {
    compat_download_path_ = download_path;
    compat_upload_path_ = upload_path;
}

void CefTextureHost::OnAddressChange(
    CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame, const CefString&) {
    if (frame && frame->IsMain()) compat_address_change_.fetch_add(1);
}

void CefTextureHost::OnLoadingStateChange(
    CefRefPtr<CefBrowser>, bool isLoading, bool canGoBack, bool canGoForward) {
    compat_is_loading_.store(isLoading ? 1 : 0);
    compat_can_back_.store(canGoBack ? 1 : 0);
    compat_can_forward_.store(canGoForward ? 1 : 0);
}

void CefTextureHost::OnLoadStart(
    CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame, CefLoadHandler::TransitionType) {
    if (frame && frame->IsMain()) compat_load_start_.fetch_add(1);
}

void CefTextureHost::OnLoadEnd(
    CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame, int) {
    if (frame && frame->IsMain()) compat_load_end_.fetch_add(1);
}

void CefTextureHost::OnLoadError(
    CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame, CefLoadHandler::ErrorCode,
    const CefString&, const CefString&) {
    if (frame && frame->IsMain()) compat_load_error_.fetch_add(1);
}

bool CefTextureHost::OnBeforeBrowse(
    CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
    CefRefPtr<CefRequest>, bool, bool is_redirect) {
    if (bridge_router_) bridge_router_->OnBeforeBrowse(browser, frame);
    if (frame && frame->IsMain()) {
        ++bridge_navigation_;
        BridgeCancelAll("ERR_NAVIGATION_ABORTED");
        compat_before_browse_.fetch_add(1);
        if (is_redirect) compat_redirect_.fetch_add(1);
    }
    return false;
}

void CefTextureHost::OnRenderProcessTerminated(
    CefRefPtr<CefBrowser> browser, CefRequestHandler::TerminationStatus, int, const CefString&) {
    ++bridge_navigation_;
    BridgeCancelAll("ERR_RENDER_PROCESS_TERMINATED");
    if (bridge_router_) bridge_router_->OnRenderProcessTerminated(browser);
    compat_render_terminated_.fetch_add(1);
}

bool CefTextureHost::OnBeforePopup(
    CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>, int,
    const CefString&, const CefString&, CefLifeSpanHandler::WindowOpenDisposition, bool,
    const CefPopupFeatures&, CefWindowInfo&, CefRefPtr<CefClient>&,
    CefBrowserSettings&, CefRefPtr<CefDictionaryValue>&,
    bool*) {
    compat_popup_requested_.fetch_add(1);
    compat_popup_canceled_.fetch_add(1);
    return true;
}

bool CefTextureHost::CanDownload(
    CefRefPtr<CefBrowser>, const CefString&, const CefString&) {
    return true;
}

bool CefTextureHost::OnBeforeDownload(
    CefRefPtr<CefBrowser>, CefRefPtr<CefDownloadItem>,
    const CefString&, CefRefPtr<CefBeforeDownloadCallback> callback) {
    compat_download_before_.fetch_add(1);
    if (!compat_download_path_.empty()) {
        callback->Continue(CefString(compat_download_path_), false);
        return true;
    }
    return false;
}

void CefTextureHost::OnDownloadUpdated(
    CefRefPtr<CefBrowser>, CefRefPtr<CefDownloadItem> item,
    CefRefPtr<CefDownloadItemCallback>) {
    if (!item) return;
    if (item->IsComplete()) compat_download_complete_.store(1);
    if (item->IsCanceled()) compat_download_canceled_.store(1);
}

bool CefTextureHost::OnFileDialog(
    CefRefPtr<CefBrowser>, CefDialogHandler::FileDialogMode, const CefString&,
    const CefString&, const std::vector<CefString>&,
    const std::vector<CefString>&, const std::vector<CefString>&,
    CefRefPtr<CefFileDialogCallback> callback) {
    compat_file_dialog_.fetch_add(1);
    if (compat_upload_path_.empty()) {
        callback->Cancel();
        return true;
    }
    std::vector<CefString> paths;
    paths.push_back(CefString(compat_upload_path_));
    callback->Continue(paths);
    compat_file_dialog_completed_.fetch_add(1);
    return true;
}

bool CefTextureHost::OnJSDialog(
    CefRefPtr<CefBrowser>, const CefString&, JSDialogType dialog_type,
    const CefString&, const CefString&, CefRefPtr<CefJSDialogCallback> callback,
    bool& suppress_message) {
    suppress_message = false;
    if (dialog_type == JSDIALOGTYPE_ALERT) {
        compat_js_alert_.fetch_add(1);
        callback->Continue(true, CefString());
    } else if (dialog_type == JSDIALOGTYPE_CONFIRM) {
        compat_js_confirm_.fetch_add(1);
        callback->Continue(true, CefString());
    } else if (dialog_type == JSDIALOGTYPE_PROMPT) {
        compat_js_prompt_.fetch_add(1);
        callback->Continue(true, CefString("cef-ok"));
    } else {
        return false;
    }
    return true;
}

bool CefTextureHost::OnRequestMediaAccessPermission(
    CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>,
    const CefString&, uint32_t requested_permissions, CefRefPtr<CefMediaAccessCallback> callback) {
    compat_media_permission_.fetch_add(1);
    if (media_permission_policy_.load(std::memory_order_acquire) == 1) {
        const uint32_t device_mask =
            CEF_MEDIA_PERMISSION_DEVICE_AUDIO_CAPTURE | CEF_MEDIA_PERMISSION_DEVICE_VIDEO_CAPTURE;
        const uint32_t granted = requested_permissions & device_mask;
        if (granted != CEF_MEDIA_PERMISSION_NONE) {
            callback->Continue(granted);
            return true;
        }
    }
    callback->Cancel();
    return true;
}

void CefTextureHost::SetMediaPermissionPolicy(int policy) {
    media_permission_policy_.store(policy == 1 ? 1 : 0, std::memory_order_release);
}

void CefTextureHost::ReloadPage() {
    if (browser_) browser_->Reload();
}

void CefTextureHost::StopLoad() {
    if (browser_) browser_->StopLoad();
}

void CefTextureHost::GoBack() {
    if (browser_ && browser_->CanGoBack()) browser_->GoBack();
}

void CefTextureHost::GoForward() {
    if (browser_ && browser_->CanGoForward()) browser_->GoForward();
}

int CefTextureHost::ExecuteDevToolsMethod(const std::string& method) {
    if (!browser_ || method.empty()) return 0;
    const int id = browser_->GetHost()->ExecuteDevToolsMethod(0, method, nullptr);
    compat_devtools_probe_id_.store(id);
    return id;
}

void CefTextureHost::GetCompatibilityStats(
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
    int& page_media_element) const {
    before_browse=compat_before_browse_.load(); redirect=compat_redirect_.load();
    address_change=compat_address_change_.load(); load_start=compat_load_start_.load();
    load_end=compat_load_end_.load(); load_error=compat_load_error_.load();
    is_loading=compat_is_loading_.load(); can_back=compat_can_back_.load();
    can_forward=compat_can_forward_.load(); popup_requested=compat_popup_requested_.load();
    popup_canceled=compat_popup_canceled_.load(); download_before=compat_download_before_.load();
    download_complete=compat_download_complete_.load(); download_canceled=compat_download_canceled_.load();
    file_dialog=compat_file_dialog_.load(); file_dialog_completed=compat_file_dialog_completed_.load();
    js_alert=compat_js_alert_.load(); js_confirm=compat_js_confirm_.load();
    js_prompt=compat_js_prompt_.load(); media_permission=compat_media_permission_.load();
    render_terminated=compat_render_terminated_.load(); devtools_probe_id=compat_devtools_probe_id_.load();
    page_code=0; page_cookie=0; page_local_storage=0; page_session_storage=0;
    page_popup=0; page_dialog=0; page_upload=0; page_media_denied=0;
    page_webrtc=0; page_media_element=0;
}

void CefTextureHost::Resize(int width, int height) {
    if (width <= 0 || height <= 0) {
        return;
    }
    width_.store(width);
    height_.store(height);
    if (browser_) {
        browser_->GetHost()->WasResized();
    }
}

void CefTextureHost::LoadUrl(const std::string& url) {
    if (browser_ && browser_->GetMainFrame()) {
        browser_->GetMainFrame()->LoadURL(url);
    }
}


void CefTextureHost::SendExternalBeginFrame() {
    if (browser_) {
        browser_->GetHost()->SendExternalBeginFrame();
    }
}


void CefTextureHost::Invalidate() {
    if (browser_) {
        browser_->GetHost()->Invalidate(PET_VIEW);
    }
}

int CefTextureHost::GetWindowlessFrameRate() const {
    if (!browser_) {
        return 0;
    }
    return browser_->GetHost()->GetWindowlessFrameRate();
}

void CefTextureHost::SetFocus(bool focused) {
    if (browser_) browser_->GetHost()->SetFocus(focused);
}

void CefTextureHost::SendMouseMove(int x, int y, bool mouse_leave) {
    if (!browser_) return;
    CefMouseEvent e; e.x=x; e.y=y; e.modifiers=0;
    browser_->GetHost()->SendMouseMoveEvent(e, mouse_leave);
}

void CefTextureHost::SendMouseClick(int x, int y, int button, bool mouse_up, int click_count) {
    if (!browser_) return;
    CefMouseEvent e; e.x=x; e.y=y; e.modifiers=0;
    CefBrowserHost::MouseButtonType type = MBT_LEFT;
    if (button==1) type=MBT_MIDDLE; else if (button==2) type=MBT_RIGHT;
    browser_->GetHost()->SendMouseClickEvent(e, type, mouse_up, click_count);
}

void CefTextureHost::SendMouseWheel(int x, int y, int delta_x, int delta_y) {
    if (!browser_) return;
    CefMouseEvent e; e.x=x; e.y=y; e.modifiers=0;
    browser_->GetHost()->SendMouseWheelEvent(e, delta_x, delta_y);
}


void CefTextureHost::SendKey(int windows_key_code, bool key_up) {
    if (!browser_) return; CefKeyEvent e; e.type=key_up?KEYEVENT_KEYUP:KEYEVENT_RAWKEYDOWN; e.windows_key_code=windows_key_code; e.native_key_code=windows_key_code; browser_->GetHost()->SendKeyEvent(e);
}
void CefTextureHost::SendChar(uint16_t ch) {
    if (!browser_) return; CefKeyEvent e; e.type=KEYEVENT_CHAR; e.windows_key_code=(int)ch; e.native_key_code=(int)ch; e.character=(char16_t)ch; e.unmodified_character=(char16_t)ch; browser_->GetHost()->SendKeyEvent(e);
}
void CefTextureHost::ImeSetCompositionText(const std::wstring& text) {
    if (!browser_) return; std::vector<CefCompositionUnderline> u; if(!text.empty()){ CefCompositionUnderline x; x.range=CefRange(0,(uint32_t)text.size()); x.color=0xff000000; x.background_color=0; x.thick=false; u.push_back(x);} browser_->GetHost()->ImeSetComposition(CefString(text),u,CefRange::InvalidRange(),CefRange((uint32_t)text.size(),(uint32_t)text.size()));
}
void CefTextureHost::ImeCommitTextValue(const std::wstring& text) { if(browser_&&!text.empty()) browser_->GetHost()->ImeCommitText(CefString(text),CefRange::InvalidRange(),0); }
void CefTextureHost::ImeFinish() { if(browser_) browser_->GetHost()->ImeFinishComposingText(false); }
void CefTextureHost::ImeCancel() { if(browser_) browser_->GetHost()->ImeCancelComposition(); }


void CefTextureHost::SendTouchTap(int x, int y) {
    if (!browser_) return;
    CefTouchEvent e; e.id=1; e.x=(float)x; e.y=(float)y; e.radius_x=1; e.radius_y=1; e.rotation_angle=0; e.pressure=1; e.modifiers=0;
    e.type=CEF_TET_PRESSED; browser_->GetHost()->SendTouchEvent(e);
    e.type=CEF_TET_RELEASED; browser_->GetHost()->SendTouchEvent(e);
}

void CefTextureHost::Close() {
    if (browser_) {
        // Browser close can complete asynchronously. Product shutdown must wait
        // for OnBeforeClose before calling CefShutdown.
        browser_->GetHost()->CloseBrowser(true);
    } else {
        closed_.store(true, std::memory_order_release);
    }
}
