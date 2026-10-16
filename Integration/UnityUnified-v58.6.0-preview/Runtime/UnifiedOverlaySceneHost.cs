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
        // Programmatic Unicode fixture tests UTF-16 transport, not keyboard IME composition.
        private const string UnicodeFixture="한글 가나다 ABC123 😀";
        public int UnicodeRoundtripCount { get; private set; }
        public int PingRoundtripCount { get; private set; }
        public int TrustedCompositionStarts { get; private set; }
        public int TrustedCompositionEnds { get; private set; }
        public int TrustedInputBatches { get; private set; }
        public string ImeCandidateVerdict { get; private set; } = "NOT_TESTED";
        public string Dpi100Verdict { get; private set; } = "NOT_TESTED";
        public string Dpi125Verdict { get; private set; } = "NOT_TESTED";
        public string Dpi150Verdict { get; private set; } = "NOT_TESTED";
        public string ZOrderVerdict { get; private set; } = "NOT_TESTED";
        public int DpiMin { get; private set; }
        public int DpiMax { get; private set; }
        public int DistinctObservedDpiCount { get { return observedDpis.Count; } }
        // DPI values are OS-reported for Unity's HWND, not proof of physical monitor scaling.
        public bool Dpi100Observed { get { return observedDpis.Contains(96); } }
        public bool Dpi125Observed { get { return observedDpis.Contains(120); } }
        public bool Dpi150Observed { get { return observedDpis.Contains(144); } }
        public int BoundsSamples { get; private set; }
        public int MaxBoundsDeltaPx { get; private set; }
        public int ChildOutsideClientSamples { get; private set; }
        public int ForegroundLostCount { get; private set; }
        public int ForegroundRegainedCount { get; private set; }
        public int MinimizeTransitions { get; private set; }
        public int RestoreTransitions { get; private set; }
        public bool ChildHostSeen { get; private set; }
        private readonly System.Collections.Generic.HashSet<int> observedDpis =
            new System.Collections.Generic.HashSet<int>();
        private float lastCompatSampleTime;
        private bool foregroundSampled,wasForeground,iconicSampled,wasIconic;
        // Only event labels / user-declared verdicts leave the browser: NEVER typed content.
        // isTrusted ensures scripted input events are not counted as keyboard interaction.
        private const string ManualCompatibilityPage = @"(function(){
          if(window.__cwvCompatInstalled)return;
          window.__cwvCompatInstalled=true;
          document.body.style.cssText='background:#eef3ff;color:#142039;padding:12px;font:14px Segoe UI,Arial';
          document.body.innerHTML=`
            <h2 style='margin:0 0 6px'>WebView2 HWND / Windows Compatibility</h2>
            <p style='margin:4px 0 8px'>Right: real Korean IME; move/resize Unity; Alt+Tab and restore. No typed text is recorded.</p>
            <textarea id='cwv-ime' aria-label='Manual Korean IME input' rows='3' style='font:20px Segoe UI;width:96%;box-sizing:border-box' placeholder='한글 가나다 abc123 😀'></textarea>
            <p id='cwv-counters'>Trusted IME start/end: 0 / 0; input: 0</p><p>IME composition START and END must increment during actual Hangul input. If they stay zero, the telemetry cannot confirm IME composition even if text appears.</p>
            <div><b>1. Korean IME candidate popup and caret</b><p><button data-v='ime-pass'>PASS</button> <button data-v='ime-fail'>FAIL</button> <span id='cwv-ime-verdict'>NOT TESTED</span></p></div>
            <div><b>2. At actual Windows display scale (user-reported)</b><p>Only click PASS for the Windows Settings scale actually tested. A single 100% session does NOT test 125% or 150%. Your Unity window's reported DPI is checked separately after exit.</p>
            <p style='line-height:2'>100%: <button data-v='dpi100-pass'>PASS</button> <button data-v='dpi100-fail'>FAIL</button> <span id='cwv-dpi100-verdict'>NOT TESTED</span></p>
            <p style='line-height:2'>125%: <button data-v='dpi125-pass'>PASS</button> <button data-v='dpi125-fail'>FAIL</button> <span id='cwv-dpi125-verdict'>NOT TESTED</span></p>
            <p style='line-height:2'>150%: <button data-v='dpi150-pass'>PASS</button> <button data-v='dpi150-fail'>FAIL</button> <span id='cwv-dpi150-verdict'>NOT TESTED</span></p></div>
            <div><b>3. Alt+Tab / minimize / Z-order</b><p><button data-v='zorder-pass'>PASS</button> <button data-v='zorder-fail'>FAIL</button> <span id='cwv-zorder-verdict'>NOT TESTED</span></p></div>
            <p style='font-size:12px'>Verdicts are your visual observations, not automatic pass. Only test scale values actually configured. Leave the Player open until it exits and writes evidence.</p>`;
          const send=(kind)=>{chrome.webview.postMessage('compat-v1|'+kind);};
          const input=document.getElementById('cwv-ime');
          const counts={start:0,end:0,input:0};
          const render=()=>{document.getElementById('cwv-counters').textContent='Trusted IME start/end: '+counts.start+' / '+counts.end+'; input: '+counts.input;};
          let lastInput=0;
          input.addEventListener('compositionstart',e=>{if(e.isTrusted){counts.start++;send('ime-start');render();}});
          input.addEventListener('compositionend',e=>{if(e.isTrusted){counts.end++;send('ime-end');render();}});
          input.addEventListener('input',e=>{if(e.isTrusted){counts.input++;if(Date.now()-lastInput>350){lastInput=Date.now();send('trusted-input');}render();}});
          document.querySelectorAll('button[data-v]').forEach(b=>b.addEventListener('click',e=>{
            if(!e.isTrusted)return;
            const code=b.getAttribute('data-v');send(code);
            const key=code.startsWith('ime-')?'ime':code.startsWith('zorder-')?'zorder':code.substring(0,6);
            const target=document.getElementById('cwv-'+key+'-verdict');
            if(target)target.textContent=code.endsWith('pass')?'PASS':'FAIL';
          }));
        })();";
        private void HandleCompatibilityEvent(string message)
        {
            // Strict allowlist, never retain user input values or arbitrary messages.
            switch(message){
                case "compat-v1|ime-start": TrustedCompositionStarts++;break;
                case "compat-v1|ime-end": TrustedCompositionEnds++;break;
                case "compat-v1|trusted-input": TrustedInputBatches++;break;
                case "compat-v1|ime-pass": ImeCandidateVerdict="PASS";break;
                case "compat-v1|ime-fail": ImeCandidateVerdict="FAIL";break;
                case "compat-v1|dpi100-pass": Dpi100Verdict="PASS";break;
                case "compat-v1|dpi100-fail": Dpi100Verdict="FAIL";break;
                case "compat-v1|dpi125-pass": Dpi125Verdict="PASS";break;
                case "compat-v1|dpi125-fail": Dpi125Verdict="FAIL";break;
                case "compat-v1|dpi150-pass": Dpi150Verdict="PASS";break;
                case "compat-v1|dpi150-fail": Dpi150Verdict="FAIL";break;
                case "compat-v1|zorder-pass": ZOrderVerdict="PASS";break;
                case "compat-v1|zorder-fail": ZOrderVerdict="FAIL";break;
            }
        }
        public bool RequestDualShutdown(){
            if(view==null)return false;
            if(closingForDualTest)return true;
            try {view.Close();closingForDualTest=true;return true;}
            catch(Exception e){Debug.LogError("Dual overlay close request ERROR: "+e);return false;}
        }
        public void SendDualProbe(){
            if(!IsOverlayReady)return;
            view.ExecuteJavaScript("chrome.webview.postMessage('dual-unity-bridge-ping');" +
                "chrome.webview.postMessage('한글 가나다 ABC123 😀');");
        }

