// Managed-only compile harness; not Unity Editor or native Player execution.
using System;
namespace UnityEngine {
    public static class Application { public static string unityVersion => "2022.3.62f3"; }
    public static class Debug { public static void Log(object value) {} }
    public enum FullScreenMode { Windowed }
}
namespace UnityEngine.Rendering {
    public enum GraphicsDeviceType { Direct3D11 }
}
namespace UnityEditor {
    public enum BuildTarget { StandaloneWindows64 }
    public enum BuildOptions { None }
    public static class EditorUserBuildSettings { public static BuildTarget activeBuildTarget => BuildTarget.StandaloneWindows64; }
    public static class PlayerSettings {
        public static string companyName {get;set;}
        public static string productName {get;set;}
        public static int defaultScreenWidth {get;set;}
        public static int defaultScreenHeight {get;set;}
        public static UnityEngine.FullScreenMode fullScreenMode {get;set;}
        public static bool resizableWindow {get;set;}
        public static bool runInBackground {get;set;}
        public static void SetGraphicsAPIs(BuildTarget t, UnityEngine.Rendering.GraphicsDeviceType[] d) {}
    }
    public sealed class EditorBuildSettingsScene {
        public EditorBuildSettingsScene(string path,bool enabled) {}
    }
    public static class EditorBuildSettings {public static EditorBuildSettingsScene[] scenes {get;set;} }
    public sealed class BuildPlayerOptions {
        public string[] scenes; public string locationPathName; public BuildTarget target; public BuildOptions options;
    }
    public static class BuildPipeline {
        public static UnityEditor.Build.Reporting.BuildReport BuildPlayer(BuildPlayerOptions options) =>
            new UnityEditor.Build.Reporting.BuildReport();
    }
}
namespace UnityEditor.Build.Reporting {
    public enum BuildResult { Succeeded, Failed }
    public sealed class BuildSummary { public BuildResult result => BuildResult.Succeeded; }
    public sealed class BuildReport {public BuildSummary summary => new BuildSummary();}
}
namespace Company.WebView.Unified.Editor {
    public static class UnifiedWebViewSetupMenu {public static void CreateExampleSceneBatch() {}}
}
