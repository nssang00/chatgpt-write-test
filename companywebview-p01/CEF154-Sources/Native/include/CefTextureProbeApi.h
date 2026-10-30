#pragma once
#include <stdint.h>

#ifdef _WIN32
  #ifdef CEF_TEXTURE_PROBE_EXPORTS
    #define CEF_TEX_API __declspec(dllexport)
  #else
    #define CEF_TEX_API __declspec(dllimport)
  #endif
#else
  #define CEF_TEX_API
#endif

extern "C" {

enum CefTextureProbeStatus : int32_t {
    CEF_TEX_OK = 0,
    CEF_TEX_NOT_INITIALIZED = 1,
    CEF_TEX_INVALID_ARGUMENT = 2,
    CEF_TEX_D3D11_DEVICE1_UNAVAILABLE = 3,
    CEF_TEX_OPEN_SHARED_RESOURCE_FAILED = 4,
    CEF_TEX_DESTINATION_CREATE_FAILED = 5,
    CEF_TEX_UNSUPPORTED_SOURCE = 6,
    CEF_TEX_SURFACE_NOT_FOUND = 7,
};


struct CefGpuAdapterDiagnostics {
    int32_t unity_luid_high;
    uint32_t unity_luid_low;
    uint64_t open_shared_resource_failures;
    int32_t last_open_shared_hresult;
};

struct CefTextureProbeStats {
    uint64_t accelerated_frame_count;
    uint64_t software_frame_count;
    uint64_t destination_generation;
    uint32_t width;
    uint32_t height;
    uint32_t dxgi_format;
    int32_t last_status;
};

CEF_TEX_API int32_t CefTextureProbe_SetUnityD3D11Device(void* d3d11_device);
CEF_TEX_API CefGpuAdapterDiagnostics CefTextureProbe_GetGpuAdapterDiagnostics();

// Legacy single-surface probe API retained so the previous stability harness
// remains source-compatible.
CEF_TEX_API int32_t CefTextureProbe_CopyAcceleratedFrame(void* cef_shared_handle);
CEF_TEX_API void CefTextureProbe_NotifySoftwareFrame();
CEF_TEX_API void* CefTextureProbe_GetUnityTexture();
CEF_TEX_API CefTextureProbeStats CefTextureProbe_GetStats();

// Multi-WebView validation API. Each browser host owns one independent surface.
CEF_TEX_API uint64_t CefTextureProbe_CreateSurface();
CEF_TEX_API void CefTextureProbe_DestroySurface(uint64_t surface_id);
CEF_TEX_API int32_t CefTextureProbe_CopyAcceleratedFrameForSurface(
    uint64_t surface_id, void* cef_shared_handle);
CEF_TEX_API void CefTextureProbe_NotifySoftwareFrameForSurface(uint64_t surface_id);
CEF_TEX_API void* CefTextureProbe_GetUnityTextureForSurface(uint64_t surface_id);
CEF_TEX_API CefTextureProbeStats CefTextureProbe_GetStatsForSurface(uint64_t surface_id);

CEF_TEX_API void CefTextureProbe_Shutdown();

}
