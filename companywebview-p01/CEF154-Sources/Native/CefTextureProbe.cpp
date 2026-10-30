// Windows / D3D11 CEF accelerated OSR probe.
// Multi-WebView validation edition: one Unity D3D11 device/context is shared,
// while every browser surface owns an independent persistent destination texture.

#ifdef _WIN32

#include <windows.h>
#include <d3d11.h>
#include <d3d11_1.h>
#include <d3d11_4.h>
#include <dxgi.h>
#include <wrl/client.h>
#include <atomic>
#include <memory>
#include <mutex>
#include <unordered_map>

#include "include/CefTextureProbeApi.h"

using Microsoft::WRL::ComPtr;

namespace {

struct SurfaceState {
    std::mutex mutex;
    ComPtr<ID3D11Texture2D> destination;
    std::atomic<uint64_t> frame_count{0};
    std::atomic<uint64_t> software_frame_count{0};
    std::atomic<uint64_t> generation{0};
    uint32_t width = 0;
    uint32_t height = 0;
    DXGI_FORMAT format = DXGI_FORMAT_UNKNOWN;
    std::atomic<int32_t> last_status{CEF_TEX_NOT_INITIALIZED};
};

struct DeviceState {
    std::mutex mutex;
    ComPtr<ID3D11Device> device;
    ComPtr<ID3D11Device1> device1;
    ComPtr<ID3D11DeviceContext> context;
    std::unordered_map<uint64_t, std::shared_ptr<SurfaceState>> surfaces;
    std::atomic<uint64_t> next_surface_id{1};
    LUID adapter_luid{};
    std::atomic<uint64_t> open_failures{0};
    std::atomic<int32_t> last_open_hr{0};
};

DeviceState g;
SurfaceState g_legacy;

int32_t SetStatus(const std::shared_ptr<SurfaceState>& s, int32_t status) {
    if (s) s->last_status.store(status, std::memory_order_release);
    return status;
}

int32_t SetLegacyStatus(int32_t status) {
    g_legacy.last_status.store(status, std::memory_order_release);
    return status;
}

std::shared_ptr<SurfaceState> FindSurface(uint64_t surface_id) {
    std::lock_guard<std::mutex> lock(g.mutex);
    const auto it = g.surfaces.find(surface_id);
    return it == g.surfaces.end() ? nullptr : it->second;
}

bool DestinationMatches(const SurfaceState& s, const D3D11_TEXTURE2D_DESC& src) {
    return s.destination &&
           s.width == src.Width &&
           s.height == src.Height &&
           s.format == src.Format;
}

int32_t EnsureDestination(SurfaceState& s,
                          ID3D11Device* device,
                          const D3D11_TEXTURE2D_DESC& src) {
    if (DestinationMatches(s, src)) return CEF_TEX_OK;

    D3D11_TEXTURE2D_DESC desc{};
    desc.Width = src.Width;
    desc.Height = src.Height;
    desc.MipLevels = 1;
    desc.ArraySize = 1;
    desc.Format = src.Format;
    desc.SampleDesc.Count = 1;
    desc.SampleDesc.Quality = 0;
    desc.Usage = D3D11_USAGE_DEFAULT;
    desc.BindFlags = D3D11_BIND_SHADER_RESOURCE;
    desc.CPUAccessFlags = 0;
    desc.MiscFlags = 0;

    ComPtr<ID3D11Texture2D> next;
    const HRESULT hr = device->CreateTexture2D(&desc, nullptr, &next);
    if (FAILED(hr)) return CEF_TEX_DESTINATION_CREATE_FAILED;

    s.destination = std::move(next);
    s.width = src.Width;
    s.height = src.Height;
    s.format = src.Format;
    s.generation.fetch_add(1, std::memory_order_acq_rel);
    return CEF_TEX_OK;
}

int32_t CopyIntoSurface(SurfaceState& s, void* cef_shared_handle) {
    if (!cef_shared_handle) return CEF_TEX_INVALID_ARGUMENT;

    ComPtr<ID3D11Device1> device1;
    ComPtr<ID3D11Device> device;
    ComPtr<ID3D11DeviceContext> context;
    {
        std::lock_guard<std::mutex> lock(g.mutex);
        device1 = g.device1;
        device = g.device;
        context = g.context;
    }
    if (!device1 || !device || !context) return CEF_TEX_NOT_INITIALIZED;

    ComPtr<ID3D11Texture2D> source;
    const HANDLE handle = static_cast<HANDLE>(cef_shared_handle);
    const HRESULT open_hr = device1->OpenSharedResource1(
        handle,
        __uuidof(ID3D11Texture2D),
        reinterpret_cast<void**>(source.GetAddressOf()));
    if (FAILED(open_hr) || !source) {
        g.open_failures.fetch_add(1, std::memory_order_acq_rel);
        g.last_open_hr.store(static_cast<int32_t>(open_hr), std::memory_order_release);
        return CEF_TEX_OPEN_SHARED_RESOURCE_FAILED;
    }

    D3D11_TEXTURE2D_DESC src_desc{};
    source->GetDesc(&src_desc);
    if (src_desc.Width == 0 || src_desc.Height == 0 ||
        src_desc.SampleDesc.Count != 1 || src_desc.ArraySize != 1) {
        return CEF_TEX_UNSUPPORTED_SOURCE;
    }

    std::lock_guard<std::mutex> surface_lock(s.mutex);
    const int32_t ensure = EnsureDestination(s, device.Get(), src_desc);
    if (ensure != CEF_TEX_OK) return ensure;

    // GPU -> GPU only. No readback / Map / CPU bitmap copy.
    context->CopyResource(s.destination.Get(), source.Get());
    s.frame_count.fetch_add(1, std::memory_order_acq_rel);
    s.last_status.store(CEF_TEX_OK, std::memory_order_release);
    return CEF_TEX_OK;
}

CefTextureProbeStats ReadStats(SurfaceState& s) {
    std::lock_guard<std::mutex> lock(s.mutex);
    CefTextureProbeStats stats{};
    stats.accelerated_frame_count = s.frame_count.load(std::memory_order_acquire);
    stats.software_frame_count = s.software_frame_count.load(std::memory_order_acquire);
    stats.destination_generation = s.generation.load(std::memory_order_acquire);
    stats.width = s.width;
    stats.height = s.height;
    stats.dxgi_format = static_cast<uint32_t>(s.format);
    stats.last_status = s.last_status.load(std::memory_order_acquire);
    return stats;
}

void ResetSurface(SurfaceState& s) {
    std::lock_guard<std::mutex> lock(s.mutex);
    s.destination.Reset();
    s.width = 0;
    s.height = 0;
    s.format = DXGI_FORMAT_UNKNOWN;
    s.frame_count.store(0, std::memory_order_release);
    s.software_frame_count.store(0, std::memory_order_release);
    s.generation.store(0, std::memory_order_release);
    s.last_status.store(CEF_TEX_NOT_INITIALIZED, std::memory_order_release);
}

} // namespace

