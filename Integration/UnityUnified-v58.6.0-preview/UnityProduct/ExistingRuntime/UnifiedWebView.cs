using System;

namespace Company.WebView.Unified.Experimental
{
    // Experimental additive facade: does not replace the validated CEF public WebView class.
    public enum PresentationMode { Auto, Texture, Overlay }
    public enum TargetKind { None, ScreenRect, RawImage, MeshMaterial, RenderTexture }

    public sealed class UnifiedWebViewOptions
    {
        public PresentationMode Mode { get; set; } = PresentationMode.Auto;
        public TargetKind Target { get; set; } = TargetKind.None;
        public string Url { get; set; } = "about:blank";
        public int Width { get; set; } = 1280;
        public int Height { get; set; } = 720;
        public int TargetFrameRate { get; set; } = 60;
        public string CefSubprocessPath { get; set; }
        public string CefCachePath { get; set; }
        // Safe default false. Controlled-page title messages are NOT origin-authenticated RPC.
        public bool EnableCefPageTitleMessages { get; set; } = false;
        // Native Win32 HWND owned by the current Unity Windows Player process (Overlay only).
        public IntPtr OverlayParentHwnd { get; set; }
        public int OverlayX { get; set; }
        public int OverlayY { get; set; }
    }

    public sealed class WebViewCapabilities
    {
        public bool Navigation { get; internal set; }
        public bool TextureSurface { get; internal set; }
        public bool ScriptExecution { get; internal set; }
        public bool Messages { get; internal set; } // full native PostMessage and read
        public bool PageToUnityMessages { get; internal set; } // may be limited to controlled pages
        public bool NativeInput { get; internal set; }
        public bool FullImeComposition { get; internal set; }
        public bool MultiWebView { get; internal set; }
    }

    internal interface IUnifiedBackend : IDisposable
    {
        WebViewCapabilities Capabilities { get; }
        void Open(UnifiedWebViewOptions options);
        void LoadUrl(string url);
        void Reload();
        void Stop();
        void GoBack();
        void GoForward();
        void Resize(int width, int height);
        void SetBounds(int x,int y,int width,int height);
        void NotifyParentMoved();
        void Pump();
        bool TryReadMessage(out string message);
        void PostMessage(string value);
        void ExecuteJavaScript(string script);
        bool IsReady { get; }
        bool IsShutdownComplete { get; }
        void Close();
    }

    public sealed class UnifiedWebView : IDisposable
    {
        private IUnifiedBackend driver;
        private bool disposed;
        public PresentationMode Mode { get; private set; }
        public WebViewCapabilities Capabilities { get; private set; }
        public bool IsReady { get { AssertActive(); return driver.IsReady; } }
        public bool IsShutdownComplete { get { AssertActive(); return driver.IsShutdownComplete; } }
        public event Action<string> MessageReceived;

        private UnifiedWebView(PresentationMode mode, IUnifiedBackend backend)
        {
            Mode = mode;
            driver = backend;
            Capabilities = backend.Capabilities;
        }

        public static PresentationMode ResolveMode(PresentationMode requested, TargetKind target)
        {
            if (!Enum.IsDefined(typeof(PresentationMode), requested) ||
                !Enum.IsDefined(typeof(TargetKind), target))
                throw new ArgumentOutOfRangeException("mode/target", "Invalid rendering selection");
            bool textureTarget = target == TargetKind.RawImage || target == TargetKind.MeshMaterial || target == TargetKind.RenderTexture;
            bool overlayTarget = target == TargetKind.ScreenRect || target == TargetKind.None;
            PresentationMode mode = requested == PresentationMode.Auto
                ? (textureTarget ? PresentationMode.Texture : PresentationMode.Overlay)
                : requested;
            if (mode == PresentationMode.Texture && !textureTarget)
                throw new ArgumentException("Texture mode requires RawImage, MeshMaterial or RenderTexture target");
            if (mode == PresentationMode.Overlay && !overlayTarget)
                throw new ArgumentException("Overlay mode cannot render into a Unity texture target");
            return mode;
        }

        public static UnifiedWebView Create(UnifiedWebViewOptions options)
        {
            return CreateCore(options, null);
        }

