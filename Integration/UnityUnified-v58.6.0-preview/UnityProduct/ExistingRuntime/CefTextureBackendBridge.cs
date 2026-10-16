using System;

namespace Company.WebView.Unified.Experimental
{
    // Delegates to the actual, unchanged v58.4.4 Company.WebView.WebView implementation.
    // Unity's existing CefTextureSurface MonoBehaviour owns RawImage texture presentation.
    internal sealed class CefTextureBackendBridge : IUnifiedBackend
    {
        private readonly Company.WebView.WebView validatedCef = new Company.WebView.WebView();
        private bool opened;
        private bool disposed;
        public WebViewCapabilities Capabilities { get; } = new WebViewCapabilities
        {
            Navigation = true,
            TextureSurface = true,
            ScriptExecution = false, // old public facade exposes no generic ExecuteJavaScript
            Messages = false,       // v58.4.4 native JS bridge not surfaced via this facade
            FullImeComposition = false,
            MultiWebView = false     // this facade wraps the singleton interface
        };
        public void Open(UnifiedWebViewOptions options)
        {
            if (disposed) throw new ObjectDisposedException(nameof(CefTextureBackendBridge));
            int rc = validatedCef.Initialize(options.CefSubprocessPath, options.CefCachePath);
            if (rc != 0 && rc != 1) throw new InvalidOperationException("CEF Initialize failed: " + rc);
            rc = validatedCef.Open(options.Url, options.Width, options.Height, options.TargetFrameRate, false);
            if (rc != 0) throw new InvalidOperationException("CEF CreateBrowser failed: " + rc);
            opened = true;
        }
        public void LoadUrl(string url) { RequireOpen(); validatedCef.LoadUrl(url); }
        public void Reload() { RequireOpen(); validatedCef.Reload(); }
        public void Stop() { RequireOpen(); validatedCef.Stop(); }
        public void GoBack() { RequireOpen(); validatedCef.GoBack(); }
        public void GoForward() { RequireOpen(); validatedCef.GoForward(); }
        public void Resize(int width, int height) { RequireOpen(); validatedCef.Resize(width, height); }
        public void SetBounds(int x,int y,int width,int height) { Resize(width,height); }
        public void NotifyParentMoved() { }
        public void Pump() { if (opened && !disposed) validatedCef.PumpMessageLoop(); }
        public bool IsReady { get { return opened && !disposed; } }
        public bool IsShutdownComplete { get { return !opened; } }
        public bool TryReadMessage(out string message) { message=null; return false; }
        public void PostMessage(string data) { throw new NotSupportedException("CEF 58.4.4 public facade has no unified message bridge yet"); }
        public void ExecuteJavaScript(string script) { throw new NotSupportedException("CEF 58.4.4 public facade has no unified script bridge yet"); }
        public void Close()
        {
            if (!opened || disposed) return;
            int rc = validatedCef.Close();
            if (rc != 0) throw new InvalidOperationException("CEF close incomplete: " + rc);
            opened = false;
        }
        private void RequireOpen()
        {
            if (disposed) throw new ObjectDisposedException(nameof(CefTextureBackendBridge));
            if (!opened) throw new InvalidOperationException("CEF browser is not open");
        }
        public void Dispose()
        {
            if (disposed) return;
            // Keep original CEF shutdown code responsible for native lifetime; do not force DLL unload.
            int rc = validatedCef.Shutdown();
            if (rc != 0) throw new InvalidOperationException("CEF shutdown incomplete: " + rc);
            disposed = true;
            opened = false;
        }
    }
}

