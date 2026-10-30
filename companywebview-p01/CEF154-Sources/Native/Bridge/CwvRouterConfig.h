#pragma once
#include "include/wrapper/cef_message_router.h"

inline CefMessageRouterConfig CwvRouterConfig() {
    CefMessageRouterConfig config;
    config.js_query_function = "__cwvQuery";
    config.js_cancel_function = "__cwvCancel";
    return config;
}
