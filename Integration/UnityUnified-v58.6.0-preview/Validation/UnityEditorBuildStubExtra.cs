
namespace UnityEngine.Rendering {public enum GraphicsDeviceType {Direct3D11} }
namespace UnityEngine.SceneManagement { public struct Scene {} }
namespace UnityEditor {
    public enum BuildTarget {StandaloneWindows64}
    public enum BuildOptions {Development}
    public struct BuildPlayerOptions {
        public string[] scenes;
        public string locationPathName;
        public BuildTarget target;
        public BuildOptions options;
    }
    public static class EditorUserBuildSettings {public static BuildTarget activeBuildTarget=>BuildTarget.StandaloneWindows64;}
    public static class EditorBuildSettings {public static EditorBuildSettingsScene[] scenes;}
    public sealed class EditorBuildSettingsScene {public EditorBuildSettingsScene(string p,bool enabled){}}
    public static class AssetDatabase {public static void SaveAssets(){}}
    public sealed class SerializedProperty {public UnityEngine.Object objectReferenceValue;public bool boolValue;public string stringValue;}
    public sealed class SerializedObject {
        public SerializedObject(UnityEngine.Object component){}
        public SerializedProperty FindProperty(string name)=>new SerializedProperty();
        public void ApplyModifiedPropertiesWithoutUndo(){}
    }
    public static class BuildPipeline {public static UnityEditor.Build.Reporting.BuildReport BuildPlayer(BuildPlayerOptions options)=>new UnityEditor.Build.Reporting.BuildReport();}
}
namespace UnityEditor.Build.Reporting {
    public enum BuildResult {Succeeded,Failed}
    public sealed class BuildSummary {public BuildResult result=>BuildResult.Succeeded;}
    public sealed class BuildReport {public BuildSummary summary=>new BuildSummary();}
}
namespace UnityEditor.SceneManagement {
    public enum NewSceneSetup {DefaultGameObjects}
    public enum NewSceneMode {Single}
    public static class EditorSceneManager {
        public static UnityEngine.SceneManagement.Scene NewScene(NewSceneSetup setup,NewSceneMode mode)=>new UnityEngine.SceneManagement.Scene();
        public static bool SaveScene(UnityEngine.SceneManagement.Scene scene,string path)=>true;
    }
}
namespace Company.WebView.Unified.Experimental {
    public sealed class UnifiedTextureSceneHost : UnityEngine.MonoBehaviour {}
    public sealed class UnifiedOverlaySceneHost : UnityEngine.MonoBehaviour {}
    public sealed class UnifiedDualPlayerEvidence : UnityEngine.MonoBehaviour {}
}
