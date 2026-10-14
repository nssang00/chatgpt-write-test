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
    }

    public sealed class WebViewCapabilities
    {
        public bool Navigation { get; internal set; }
        public bool TextureSurface { get; internal set; }
        public bool ScriptExecution { get; internal set; }
        public bool Messages { get; internal set; }
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
        void Pump();
        void Close();
    }

    public sealed class UnifiedWebView : IDisposable
    {
        private IUnifiedBackend driver;
        private bool disposed;
        public PresentationMode Mode { get; private set; }
        public WebViewCapabilities Capabilities { get; private set; }

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
            // Prevent silent fallback: the audited r5 WebView2 pilot has no generic Navigate API,
            // no lifecycle ownership contract, and only supports one fixed HTML sample.
            if (factory == null && mode == PresentationMode.Overlay)
                throw new NotSupportedException("WebView2 Overlay is an independently validated HWND pilot only; unified URL/HTML API not yet integrated.");
            if (factory == null && (String.IsNullOrWhiteSpace(options.CefSubprocessPath) || String.IsNullOrWhiteSpace(options.CefCachePath)))
                throw new ArgumentException("CEF Texture requires validated subprocess and cache paths");
            IUnifiedBackend backend = factory != null ? factory(mode) : new CefTextureBackendBridge();
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
        public void Resize(int width, int height)
        {
            AssertActive();
            if (width < 1 || height < 1) throw new ArgumentOutOfRangeException(nameof(width));
            driver.Resize(width, height);
        }
        // Called once each Unity main-thread Update; do not call from worker threads.
        public void Pump() { AssertActive(); driver.Pump(); }
        public void Close() { AssertActive(); driver.Close(); }
        public void PostMessage(string data) { AssertActive(); throw new NotSupportedException("Unified JS messaging is not yet connected to both native backends"); }
        public void ExecuteJavaScript(string script) { AssertActive(); throw new NotSupportedException("Unified JavaScript execution is not yet connected to both native backends"); }
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
