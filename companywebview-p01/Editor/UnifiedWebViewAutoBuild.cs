using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;
using UnityEngine.Rendering;

namespace Company.WebView.Unified.Editor
{
    // Invoked by Unity -batchmode -executeMethod, never by the old five-minute test harness.
    // It creates only preview assets in the isolated destination project.
    public static class UnifiedWebViewAutoBuild
    {
        public static void Build()
        {
            if (Application.unityVersion != "2022.3.62f3")
                throw new InvalidOperationException("Expected verified Unity 2022.3.62f3, got " + Application.unityVersion);
            if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.StandaloneWindows64)
                throw new InvalidOperationException("Use -buildTarget Win64 with Windows Build Support installed");

            string output = null;
            var args = Environment.GetCommandLineArgs();
            for (int i = 0; i + 1 < args.Length; ++i)
                if (args[i] == "-productBuildPath") output = args[i + 1];
            if (String.IsNullOrWhiteSpace(output) || !Path.IsPathRooted(output))
                throw new ArgumentException("-productBuildPath requires an absolute Windows .exe path");
            if (!output.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("Product output must be a Windows .exe file");

            // Never open interactive Save Scene dialogs during unattended builds.
            const string scene = "Assets/CompanyWebViewGenerated/DualPreview.unity";
            UnifiedWebViewSetupMenu.CreateExampleSceneBatch();
            if (!File.Exists(scene)) throw new FileNotFoundException("Example scene was not saved", scene);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(scene, true) };
            PlayerSettings.companyName = "Company";
            PlayerSettings.productName = "Company WebView UPM Preview";
            PlayerSettings.defaultScreenWidth = 1400;
            PlayerSettings.defaultScreenHeight = 850;
            PlayerSettings.fullScreenMode = FullScreenMode.Windowed;
            PlayerSettings.resizableWindow = true;
            PlayerSettings.runInBackground = true;
            PlayerSettings.SetGraphicsAPIs(BuildTarget.StandaloneWindows64,
                new[] { GraphicsDeviceType.Direct3D11 });

            Directory.CreateDirectory(Path.GetDirectoryName(output));
            var options = new BuildPlayerOptions {
                scenes = new[] { scene },
                locationPathName = output,
                target = BuildTarget.StandaloneWindows64,
                options = BuildOptions.None
            };
            var report = BuildPipeline.BuildPlayer(options);
            if (report == null || report.summary.result != BuildResult.Succeeded || !File.Exists(output))
                throw new InvalidOperationException("Windows UPM preview BuildPlayer failed; check Editor log");
            Debug.Log("[UPM AUTO] SUCCESS: prefabs, scene, Windows D3D11 Player and CEF support files: " + output);
        }
    }
}
