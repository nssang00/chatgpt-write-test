// Prototype-only Unity graphics-device hook.
// Requires Unity's native plugin headers (IUnityInterface.h,
// IUnityGraphics.h, IUnityGraphicsD3D11.h) to be supplied via UNITY_PLUGIN_API.

#if defined(_WIN32) && defined(WEBVIEW_PROBE_WITH_UNITY)

#include <windows.h>
#include <d3d11.h>

#include "IUnityInterface.h"
#include "IUnityGraphics.h"
#include "IUnityGraphicsD3D11.h"
#include "../include/CefTextureProbeApi.h"

static IUnityInterfaces* g_unity = nullptr;
static IUnityGraphics* g_graphics = nullptr;

static void UNITY_INTERFACE_API OnGraphicsDeviceEvent(UnityGfxDeviceEventType event_type) {
    if (event_type == kUnityGfxDeviceEventInitialize) {
        auto* d3d = g_unity->Get<IUnityGraphicsD3D11>();
        if (d3d && d3d->GetDevice()) {
            CefTextureProbe_SetUnityD3D11Device(d3d->GetDevice());
        }
    } else if (event_type == kUnityGfxDeviceEventShutdown) {
        CefTextureProbe_Shutdown();
    }
}

extern "C" void UNITY_INTERFACE_EXPORT UNITY_INTERFACE_API
UnityPluginLoad(IUnityInterfaces* unity_interfaces) {
    g_unity = unity_interfaces;
    g_graphics = g_unity->Get<IUnityGraphics>();
    g_graphics->RegisterDeviceEventCallback(OnGraphicsDeviceEvent);
    OnGraphicsDeviceEvent(kUnityGfxDeviceEventInitialize);
}

extern "C" void UNITY_INTERFACE_EXPORT UNITY_INTERFACE_API
UnityPluginUnload() {
    if (g_graphics) {
        g_graphics->UnregisterDeviceEventCallback(OnGraphicsDeviceEvent);
    }
    CefTextureProbe_Shutdown();
    g_graphics = nullptr;
    g_unity = nullptr;
}

#endif
