using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace Company.WebView.EditorTools
{
    /// <summary>
    /// Unity's PluginImporter does not copy arbitrary CEF .pak/.dat locale resources.
    /// Always stage the validated CEF sidecars beside the built Windows Player.
    /// This is an additive preview stage; source binaries are never modified.
    /// </summary>
    public sealed class CompanyWebViewBuildStage : IPostprocessBuildWithReport
    {
        public int callbackOrder { get { return 200; } }

        public void OnPostprocessBuild(BuildReport report)
        {
            if (report.summary.platform != BuildTarget.StandaloneWindows64)
                return; // Preview is Windows-only; package compile itself may target editor.
            var package = FindPackageRoot();
            var source = Path.Combine(package, "Runtime/Plugins/x86_64");
            if (!Directory.Exists(source))
                throw new BuildFailedException("CEF native payload is missing from the preview UPM package: " + source);
            var executable = report.summary.outputPath;
            if (!File.Exists(executable))
                throw new BuildFailedException("Windows Player exe missing: " + executable);
            var baseName = Path.GetFileNameWithoutExtension(executable);
            var data = Path.Combine(Path.GetDirectoryName(executable), baseName + "_Data");
            var destination = Path.Combine(data, "Plugins/x86_64");
            CopyNativeResources(source, destination);
            Debug.Log("Company WebView preview native sidecars staged: " + destination);
        }

        private static string FindPackageRoot()
        {
            // The menu script lives in the same UPM Editor directory as this processor.
            var guids = AssetDatabase.FindAssets("CompanyWebViewPrefabWizard t:MonoScript");
            foreach (var guid in guids)
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                if (!path.EndsWith("/Editor/CompanyWebViewPrefabWizard.cs", StringComparison.Ordinal))
                    continue;
                return Path.GetFullPath(Path.Combine(Path.GetDirectoryName(path), ".."));
            }
            throw new BuildFailedException("Cannot locate the Company WebView UPM Editor source");
        }

        private static void CopyNativeResources(string source, string destination)
        {
            var required = new [] {
                "CompanyWebViewCefTextureProbe.dll", "CompanyWebView2UnifiedPreview.dll",
                "CompanyWebViewCefSubprocess.exe", "libcef.dll", "icudtl.dat",
                "resources.pak", "chrome_100_percent.pak", "locales/en-US.pak"
            };
            foreach (var file in required)
            {
                if (!File.Exists(Path.Combine(source, file)))
                    throw new BuildFailedException("CEF/WebView2 resource missing: " + file);
            }
            var allowed = new [] { ".dll", ".exe", ".pak", ".dat", ".bin" };
            foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
            {
                var extension = Path.GetExtension(file).ToLowerInvariant();
                if (Array.IndexOf(allowed, extension) < 0) continue;
                var relative = file.Substring(source.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                var output = Path.Combine(destination, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(output));
                File.Copy(file, output, true);
                if (new FileInfo(file).Length != new FileInfo(output).Length)
                    throw new BuildFailedException("Copied native resource size mismatch: " + relative);
            }
        }
    }
}
