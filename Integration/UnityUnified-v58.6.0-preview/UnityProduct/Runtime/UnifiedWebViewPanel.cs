using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.UI;
using Debug = UnityEngine.Debug;

namespace Company.WebView.Unified.Experimental
{
    // First product-facing Windows preview component. One CEF Texture and one WebView2
    // Overlay may coexist; multiple instances of the SAME backend are NOT supported.
    [DisallowMultipleComponent]
    [AddComponentMenu("Company WebView/Unified WebView Panel (Preview)")]
    public sealed class UnifiedWebViewPanel : MonoBehaviour
    {
        [SerializeField] private PresentationMode mode = PresentationMode.Texture;
        [SerializeField] private string initialUrl = "about:blank";
        [SerializeField] [Min(1)] private int browserWidth = 1024;
        [SerializeField] [Min(1)] private int browserHeight = 768;
        [SerializeField] [Range(1, 240)] private int targetFrameRate = 60;
        [SerializeField] private RawImage textureTarget;
        [SerializeField] private CefTextureSurface textureSurface;
        [SerializeField] private RectTransform overlayTarget;
        [SerializeField] private Canvas targetCanvas;

        private static UnifiedWebViewPanel activeTexture, activeOverlay;
        private UnifiedWebView view;
        private IntPtr parentWindow;
        private RectInt lastBounds;
        private bool ownsSlot, closing;
        private PresentationMode activeMode;
        private WinRect lastWindow;
        private bool windowObserved;
        public PresentationMode Mode => mode;
        public bool IsReady => view != null && !closing && view.IsReady;
        public WebViewCapabilities Capabilities => view != null ? view.Capabilities : null;
        public event Action<string> MessageReceived;

        [StructLayout(LayoutKind.Sequential)] private struct WinRect { public int left, top, right, bottom; }
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
        [DllImport("user32.dll")] private static extern IntPtr GetActiveWindow();
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetClientRect(IntPtr hwnd, out WinRect rect);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetWindowRect(IntPtr hwnd, out WinRect rect);
#endif
        private void Start()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            try
            {
                var resolved = UnifiedWebView.ResolveMode(mode,
                    mode == PresentationMode.Texture ? TargetKind.RawImage : TargetKind.ScreenRect);
                activeMode = resolved;
                if (resolved == PresentationMode.Texture)
                {
                    if (activeTexture != null && activeTexture != this)
                        throw new InvalidOperationException("CEF Texture is single-instance in v58.6.0 Preview");
                    if (textureTarget == null || textureSurface == null)
                        throw new InvalidOperationException("Texture mode needs RawImage and CefTextureSurface. Use the prefab generator.");
                    activeTexture = this;
                    ownsSlot = true;
                    var nativeRoot = Path.Combine(Application.dataPath, "Plugins", "x86_64");
                    var subprocess = Path.Combine(nativeRoot, "CompanyWebViewCefSubprocess.exe");
                    if (!File.Exists(subprocess))
                        throw new FileNotFoundException("Native CEF files missing; use Build-UnityProduct.ps1 to package the validated stage", subprocess);
                    var cache = Path.Combine(Application.temporaryCachePath, "CompanyWebView", "Texture");
                    Directory.CreateDirectory(cache);
                    view = UnifiedWebView.Create(new UnifiedWebViewOptions {
                        Mode = PresentationMode.Texture, Target = TargetKind.RawImage,
                        Url = initialUrl, Width = browserWidth, Height = browserHeight,
                        TargetFrameRate = targetFrameRate, CefSubprocessPath = subprocess,
                        CefCachePath = cache
                    });
                }
                else
                {
                    if (activeOverlay != null && activeOverlay != this)
                        throw new InvalidOperationException("WebView2 Overlay is single-instance in v58.6.0 Preview");
                    if (overlayTarget == null || targetCanvas == null)
                        throw new InvalidOperationException("Overlay mode needs RectTransform and Canvas. Use the prefab generator.");
                    parentWindow = GetActiveWindow();
                    if (parentWindow == IntPtr.Zero)
                        parentWindow = Process.GetCurrentProcess().MainWindowHandle;
                    uint pid;
                    if (parentWindow == IntPtr.Zero || GetWindowThreadProcessId(parentWindow, out pid) == 0 ||
                        pid != (uint)Process.GetCurrentProcess().Id)
                        throw new InvalidOperationException("A Unity Player owned HWND is required for Overlay mode");
                    WinRect client;
                    if (!GetClientRect(parentWindow, out client))
                        throw new InvalidOperationException("Unable to resolve Unity Player client rect");
                    lastBounds = GetPixelBounds(client);
                    activeOverlay = this;
                    ownsSlot = true;
                    view = UnifiedWebView.Create(new UnifiedWebViewOptions {
                        Mode = PresentationMode.Overlay, Target = TargetKind.ScreenRect,
                        OverlayParentHwnd = parentWindow,
                        OverlayX = lastBounds.x, OverlayY = lastBounds.y,
                        Width = lastBounds.width, Height = lastBounds.height, Url = initialUrl
                    });
                }
                view.MessageReceived += OnNativeMessage;
            }
            catch (Exception e) { Debug.LogError("Unified WebView Panel initialization failed: " + e, this); Close(); }
#else
            Debug.LogWarning("Unified WebView Panel requires Windows x64 Standalone D3D11; it does not run inside the Editor.", this);
#endif
        }

