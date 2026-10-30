#pragma once

#include <string>
#include <cstdint>
#include "include/cef_base.h"
#include "include/cef_request_context.h"

class CefTextureHost;

enum class CefPrototypeResult {
    Ok,
    AlreadyInitialized,
    InvalidArgument,
    CefInitializeFailed,
    BrowserCreateFailed,
};

void CefPrototypeSetAdapterLuidOverride(bool enabled, int32_t high, uint32_t low);
void CefPrototypeGetConfiguredAdapterLuid(int32_t& high, uint32_t& low, bool& enabled);

CefPrototypeResult CefPrototypeInitialize(const std::wstring& subprocess_path,
                                          const std::wstring& cache_path);
CefPrototypeResult CefPrototypeCreateBrowser(const std::string& url,
                                             int width,
                                             int height,
                                             int target_frame_rate,
                                             bool external_begin_frame_enabled,
                                             CefRefPtr<CefTextureHost>& host,
                                             uint64_t surface_id = 0,
                                             CefRefPtr<CefRequestContext> request_context = nullptr);
void CefPrototypeDoMessageLoopWork();
void CefPrototypeShutdown();
