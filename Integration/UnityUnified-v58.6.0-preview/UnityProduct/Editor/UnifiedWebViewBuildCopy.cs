using System;
using System.IO;
using Company.WebView.Unified.Experimental;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.PackageManager;
using UnityEngine;

namespace Company.WebView.Unified.Editor
{
    // The large pinned CEF runtime lives in NativePayload~ and is deliberately not
    // imported into the Unity Editor. Copy it only for a Windows standalone build.
    public sealed class UnifiedWebViewBuildCopy : IPostprocessBuildWithReport
    {
        public int callbackOrder => 100;
        public void OnPostprocessBuild(BuildReport report)
        {
            if (report.summary.platform != BuildTarget.StandaloneWindows64) return;
            // Both UnityEditor.PackageInfo and UnityEditor.PackageManager.PackageInfo exist in Unity 2022.
            var info = UnityEditor.PackageManager.PackageInfo.FindForAssembly(typeof(UnifiedWebViewPanel).Assembly);
            if (info == null) throw new BuildFailedException("Company WebView UPM PackageInfo not found");
            var native = Path.Combine(info.resolvedPath, "NativePayload~", "x86_64");
            var required = new[] { "libcef.dll", "CompanyWebViewCefSubprocess.exe",
                "icudtl.dat", "resources.pak", "chrome_100_percent.pak",
                Path.Combine("locales", "en-US.pak") };
            foreach (var file in required)
                if (!File.Exists(Path.Combine(native, file)))
                    throw new BuildFailedException("Missing pinned CEF runtime: " + file +
                        ". Assemble the UPM package using Build-UnityProduct.ps1 and the validated local CEF stage.");
            var dataDir = Path.Combine(Path.GetDirectoryName(report.summary.outputPath),
                Path.GetFileNameWithoutExtension(report.summary.outputPath) + "_Data");
            var dest = Path.Combine(dataDir, "Plugins", "x86_64");
            Directory.CreateDirectory(dest);
            foreach (var file in Directory.GetFiles(native, "*", SearchOption.AllDirectories))
            {
                var rel = file.Substring(native.Length).TrimStart(Path.DirectorySeparatorChar);
                var target = Path.Combine(dest, rel);
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                File.Copy(file, target, true);
            }
            // These two plugin DLLs are managed by Unity's native PluginImporter.
            if (!File.Exists(Path.Combine(dest, "CompanyWebViewCefTextureProbe.dll")) ||
                !File.Exists(Path.Combine(dest, "CompanyWebView2UnifiedPreview.dll")))
                throw new BuildFailedException("CEF/WebView2 x64 plugin DLL missing from Windows Player. Recheck plugin import settings.");
            Debug.Log("Company WebView UPM: copied validated CEF runtime support files to Windows Player.");
        }
    }
}

