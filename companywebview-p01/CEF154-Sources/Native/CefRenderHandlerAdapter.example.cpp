// Integration example for the pinned CEF 154 line.
// This file intentionally remains an example until the CEF SDK is placed in
// ThirdParty/CEF and linked by the prototype build.

#if defined(WEBVIEW_PROBE_WITH_CEF)
#include "include/cef_render_handler.h"
#include "include/cef_browser.h"
#include "include/CefTextureProbeApi.h"

class ProbeRenderHandler final : public CefRenderHandler {
public:
    bool GetViewRect(CefRefPtr<CefBrowser>, CefRect& rect) override {
        rect = CefRect(0, 0, width_, height_);
        return true;
    }

    void OnPaint(CefRefPtr<CefBrowser>, PaintElementType,
                 const RectList&, const void*, int, int) override {
        // Software fallback must not be the steady-state path for this probe.
        ++software_paint_count_;
    }

    void OnAcceleratedPaint(CefRefPtr<CefBrowser>, PaintElementType type,
                            const RectList&,
                            const CefAcceleratedPaintInfo& info) override {
        if (type != PET_VIEW || !info.shared_texture_handle) {
            return;
        }

        // Critical: this call completes before OnAcceleratedPaint returns.
        // CefTextureProbe_CopyAcceleratedFrame never retains the CEF handle.
        CefTextureProbe_CopyAcceleratedFrame(
            info.shared_texture_handle,
            static_cast<uint32_t>(width_),
            static_cast<uint32_t>(height_));
    }

    void SetSize(int width, int height) {
        width_ = width;
        height_ = height;
    }

private:
    int width_ = 1920;
    int height_ = 1080;
    uint64_t software_paint_count_ = 0;
    IMPLEMENT_REFCOUNTING(ProbeRenderHandler);
};
#endif
