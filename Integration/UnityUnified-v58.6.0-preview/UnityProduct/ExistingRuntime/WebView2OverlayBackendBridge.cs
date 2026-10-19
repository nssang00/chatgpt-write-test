using System;
using System.Runtime.InteropServices;
using System.Text;

namespace Company.WebView.Unified.Experimental
{
    // UNIFIED_PREVIEW native DLL is separate from the validated v58.5.2 r5 pilot DLL.
    // Win32 child-HWND singleton, not a multi-view product backend.
    internal sealed class WebView2OverlayBackendBridge : IUnifiedBackend
    {
        private const string Dll = "CompanyWebView2UnifiedPreview";
        [DllImport(Dll, CallingConvention=CallingConvention.Cdecl, CharSet=CharSet.Unicode)]
        private static extern int WV2Unified_Open(IntPtr parent,int x,int y,int w,int h,[MarshalAs(UnmanagedType.LPWStr)] string url);
        [DllImport(Dll, CallingConvention=CallingConvention.Cdecl, CharSet=CharSet.Unicode)]
        private static extern int WV2Unified_Navigate([MarshalAs(UnmanagedType.LPWStr)] string url);
        [DllImport(Dll, CallingConvention=CallingConvention.Cdecl, CharSet=CharSet.Unicode)]
        private static extern int WV2Unified_ExecuteScript([MarshalAs(UnmanagedType.LPWStr)] string script);
        [DllImport(Dll, CallingConvention=CallingConvention.Cdecl, CharSet=CharSet.Unicode)]
        private static extern int WV2Unified_PostMessage([MarshalAs(UnmanagedType.LPWStr)] string message);
        [DllImport(Dll, CallingConvention=CallingConvention.Cdecl, CharSet=CharSet.Unicode)]
        private static extern int WV2Unified_Reload();
        [DllImport(Dll, CallingConvention=CallingConvention.Cdecl, CharSet=CharSet.Unicode)]
        private static extern int WV2Unified_Stop();
        [DllImport(Dll, CallingConvention=CallingConvention.Cdecl, CharSet=CharSet.Unicode)]
        private static extern int WV2Unified_GoBack();
        [DllImport(Dll, CallingConvention=CallingConvention.Cdecl, CharSet=CharSet.Unicode)]
        private static extern int WV2Unified_GoForward();
        // WebView2 native produces UTF-16 wchar_t*. ANSI StringBuilder marshaling loses Unicode.
        [DllImport(Dll, CallingConvention=CallingConvention.Cdecl, CharSet=CharSet.Unicode)]
        private static extern int WV2Unified_ReadMessage([Out] StringBuilder output,int capacity);
        [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Unified_GetState();
        [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Unified_GetLastError();
        [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Unified_GetCommandError();
        [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Unified_GetDroppedMessageCount();
        [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Unified_SetBounds(int x,int y,int w,int h);
        [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Unified_NotifyParentMoved();
        [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Unified_RequestClose();
        [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Unified_Close(uint timeoutMs);
        [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Unified_GetShutdownPhase();

        private readonly StringBuilder messageBuffer = new StringBuilder(65537);
        private bool opened, closing, joined, disposed;
        private int x,y;
        public WebViewCapabilities Capabilities { get; } = new WebViewCapabilities {
            Navigation=true,TextureSurface=false,ScriptExecution=true,Messages=true,PageToUnityMessages=true,
            FullImeComposition=false,MultiWebView=false
        };
        public bool IsReady { get { return opened && !closing && WV2Unified_GetState()==2; } }
        public bool IsShutdownComplete { get { return joined; } }
        public void Open(UnifiedWebViewOptions options) {
            if(disposed)throw new ObjectDisposedException(nameof(WebView2OverlayBackendBridge));
            if(options.OverlayParentHwnd == IntPtr.Zero)throw new ArgumentException("Unity HWND required");
            x=options.OverlayX;y=options.OverlayY;
            int rc=WV2Unified_Open(options.OverlayParentHwnd,x,y,options.Width,options.Height,options.Url);
            if(rc!=0)throw new InvalidOperationException("WebView2 native open failed: "+rc);
            opened=true; // asynchronous STA initialization, poll IsReady
        }
        private void CheckReady() {
            if(!opened || closing || disposed)throw new InvalidOperationException("WebView2 is not open");
            if(!IsReady)throw new InvalidOperationException("WebView2 STA controller not ready; try after IsReady is true");
            int err=WV2Unified_GetLastError();
            if(err<0)throw new InvalidOperationException("WebView2 runtime error: "+err);
        }
        private static void Require(int result,string operation) {
            if(result!=0)throw new InvalidOperationException(operation+" failed: "+result);
        }
        public void LoadUrl(string url) { CheckReady();Require(WV2Unified_Navigate(url),"navigate"); }
        public void Reload() { CheckReady();Require(WV2Unified_Reload(),"reload"); }
        public void Stop() { CheckReady();Require(WV2Unified_Stop(),"stop"); }
        public void GoBack() { CheckReady();Require(WV2Unified_GoBack(),"back"); }
        public void GoForward() { CheckReady();Require(WV2Unified_GoForward(),"forward"); }
        public void PostMessage(string message) { CheckReady();Require(WV2Unified_PostMessage(message),"post"); }
        public void ExecuteJavaScript(string script) { CheckReady();Require(WV2Unified_ExecuteScript(script),"script"); }
        public bool TryReadMessage(out string message) {
            message=null;
            if(!opened || closing || disposed)return false;
            messageBuffer.Clear();
            int n=WV2Unified_ReadMessage(messageBuffer,messageBuffer.Capacity);
            if(n==0)return false;
            if(n<0)throw new InvalidOperationException("WebView2 read failed: "+n);
            message=messageBuffer.ToString();
            return true;
        }
        public void Resize(int width,int height) { SetBounds(x,y,width,height); }
        public void SetBounds(int nx,int ny,int width,int height) {
            CheckReady();
            Require(WV2Unified_SetBounds(nx,ny,width,height),"bounds");
            x=nx;y=ny;
        }
        public void NotifyParentMoved() { CheckReady();Require(WV2Unified_NotifyParentMoved(),"parent moved"); }
        public void Pump() {
            if(!opened || disposed)return;
            int state=WV2Unified_GetState();
            if(state<0)throw new InvalidOperationException("WebView2 STA error: "+state);
            if(!closing && WV2Unified_GetCommandError()!=0)
                throw new InvalidOperationException("WebView2 async COM command failed: "+WV2Unified_GetCommandError());
            if(!closing && WV2Unified_GetDroppedMessageCount()!=0)
                throw new InvalidOperationException("WebView2 incoming message overflow");
            if(closing && !joined && WV2Unified_GetShutdownPhase()>=6) {
                int rc=WV2Unified_Close(0);Require(rc,"join");
                joined=true;
            }
        }
        public void Close() {
            if(!opened || closing || disposed)return;
            Require(WV2Unified_RequestClose(),"request close");
            closing=true;
        }
        public void Dispose() {
            if(disposed)return;
            if(opened && !closing)Close();
            if(opened && !joined) {
                // If still pending, do not unload this DLL; fail explicitly to avoid hiding a -30 timeout.
                int rc=WV2Unified_Close(2000);
                Require(rc,"WebView2 join");
                joined=true;
            }
            opened=false;disposed=true;
        }
    }
}

