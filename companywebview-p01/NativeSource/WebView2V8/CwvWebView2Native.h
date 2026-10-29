#pragma once
// Experimental per-view WebView2 v8 ABI. Host calls are asynchronous; never block Unity UI.
// All COM objects are owned and accessed by a dedicated STA worker thread.
#include <stdint.h>
#ifdef _WIN32
#include <windows.h>
#define CWV_EXPORT extern "C" __declspec(dllexport)
#else
#define CWV_EXPORT extern "C"
#endif
// Success 0; failure <0. A nonzero handle means 'accepted for async creation', not ready.
CWV_EXPORT int CWV_WV2V8_Open(void* parent, int x, int y, int w, int h,
                             const wchar_t* exactLocalUrl, uint64_t* outHandle);
// ready: 0=initializing, 2=ready, -1=failed, -2=closed.
CWV_EXPORT int CWV_WV2V8_State(uint64_t handle);
CWV_EXPORT int CWV_WV2V8_SetBounds(uint64_t handle,int x,int y,int w,int h);
CWV_EXPORT int CWV_WV2V8_ExecuteScript(uint64_t handle,const wchar_t* script);
CWV_EXPORT int CWV_WV2V8_PostString(uint64_t handle,const wchar_t* message);
// UTF-8 payload, null-terminated; 0 means empty. Requires capacity >=65537.
CWV_EXPORT int CWV_WV2V8_ReadMessage(uint64_t handle,char* output,int capacity);
CWV_EXPORT int CWV_WV2V8_Close(uint64_t handle);
CWV_EXPORT int CWV_WV2V8_LastError(uint64_t handle);
// Call once on Unity Application.quitting, never per Scene/view. Permanently stops STA.
CWV_EXPORT int CWV_WV2V8_Shutdown();
