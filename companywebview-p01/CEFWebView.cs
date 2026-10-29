using System;
using System.Threading;
using System.Threading.Tasks;

namespace Company.WebView
{
    /// <summary>Public Windows CEF WebView facade for the validated texture backend.</summary>
    public sealed class WebView : IDisposable
    {
        private bool initialized;
        private bool browserOpen;

        public bool IsInitialized => initialized;
        public bool IsOpen => browserOpen;

        public int Initialize(string subprocessPath, string cachePath)
        {
            if (initialized) return 0;
            var rc = WebViewRuntime.CefPrototype_Initialize(subprocessPath, cachePath);
            if (rc == 0 || rc == 1) initialized = true;
            return rc;
        }

        public int Open(string url, int width = 1280, int height = 720, int targetFrameRate = 60, bool externalBeginFrame = false)
        {
            if (!initialized) throw new InvalidOperationException("WebView must be initialized before Open.");
            var rc = WebViewRuntime.CefPrototype_CreateBrowser(url, Math.Max(1,width), Math.Max(1,height), Math.Max(1,targetFrameRate), externalBeginFrame ? 1 : 0);
            if (rc == 0) browserOpen = true;
            return rc;
        }

        public void LoadUrl(string url) { EnsureOpen(); WebViewRuntime.CefPrototype_LoadUrl(url); }
        public void Reload() { EnsureOpen(); WebViewRuntime.CefPrototype_CompatibilityReload(); }
        public void Stop() { EnsureOpen(); WebViewRuntime.CefPrototype_CompatibilityStop(); }
        public void GoBack() { EnsureOpen(); WebViewRuntime.CefPrototype_CompatibilityGoBack(); }
        public void GoForward() { EnsureOpen(); WebViewRuntime.CefPrototype_CompatibilityGoForward(); }
        public void Resize(int width, int height) { EnsureOpen(); WebViewRuntime.CefPrototype_Resize(Math.Max(1,width), Math.Max(1,height)); }
        public void PumpMessageLoop() { if (initialized) WebViewRuntime.CefPrototype_DoMessageLoopWork(); }
        public int Close(int timeoutMs = 5000)
        {
            if (!browserOpen) return 0;
            var rc = WebViewRuntime.CefPrototype_CloseBrowserAndWait(Math.Max(0, timeoutMs));
            if (rc == 0) browserOpen = false;
            return rc;
        }
        public int Shutdown(int timeoutMs = 8000)
        {
            if (!initialized) return 0;
            Close(timeoutMs);
            var rc = WebViewRuntime.CefPrototype_ShutdownBlocking(Math.Max(0, timeoutMs));
            if (rc == 0) initialized = false;
            return rc;
        }
        private void EnsureOpen() { if (!initialized || !browserOpen) throw new InvalidOperationException("WebView is not open."); }
        public void Dispose() { Shutdown(); GC.SuppressFinalize(this); }
    }
}
