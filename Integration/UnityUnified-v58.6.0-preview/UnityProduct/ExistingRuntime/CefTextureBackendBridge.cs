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
        private string lastTitle;
        private bool hasTitle;
        private long lastTitlePollTicks;
        private const string TitlePrefix = "cwmsg:v1:";
        public WebViewCapabilities Capabilities { get; } = new WebViewCapabilities
        {
            Navigation = true,
            TextureSurface = true,
            ScriptExecution = false, // old public facade exposes no generic ExecuteJavaScript
            Messages = false,       // Unity->CEF native messaging still unavailable
            PageToUnityMessages = false, // opt-in, controlled-page document.title polling only
            NativeInput = true,      // pinned DLL already exports Interaction* functions
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
            Capabilities.PageToUnityMessages = options.EnableCefPageTitleMessages;
            hasTitle = false;
            lastTitle = null;
            lastTitlePollTicks = 0;
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
        // The pinned CEF binary has no JS callback/ExecuteScript export.
        // Controlled local pages can emit ONE message per distinct title via
        // document.title = 'cwmsg:v1:' + sequence + ':' + encodeURIComponent(text).
        // This is deliberately NOT a general-purpose/reliable JS bridge.
        public bool TryReadMessage(out string message)
        {
            message = null;
            if (!opened || disposed || !Capabilities.PageToUnityMessages) return false;
            var nowTicks = DateTime.UtcNow.Ticks;
            if (nowTicks - lastTitlePollTicks < TimeSpan.TicksPerMillisecond * 100) return false;
            lastTitlePollTicks = nowTicks;
            var title = Company.WebView.WebViewRuntime.GetTitle();
            if (hasTitle && String.Equals(lastTitle, title, StringComparison.Ordinal)) return false;
            hasTitle = true;
            lastTitle = title;
            if (String.IsNullOrEmpty(title) || !title.StartsWith(TitlePrefix, StringComparison.Ordinal)) return false;
            var payload = title.Substring(TitlePrefix.Length);
            int separator = payload.IndexOf(':');
            if (separator <= 0 || separator == payload.Length - 1 || payload.Length > 3200) return false;
            for (int i = 0; i < separator; ++i)
                if (payload[i] < '0' || payload[i] > '9') return false;
            try { message = Uri.UnescapeDataString(payload.Substring(separator + 1)); }
            catch (UriFormatException) { return false; }
            return true;
        }
        public void PostMessage(string data) { throw new NotSupportedException("CEF 58.4.4 public facade has no unified message bridge yet"); }
        public void ExecuteJavaScript(string script) { throw new NotSupportedException("CEF 58.4.4 public facade has no unified script bridge yet"); }
        public void Close()
        {
            if (!opened || disposed) return;
            int rc = validatedCef.Close();
            if (rc != 0) throw new InvalidOperationException("CEF close incomplete: " + rc);
            opened = false;
            hasTitle = false;
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
            hasTitle = false;
        }
    }
}