        private void OnNativeMessage(string text) => MessageReceived?.Invoke(text);
        private RectInt GetPixelBounds(WinRect client)
        {
            var corners = new Vector3[4];
            overlayTarget.GetWorldCorners(corners);
            var camera = targetCanvas.renderMode == RenderMode.ScreenSpaceOverlay ? null : targetCanvas.worldCamera;
            var bottomLeft = RectTransformUtility.WorldToScreenPoint(camera, corners[0]);
            var topRight = RectTransformUtility.WorldToScreenPoint(camera, corners[2]);
            float sx = client.right / (float)Mathf.Max(1, Screen.width);
            float sy = client.bottom / (float)Mathf.Max(1, Screen.height);
            return new RectInt(Mathf.RoundToInt(bottomLeft.x * sx),
                Mathf.RoundToInt((Screen.height - topRight.y) * sy),
                Mathf.Max(1, Mathf.RoundToInt((topRight.x - bottomLeft.x) * sx)),
                Mathf.Max(1, Mathf.RoundToInt((topRight.y - bottomLeft.y) * sy)));
        }

        private void Update()
        {
            if (view == null || closing) return;
            try
            {
                view.Pump();
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
                if (activeMode == PresentationMode.Overlay && view.IsReady)
                {
                    WinRect client;
                    if (GetClientRect(parentWindow, out client))
                    {
                        var bounds = GetPixelBounds(client);
                        if (bounds.x != lastBounds.x || bounds.y != lastBounds.y ||
                            bounds.width != lastBounds.width || bounds.height != lastBounds.height)
                        {
                            view.SetBounds(bounds.x, bounds.y, bounds.width, bounds.height);
                            lastBounds = bounds;
                        }
                    }
                    // Do not enqueue native move notifications on every Unity frame.
                    WinRect window;
                    if (GetWindowRect(parentWindow, out window))
                    {
                        if (windowObserved && (window.left != lastWindow.left || window.top != lastWindow.top ||
                            window.right != lastWindow.right || window.bottom != lastWindow.bottom))
                            view.NotifyParentMoved();
                        lastWindow = window;
                        windowObserved = true;
                    }
                }
#endif
            }
            catch (Exception e) { Debug.LogError("Unified WebView Panel update failed: " + e, this); Close(); }
        }

        public void LoadUrl(string url) { if (view == null) throw new InvalidOperationException("WebView not started"); view.LoadUrl(url); }
        public void Reload() { if (view == null) throw new InvalidOperationException("WebView not started"); view.Reload(); }
        public void GoBack() { if (view == null) throw new InvalidOperationException("WebView not started"); view.GoBack(); }
        public void GoForward() { if (view == null) throw new InvalidOperationException("WebView not started"); view.GoForward(); }
        public void ExecuteJavaScript(string script) { if (view == null) throw new InvalidOperationException("WebView not started"); view.ExecuteJavaScript(script); }
        public void PostMessage(string message) { if (view == null) throw new InvalidOperationException("WebView not started"); view.PostMessage(message); }
        public void Close()
        {
            if (closing) return;
            closing = true;
            var previous = view;
            view = null;
            if (previous != null)
            {
                try { previous.Close(); previous.Dispose(); }
                catch (Exception e) { Debug.LogError("Unified WebView Panel close failed: " + e, this); }
            }
            if (ownsSlot)
            {
                if (activeTexture == this) activeTexture = null;
                if (activeOverlay == this) activeOverlay = null;
                ownsSlot = false;
            }
        }
        private void OnDestroy() => Close();
    }
}

