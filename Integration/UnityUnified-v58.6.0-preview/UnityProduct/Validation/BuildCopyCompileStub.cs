// Compile-only Unity 2022 ambiguity fixture. BOTH PackageInfo types deliberately exist.
using System;
using System.Reflection;
namespace UnityEngine { public static class Debug { public static void Log(object message) {} } }
namespace UnityEditor {
    public sealed class PackageInfo {}
    public enum BuildTarget { StandaloneWindows64, StandaloneOSX }
    public sealed class BuildFailedException: Exception { public BuildFailedException(string message):base(message) {} }
}
namespace UnityEditor.PackageManager {
    public sealed class PackageInfo {
        public static PackageInfo FindForAssembly(Assembly assembly) => new PackageInfo();
        public string resolvedPath => ".";
    }
}
namespace UnityEditor.Build {
    public interface IPostprocessBuildWithReport {
        int callbackOrder {get;}
        void OnPostprocessBuild(UnityEditor.Build.Reporting.BuildReport report);
    }
}
namespace UnityEditor.Build.Reporting {
    public sealed class BuildSummary {
        public UnityEditor.BuildTarget platform {get;set;}
        public string outputPath {get;set;}
    }
    public sealed class BuildReport {public BuildSummary summary => new BuildSummary();}
}
namespace Company.WebView.Unified.Experimental { public sealed class UnifiedWebViewPanel {} }
