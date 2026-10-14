// Compile-only signatures from the pinned CEF 58.4.4 public source, never a runtime proof.
namespace Company.WebView
{
    public sealed class WebView
    {
        public int Initialize(string subprocessPath, string cachePath) { return 0; }
        public int Open(string url, int width, int height, int targetFrameRate, bool externalBeginFrame) { return 0; }
        public void LoadUrl(string url) { }
        public void Reload() { }
        public void Stop() { }
        public void GoBack() { }
        public void GoForward() { }
        public void Resize(int width, int height) { }
        public void PumpMessageLoop() { }
        public int Close(int timeoutMs = 5000) { return 0; }
        public int Shutdown(int timeoutMs = 8000) { return 0; }
    }
}