        // A private/internal factory seam enables deterministic runtime-contract tests without native DLLs.
        internal static UnifiedWebView CreateCore(UnifiedWebViewOptions options, Func<PresentationMode, IUnifiedBackend> factory)
        {
            if (options == null) throw new ArgumentNullException(nameof(options));
            var mode = ResolveMode(options.Mode, options.Target);
            if (options.Width < 1 || options.Height < 1 || options.TargetFrameRate < 1)
                throw new ArgumentOutOfRangeException(nameof(options), "Dimensions and frame rate must be positive");
            if (String.IsNullOrWhiteSpace(options.Url))
                throw new ArgumentException("A URL or about:blank is required", nameof(options));
            if (factory == null && mode == PresentationMode.Overlay && options.OverlayParentHwnd == IntPtr.Zero)
                throw new ArgumentException("Overlay requires a valid current-process Unity Player HWND", nameof(options));
            if (factory == null && mode == PresentationMode.Texture &&
                (String.IsNullOrWhiteSpace(options.CefSubprocessPath) || String.IsNullOrWhiteSpace(options.CefCachePath)))
                throw new ArgumentException("CEF Texture requires validated subprocess and cache paths");
            IUnifiedBackend backend = factory != null ? factory(mode)
                : (mode == PresentationMode.Overlay ? (IUnifiedBackend)new WebView2OverlayBackendBridge() : new CefTextureBackendBridge());
            if (backend == null) throw new InvalidOperationException("Backend factory returned null");
            try
            {
                backend.Open(options);
                return new UnifiedWebView(mode, backend);
            }
            catch
            {
                backend.Dispose();
                throw;
            }
        }

        private void AssertActive()
        {
            if (disposed || driver == null) throw new ObjectDisposedException(nameof(UnifiedWebView));
        }
        private void AssertNavigation()
        {
            AssertActive();
            if (!Capabilities.Navigation) throw new NotSupportedException("Navigation is unavailable in the selected prototype backend");
        }
        public void LoadUrl(string url) { AssertNavigation(); if (String.IsNullOrWhiteSpace(url)) throw new ArgumentException("Missing URL", nameof(url)); driver.LoadUrl(url); }
        public void Reload() { AssertNavigation(); driver.Reload(); }
        public void Stop() { AssertNavigation(); driver.Stop(); }
        public void GoBack() { AssertNavigation(); driver.GoBack(); }
        public void GoForward() { AssertNavigation(); driver.GoForward(); }
        public void SetBounds(int x,int y,int width,int height)
        {
            AssertActive();
            if(width < 1 || height < 1) throw new ArgumentOutOfRangeException(nameof(width));
            driver.SetBounds(x,y,width,height);
        }
        public void NotifyParentMoved() { AssertActive();driver.NotifyParentMoved(); }
        public void Resize(int width, int height)
        {
            AssertActive();
            if (width < 1 || height < 1) throw new ArgumentOutOfRangeException(nameof(width));
            driver.Resize(width, height);
        }
        // Called once each Unity main-thread Update; do not call from worker threads.
        public void Pump() {
            AssertActive(); driver.Pump();
            if(!Capabilities.Messages && !Capabilities.PageToUnityMessages) return;
            string msg;
            int guard=0;
            while(guard++<32 && driver.TryReadMessage(out msg))
                MessageReceived?.Invoke(msg);
        }
        public void Close() { AssertActive(); driver.Close(); }
        public void PostMessage(string data) {
            AssertActive();
            if(!Capabilities.Messages) throw new NotSupportedException("Messages unsupported in this backend");
            if(data==null)throw new ArgumentNullException(nameof(data));
            driver.PostMessage(data);
        }
        // Fire-and-forget dispatch. Script result / exception propagation remains unimplemented.
        public void ExecuteJavaScript(string script) {
            AssertActive();
            if(!Capabilities.ScriptExecution) throw new NotSupportedException("Script execution unsupported in this backend");
            if(String.IsNullOrWhiteSpace(script)) throw new ArgumentException("Empty script", nameof(script));
            driver.ExecuteJavaScript(script);
        }
        public void Dispose()
        {
            if (disposed) return;
            var backend = driver;
            if (backend != null) backend.Dispose();
            driver = null;
            disposed = true;
            GC.SuppressFinalize(this);
        }
    }
}