#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
        [StructLayout(LayoutKind.Sequential)]
        private struct RECT { public int left,top,right,bottom; }
        [StructLayout(LayoutKind.Sequential)]
        private struct POINT { public int x,y; }
        [DllImport("user32.dll",CharSet=CharSet.Unicode)]
        private static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string className,string title);
        [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr hwnd);
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] [return:MarshalAs(UnmanagedType.Bool)]
        private static extern bool IsIconic(IntPtr hwnd);
        [DllImport("user32.dll")] [return:MarshalAs(UnmanagedType.Bool)]
        private static extern bool ScreenToClient(IntPtr hwnd,ref POINT point);
        private void SampleCompatibilityWindow()
        {
            if(parent==IntPtr.Zero || Time.realtimeSinceStartup-lastCompatSampleTime<0.5f)return;
            lastCompatSampleTime=Time.realtimeSinceStartup;
            uint dpi=GetDpiForWindow(parent);
            if(dpi>=72 && dpi<=768){
                observedDpis.Add((int)dpi);
                if(DpiMin==0 || dpi<DpiMin)DpiMin=(int)dpi;
                if(dpi>DpiMax)DpiMax=(int)dpi;
            }
            bool foreground=GetForegroundWindow()==parent;
            if(foregroundSampled){
                if(wasForeground && !foreground)ForegroundLostCount++;
                if(!wasForeground && foreground)ForegroundRegainedCount++;
            }
            foregroundSampled=true;wasForeground=foreground;
            bool iconic=IsIconic(parent);
            if(iconicSampled){
                if(!wasIconic && iconic)MinimizeTransitions++;
                if(wasIconic && !iconic)RestoreTransitions++;
            }
            iconicSampled=true;wasIconic=iconic;
            if(iconic)return;
            IntPtr host=FindWindowEx(parent,IntPtr.Zero,"CompanyWV2UnityPilotHost",null);
            if(host==IntPtr.Zero)return;
            uint pid;
            if(GetWindowThreadProcessId(host,out pid)==0 || pid!=(uint)Process.GetCurrentProcess().Id)return;
            ChildHostSeen=true;
            RECT child,client;
            if(!GetWindowRect(host,out child) || !GetClientRect(parent,out client))return;
            POINT upper=new POINT{x=child.left,y=child.top};
            if(!ScreenToClient(parent,ref upper))return;
            int width=child.right-child.left,height=child.bottom-child.top;
            if(width<=0 || height<=0)return;
            BoundsSamples++;
            int max=Math.Max(Math.Abs(upper.x-lastBounds.x),Math.Abs(upper.y-lastBounds.y));
            max=Math.Max(max,Math.Abs(width-lastBounds.width));
            max=Math.Max(max,Math.Abs(height-lastBounds.height));
            MaxBoundsDeltaPx=Math.Max(MaxBoundsDeltaPx,max);
            if(upper.x< -4 || upper.y< -4 || upper.x+width>client.right+4 || upper.y+height>client.bottom+4)
                ChildOutsideClientSamples++;
        }
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
                    if(msg==UnicodeFixture)UnicodeRoundtripCount++;
                    if(msg=="dual-unity-bridge-ping")PingRoundtripCount++;
                    if(msg.StartsWith("compat-v1|",StringComparison.Ordinal))HandleCompatibilityEvent(msg);
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
                SampleCompatibilityWindow();
                if(!readyLogged){
                    readyLogged=true;
                    Debug.Log("WV2 Unified controller ready");
                    // Visible offline sample page: independent of any external network.
                    view.ExecuteJavaScript(ManualCompatibilityPage);
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
