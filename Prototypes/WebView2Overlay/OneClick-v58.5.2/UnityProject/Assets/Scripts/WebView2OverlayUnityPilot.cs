// Experimental Windows player-only sample. Not a product backend.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using UnityEngine;
using Debug = UnityEngine.Debug;

namespace Company.WebView.Prototypes
{
    public sealed class WebView2OverlayUnityPilot : MonoBehaviour
    {
        [SerializeField] private bool enablePilot = false;
        [SerializeField] private RectTransform targetRect;
        [SerializeField] private Canvas canvas;
        private IntPtr playerHwnd;
        private bool started;
        private bool readyLogged;
        private bool closeAttempted;
        private RectInt lastBounds = new RectInt(0, 0, 0, 0);
        private RECT lastWindowRect;
        private bool hadWindowRect;

#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
        [StructLayout(LayoutKind.Sequential)]
        private struct RECT { public int left, top, right, bottom; }
        [DllImport("user32.dll")] private static extern IntPtr GetActiveWindow();
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
        [DllImport("CompanyWebView2OverlayPilot", CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Pilot_Open(IntPtr parent, int x, int y, int width, int height);
        [DllImport("CompanyWebView2OverlayPilot", CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Pilot_SetBounds(int x, int y, int width, int height);
        [DllImport("CompanyWebView2OverlayPilot", CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Pilot_SetVisible(int visible);
        [DllImport("CompanyWebView2OverlayPilot", CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Pilot_NotifyParentMoved();
        [DllImport("CompanyWebView2OverlayPilot", CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Pilot_GetState();
        [DllImport("CompanyWebView2OverlayPilot", CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Pilot_GetLastError();
        [DllImport("CompanyWebView2OverlayPilot", CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Pilot_GetPongCount();
        [DllImport("CompanyWebView2OverlayPilot", CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Pilot_Close(uint timeoutMs);

        private static bool Different(RECT a, RECT b)
        {
            return a.left!=b.left || a.top!=b.top || a.right!=b.right || a.bottom!=b.bottom;
        }
        private RectInt PixelBounds(RECT client)
        {
            if(targetRect==null) return new RectInt(0, 0, Math.Max(1,client.right), Math.Max(1,client.bottom));
            var corners = new Vector3[4];
            targetRect.GetWorldCorners(corners);
            Camera cam = canvas!=null && canvas.renderMode!=RenderMode.ScreenSpaceOverlay ? canvas.worldCamera : null;
            var min = RectTransformUtility.WorldToScreenPoint(cam, corners[0]);
            var max = RectTransformUtility.WorldToScreenPoint(cam, corners[2]);
            float sx = (float)client.right / Math.Max(1,Screen.width);
            float sy = (float)client.bottom / Math.Max(1,Screen.height);
            // Unity screen pixels are bottom-left origin; Win32 client pixels are top-left origin.
            int x = Mathf.RoundToInt(min.x*sx);
            int y = Mathf.RoundToInt((Screen.height-max.y)*sy);
            int width = Mathf.RoundToInt((max.x-min.x)*sx);
            int height = Mathf.RoundToInt((max.y-min.y)*sy);
            return new RectInt(x,y,Math.Max(1,width),Math.Max(1,height));
        }
        private void Start()
        {
            if(!enablePilot) return; // explicit opt-in to prevent overlay in production scenes
            playerHwnd=GetActiveWindow();
            if(playerHwnd==IntPtr.Zero) playerHwnd=Process.GetCurrentProcess().MainWindowHandle;
            if(playerHwnd==IntPtr.Zero) { Debug.LogError("WV2 Pilot: no active Unity player HWND"); return; }
            uint processId;
            GetWindowThreadProcessId(playerHwnd,out processId);
            if(processId!=(uint)Process.GetCurrentProcess().Id)
            {
                Debug.LogError("WV2 Pilot: HWND does not belong to Unity process");return;
            }
            RECT client;
            if(!GetClientRect(playerHwnd,out client)) { Debug.LogError("WV2 Pilot: GetClientRect failed");return; }
            lastBounds=PixelBounds(client);
            try {
                int rc=WV2Pilot_Open(playerHwnd,lastBounds.x,lastBounds.y,lastBounds.width,lastBounds.height);
                if(rc!=0) { Debug.LogError("WV2 Pilot open failed: "+rc);return; }
                started=true;
                Debug.Log("WV2 Pilot started; HWND child overlay. Unity UGUI cannot draw over this surface.");
            } catch(DllNotFoundException ex) { Debug.LogError("Missing native pilot DLL: "+ex.Message); }
              catch(EntryPointNotFoundException ex) { Debug.LogError("Native pilot export missing: "+ex.Message); }
        }
        private void Update()
        {
            if(!started) return;
            int state=WV2Pilot_GetState();
            if(state<0) { Debug.LogError("WV2 Pilot state failure "+state+" / "+WV2Pilot_GetLastError()); StopPilot(); return; }
            if(state==2 && !readyLogged)
            {
                readyLogged=true; Debug.Log("WV2 Pilot WebView2 ready. Ping clicks: "+WV2Pilot_GetPongCount());
            }
            RECT client;
            if(GetClientRect(playerHwnd,out client))
            {
                RectInt current=PixelBounds(client);
                if(current.x != lastBounds.x || current.y != lastBounds.y ||
                   current.width != lastBounds.width || current.height != lastBounds.height)
                {
                    WV2Pilot_SetBounds(current.x, current.y, current.width, current.height);
                    lastBounds=current;
                }
            }
            RECT windowRect;
            if(GetWindowRect(playerHwnd,out windowRect))
            {
                if(hadWindowRect && Different(lastWindowRect,windowRect)) WV2Pilot_NotifyParentMoved();
                hadWindowRect=true;lastWindowRect=windowRect;
            }
        }
        private void OnDisable() { StopPilot(); }
        private void OnApplicationQuit() { StopPilot(); }
        private void OnDestroy() { StopPilot(); }
        private void StopPilot()
        {
            if(!started || closeAttempted) return;
            closeAttempted=true;
            int rc=WV2Pilot_Close(5000);
            if(rc!=0) Debug.LogError("WV2 Pilot close timeout/failure "+rc+"; DO NOT unload native DLL");
            else started=false;
        }
#else
        private struct RECT { public int left, top, right, bottom; }
        private void Start()
        {
            if(enablePilot) Debug.LogWarning("WV2 Pilot only runs in Windows x64 standalone Player, not Unity Editor.");
        }
#endif
    }
}
