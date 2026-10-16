using System;
using System.IO;
using UnityEngine;
using UnityEngine.UI;
using Company.WebView.Unified.Experimental;

namespace Company.WebView.Unified.Experimental
{
    // Integration preview scene host (CEF texture ONLY; not a signed/product prefab).
    // Pair with the validated CefTextureSurface component; assign the same RawImage
    // to CefTextureSurface.target in Inspector. No duplicate CefWebViewController.
    public sealed class UnifiedTextureSceneHost : MonoBehaviour
    {
        [SerializeField] private RawImage rawImage;
        [SerializeField] private CefTextureSurface validatedTextureSurface;
        [SerializeField] private string initialUrl = "about:blank";
        [SerializeField] private int width = 1280;
        [SerializeField] private int height = 720;
        [SerializeField] private int targetFrameRate = 60;
        private UnifiedWebView view;
        public bool IsTextureBackendReady { get { return view != null && view.IsReady; } }
        public bool IsPreviewShutdownComplete { get; private set; }
        public bool StopForDualTest() {
            var old=view;view=null;
            if(old==null)return false;
            try { old.Close();old.Dispose();IsPreviewShutdownComplete=true;return true; }
            catch(Exception e){Debug.LogError("Dual CEF close ERROR: "+e);return false;}
        }

        private void Start()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (rawImage == null || validatedTextureSurface == null)
            {
                Debug.LogError("Unified preview requires RawImage and existing CefTextureSurface; assign its target in Inspector.");
                return;
            }
            try
            {
                var pluginPath = Path.Combine(Application.dataPath, "Plugins", "x86_64");
                var cachePath = Path.Combine(Application.temporaryCachePath, "CompanyWebView-UnifiedPreview");
                Directory.CreateDirectory(cachePath);
                view = UnifiedWebView.Create(new UnifiedWebViewOptions {
                    Mode = PresentationMode.Texture,
                    Target = TargetKind.RawImage,
                    Url = initialUrl,
                    Width = width,
                    Height = height,
                    TargetFrameRate = targetFrameRate,
                    CefSubprocessPath = Path.Combine(pluginPath, "CompanyWebViewCefSubprocess.exe"),
                    CefCachePath = cachePath
                });
            }
            catch (Exception e)
            {
                Debug.LogError("Unified Texture preview failed: " + e);
                if (view != null) { try { view.Dispose(); } catch (Exception) { } view = null; }
            }
#else
            Debug.LogWarning("Unified Texture preview is standalone Windows D3D11 only. Unity Editor execution is disabled.");
#endif
        }
        private void Update()
        {
            if (view != null) view.Pump();
        }
        public void LoadUrl(string url)
        {
            if (view == null) throw new InvalidOperationException("Texture preview not initialized");
            view.LoadUrl(url);
        }
        private void OnDestroy()
        {
            var previous = view;
            view = null;
            if (previous != null)
            {
                // A scene destroy is not the dual-test orderly shutdown sequence.
                // Close the browser before the validated CEF Shutdown/Dispose path.
                try { previous.Close(); }
                catch (Exception ex) { Debug.LogError("CEF browser Close FAILED: " + ex); }
                try { previous.Dispose(); IsPreviewShutdownComplete=true; }
                catch (Exception ex) { Debug.LogError("CEF cleanup FAILED: " + ex); }
            }
        }
    }
}