extern "C" {

int32_t CefTextureProbe_SetUnityD3D11Device(void* d3d11_device) {
    if (!d3d11_device) return CEF_TEX_INVALID_ARGUMENT;

    CefTextureProbe_Shutdown();

    std::lock_guard<std::mutex> lock(g.mutex);
    auto* raw = static_cast<ID3D11Device*>(d3d11_device);
    g.device = raw;
    if (FAILED(g.device.As(&g.device1))) {
        g.device.Reset();
        return CEF_TEX_D3D11_DEVICE1_UNAVAILABLE;
    }
    ComPtr<IDXGIDevice> dxgiDevice;
    ComPtr<IDXGIAdapter> adapter;
    DXGI_ADAPTER_DESC adapterDesc{};
    if (SUCCEEDED(g.device.As(&dxgiDevice)) && SUCCEEDED(dxgiDevice->GetAdapter(&adapter)) &&
        SUCCEEDED(adapter->GetDesc(&adapterDesc))) {
        g.adapter_luid = adapterDesc.AdapterLuid;
    }
    g.device->GetImmediateContext(&g.context);
    if (!g.context) {
        g.device1.Reset();
        g.device.Reset();
        return CEF_TEX_NOT_INITIALIZED;
    }

    ComPtr<ID3D11Multithread> multithread;
    if (SUCCEEDED(g.context.As(&multithread))) {
        multithread->SetMultithreadProtected(TRUE);
    }
    return CEF_TEX_OK;
}

CefGpuAdapterDiagnostics CefTextureProbe_GetGpuAdapterDiagnostics() {
    CefGpuAdapterDiagnostics d{};
    std::lock_guard<std::mutex> lock(g.mutex);
    d.unity_luid_high = g.adapter_luid.HighPart;
    d.unity_luid_low = g.adapter_luid.LowPart;
    d.open_shared_resource_failures = g.open_failures.load(std::memory_order_acquire);
    d.last_open_shared_hresult = g.last_open_hr.load(std::memory_order_acquire);
    return d;
}


uint64_t CefTextureProbe_CreateSurface() {
    auto surface = std::make_shared<SurfaceState>();
    const uint64_t id = g.next_surface_id.fetch_add(1, std::memory_order_acq_rel);
    std::lock_guard<std::mutex> lock(g.mutex);
    if (!g.device1 || !g.context) return 0;
    surface->last_status.store(CEF_TEX_OK, std::memory_order_release);
    g.surfaces.emplace(id, std::move(surface));
    return id;
}

void CefTextureProbe_DestroySurface(uint64_t surface_id) {
    std::shared_ptr<SurfaceState> surface;
    {
        std::lock_guard<std::mutex> lock(g.mutex);
        const auto it = g.surfaces.find(surface_id);
        if (it == g.surfaces.end()) return;
        surface = it->second;
        g.surfaces.erase(it);
    }
    if (surface) ResetSurface(*surface);
}

int32_t CefTextureProbe_CopyAcceleratedFrameForSurface(
    uint64_t surface_id, void* cef_shared_handle) {
    const auto surface = FindSurface(surface_id);
    if (!surface) return CEF_TEX_SURFACE_NOT_FOUND;
    const int32_t result = CopyIntoSurface(*surface, cef_shared_handle);
    return SetStatus(surface, result);
}

void CefTextureProbe_NotifySoftwareFrameForSurface(uint64_t surface_id) {
    const auto surface = FindSurface(surface_id);
    if (surface) surface->software_frame_count.fetch_add(1, std::memory_order_acq_rel);
}

void* CefTextureProbe_GetUnityTextureForSurface(uint64_t surface_id) {
    const auto surface = FindSurface(surface_id);
    if (!surface) return nullptr;
    std::lock_guard<std::mutex> lock(surface->mutex);
    return surface->destination.Get();
}

CefTextureProbeStats CefTextureProbe_GetStatsForSurface(uint64_t surface_id) {
    const auto surface = FindSurface(surface_id);
    if (!surface) {
        CefTextureProbeStats missing{};
        missing.last_status = CEF_TEX_SURFACE_NOT_FOUND;
        return missing;
    }
    return ReadStats(*surface);
}

// Legacy single-surface API.
int32_t CefTextureProbe_CopyAcceleratedFrame(void* cef_shared_handle) {
    const int32_t result = CopyIntoSurface(g_legacy, cef_shared_handle);
    return SetLegacyStatus(result);
}
void CefTextureProbe_NotifySoftwareFrame() {
    g_legacy.software_frame_count.fetch_add(1, std::memory_order_acq_rel);
}
void* CefTextureProbe_GetUnityTexture() {
    std::lock_guard<std::mutex> lock(g_legacy.mutex);
    return g_legacy.destination.Get();
}
CefTextureProbeStats CefTextureProbe_GetStats() {
    return ReadStats(g_legacy);
}

void CefTextureProbe_Shutdown() {
    std::unordered_map<uint64_t, std::shared_ptr<SurfaceState>> surfaces;
    {
        std::lock_guard<std::mutex> lock(g.mutex);
        surfaces.swap(g.surfaces);
        g.context.Reset();
        g.device1.Reset();
        g.device.Reset();
    }
    for (auto& kv : surfaces) {
        if (kv.second) ResetSurface(*kv.second);
    }
    ResetSurface(g_legacy);
}

} // extern "C"
#endif
