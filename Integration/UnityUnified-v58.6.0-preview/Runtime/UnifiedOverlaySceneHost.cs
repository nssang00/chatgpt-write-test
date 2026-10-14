using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using UnityEngine;
using Debug = UnityEngine.Debug;

namespace Company.WebView.Unified.Experimental
{
    // Scene component can coexist with UnifiedTextureSceneHost in one Windows Player.
    // THIS IS A SINGLE HWND prototype, not a released multi-view product component.
    public sealed class UnifiedOverlaySceneHost : MonoBehaviour
    {
        [SerializeField] private bool enablePreview = false;
        [SerializeField] private RectTransform targetRect;
        [SerializeField] private Canvas canvas;
        [SerializeField] private string url = "about:blank";
        private UnifiedWebView view;
        private IntPtr parent;
        private RECT lastWindow;
        private bool hasWindow;
        private RectInt lastBounds;
        private bool readyLogged;
        private bool closingForDualTest;
        public bool IsOverlayReady { get { return view != null && !closingForDualTest && view.IsReady; } }
        public bool IsPreviewShutdownComplete { get { return view != null && view.IsShutdownComplete; } }
        public int ReceivedMessageCount { get; private set; }
        public bool RequestDualShutdown(){
            if(view==null)return false;
            if(closingForDualTest)return true;
            try {view.Close();closingForDualTest=true;return true;}
            catch(Exception e){Debug.LogError("Dual overlay close request ERROR: "+e);return false;}
        }
        public void SendDualProbe(){
            if(!IsOverlayReady)return;
            view.ExecuteJavaScript("chrome.webview.postMessage('dual-unity-bridge-ping')");
        }

#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
        [StructLayout(LayoutKind.Sequential)]
        private struct RECT { public int left,top,right,bottom; }
        [DllImport("user32.dll")] private static extern IntPtr GetActiveWindow();
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
        [DllImport("user32.dll")] [return:MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetClientRect(IntPtr hwnd,out RECT rect);
        [DllImport("user32.dll")] [return:MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetWindowRect(IntPtr hwnd,out RECT rect);
        private static bool Different(RECT a,RECT b) =>
            a.left!=b.left || a.top!=b.top || a.right!=b.right || a.bottom!=b.bottom;
        private RectInt PixelBounds(RECT client)
        {
            if(targetRect==null)
                return new RectInt(0,0,Math.Max(1,client.right),Math.Max(1,client.bottom));
            var corners=new Vector3[4];
            targetRect.GetWorldCorners(corners);
            var cam=canvas!=null && canvas.renderMode!=RenderMode.ScreenSpaceOverlay ? canvas.worldCamera : null;
            var min=RectTransformUtility.WorldToScreenPoint(cam,corners[0]);
            var max=RectTransformUtility.WorldToScreenPoint(cam,corners[2]);
            float sx=(float)client.right / Math.Max(1,Screen.width);
            float sy=(float)client.bottom / Math.Max(1,Screen.height);
            return new RectInt(Mathf.RoundToInt(min.x*sx),
                Mathf.RoundToInt((Screen.height-max.y)*sy),
                Math.Max(1,Mathf.RoundToInt((max.x-min.x)*sx)),
                Math.Max(1,Mathf.RoundToInt((max.y-min.y)*sy)));
        }
        private void Start()
        {
            if(!enablePreview)return;
            parent=GetActiveWindow();
            if(parent==IntPtr.Zero)parent=Process.GetCurrentProcess().MainWindowHandle;
            uint pid;
            if(parent==IntPtr.Zero || GetWindowThreadProcessId(parent,out pid)==0 ||
                pid!=(uint)Process.GetCurrentProcess().Id)
            {
                Debug.LogError("Unified overlay: invalid parent Unity Player HWND");
                return;
            }
            RECT client;
            if(!GetClientRect(parent,out client)) {Debug.LogError("Unified overlay: no client bounds");return;}
            lastBounds=PixelBounds(client);
            try {
                view=UnifiedWebView.Create(new UnifiedWebViewOptions{
                    Mode=PresentationMode.Overlay,
                    Target=TargetKind.ScreenRect,
                    OverlayParentHwnd=parent,
                    OverlayX=lastBounds.x,
                    OverlayY=lastBounds.y,
                    Width=lastBounds.width,
                    Height=lastBounds.height,
                    Url=url
                });
                view.MessageReceived += msg => {
                    ReceivedMessageCount++;
                    Debug.Log("WV2 Unified message received (length): "+msg.Length);
                };
            } catch(Exception e){Debug.LogError("Unified overlay open failed: "+e);}
        }
        private void Update()
        {
            if(view==null)return;
            try{
                view.Pump();
                if(closingForDualTest)return;
                if(!view.IsReady)return;
                if(!readyLogged){
                    readyLogged=true;
                    Debug.Log("WV2 Unified controller ready");
                    // Visible offline sample page: independent of any external network.
                    view.ExecuteJavaScript("document.body.innerHTML='<h2>WebView2 Overlay RIGHT</h2><p>Unified Win32 child HWND</p><input placeholder=\"Korean IME\" />';document.body.style.background='#eef3ff';document.body.style.padding='24px';");
                }
                RECT client;
                if(GetClientRect(parent,out client)) {
                    var current=PixelBounds(client);
                    if(current.x!=lastBounds.x || current.y!=lastBounds.y ||
                       current.width!=lastBounds.width || current.height!=lastBounds.height)
                    {
                        view.SetBounds(current.x,current.y,current.width,current.height);
                        lastBounds=current;
                    }
                }
                RECT win;
                if(GetWindowRect(parent,out win)) {
                    if(hasWindow && Different(lastWindow,win))view.NotifyParentMoved();
                    lastWindow=win;hasWindow=true;
                }
            } catch(Exception e){Debug.LogError("Unified overlay runtime ERROR: "+e);enabled=false;}
        }
        // Inspector/context menu manual checks after controller-ready message in Player log.
        [ContextMenu("Send Unity-to-WebView2 JavaScript Probe")]
        private void ScriptProbe(){
            if(view==null || !view.IsReady)return;
            view.ExecuteJavaScript("chrome.webview.postMessage('Hello from WebView2 to Unity');");
        }
        private void OnDestroy(){
            var old=view;view=null;
            if(old!=null)try{old.Dispose();}catch(Exception e){Debug.LogError("Unified overlay close/join FAILED: "+e);}
        }
#else
        private struct RECT { public int left,top,right,bottom; }
        private void Start(){
            if(enablePreview) Debug.LogWarning("Unified Overlay preview requires a Windows x64 Unity Standalone Player");
        }
#endif
    }
}
