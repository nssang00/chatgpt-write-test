using Company.WebView;
using Company.WebView.Unified.Experimental;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UI;

namespace Company.WebView.Unified.Editor
{
    public static class UnifiedWebViewSetupMenu
    {
        private const string Directory = "Assets/CompanyWebViewGenerated/Prefabs";

        [MenuItem("Tools/Company WebView/Create Texture + Overlay Prefabs (Preview)")]
        public static void CreatePrefabs()
        {
            EnsureFolders();
            SavePrefab(CreateTexturePanel(), Directory + "/CefTexturePanel.prefab");
            SavePrefab(CreateOverlayPanel(), Directory + "/WebView2OverlayPanel.prefab");
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("Created two Unity Prefabs in " + Directory + " (one instance per backend only).");
        }

        [MenuItem("Tools/Company WebView/Create Two-Panel Example Scene (Preview)")]
        public static void CreateExampleScene()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            CreatePrefabs();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            var root = new GameObject("Company WebView Preview Canvas", typeof(RectTransform),
                typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            var canvas = root.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = root.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1400, 850);
            var left = (GameObject)PrefabUtility.InstantiatePrefab(AssetDatabase.LoadAssetAtPath<GameObject>(Directory + "/CefTexturePanel.prefab"));
            var right = (GameObject)PrefabUtility.InstantiatePrefab(AssetDatabase.LoadAssetAtPath<GameObject>(Directory + "/WebView2OverlayPanel.prefab"));
            left.transform.SetParent(root.transform, false);
            right.transform.SetParent(root.transform, false);
            Stretch(left.GetComponent<RectTransform>(), 0.03f, 0.49f);
            Stretch(right.GetComponent<RectTransform>(), 0.51f, 0.97f);
            var r = new SerializedObject(right.GetComponent<UnifiedWebViewPanel>());
            r.FindProperty("targetCanvas").objectReferenceValue = canvas;
            r.ApplyModifiedPropertiesWithoutUndo();
            // Prefab instance mode can be overridden at scene level for layout/Canvas.
            EnsureFolders();
            const string scenePath = "Assets/CompanyWebViewGenerated/DualPreview.unity";
            EditorSceneManager.SaveScene(scene, scenePath);
            Debug.Log("Example scene created: " + scenePath + ". Build Windows x64 D3D11 Standalone; not Editor Play Mode.");
        }

        private static void EnsureFolders()
        {
            if (!AssetDatabase.IsValidFolder("Assets/CompanyWebViewGenerated"))
                AssetDatabase.CreateFolder("Assets", "CompanyWebViewGenerated");
            if (!AssetDatabase.IsValidFolder(Directory))
                AssetDatabase.CreateFolder("Assets/CompanyWebViewGenerated", "Prefabs");
        }
        private static void Stretch(RectTransform r, float left, float right)
        {
            r.anchorMin = new Vector2(left, 0.05f);
            r.anchorMax = new Vector2(right, 0.95f);
            r.offsetMin = Vector2.zero;
            r.offsetMax = Vector2.zero;
        }
        private static GameObject CreateTexturePanel()
        {
            var go = new GameObject("CEF Texture WebView (Preview)", typeof(RectTransform),
                typeof(CanvasRenderer), typeof(RawImage), typeof(CefTextureSurface), typeof(UnifiedWebViewPanel));
            var raw = go.GetComponent<RawImage>();
            raw.color = Color.white;
            var surface = new SerializedObject(go.GetComponent<CefTextureSurface>());
            surface.FindProperty("target").objectReferenceValue = raw;
            surface.ApplyModifiedPropertiesWithoutUndo();
            var panel = new SerializedObject(go.GetComponent<UnifiedWebViewPanel>());
            panel.FindProperty("mode").enumValueIndex = (int)PresentationMode.Texture;
            panel.FindProperty("textureTarget").objectReferenceValue = raw;
            panel.FindProperty("textureSurface").objectReferenceValue = go.GetComponent<CefTextureSurface>();
            panel.ApplyModifiedPropertiesWithoutUndo();
            return go;
        }
        private static GameObject CreateOverlayPanel()
        {
            var go = new GameObject("WebView2 Overlay WebView (Preview)", typeof(RectTransform), typeof(UnifiedWebViewPanel));
            var panel = new SerializedObject(go.GetComponent<UnifiedWebViewPanel>());
            panel.FindProperty("mode").enumValueIndex = (int)PresentationMode.Overlay;
            panel.FindProperty("overlayTarget").objectReferenceValue = go.GetComponent<RectTransform>();
            panel.ApplyModifiedPropertiesWithoutUndo();
            return go;
        }
        private static void SavePrefab(GameObject sceneObject, string path)
        {
            try { PrefabUtility.SaveAsPrefabAsset(sceneObject, path); }
            finally { Object.DestroyImmediate(sceneObject); }
        }
    }

    [CustomEditor(typeof(UnifiedWebViewPanel))]
    public sealed class UnifiedWebViewPanelInspector : UnityEditor.Editor
    {
        public override void OnInspectorGUI()
        {
            serializedObject.Update();
            EditorGUILayout.LabelField("Company WebView", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox("Windows x64 D3D11 Standalone Preview. One CEF Texture and one WebView2 Overlay instance maximum. Editor Play Mode unsupported.", MessageType.Info);
            EditorGUILayout.PropertyField(serializedObject.FindProperty("mode"));
            EditorGUILayout.PropertyField(serializedObject.FindProperty("initialUrl"));
            var mode = (PresentationMode)serializedObject.FindProperty("mode").enumValueIndex;
            if (mode == PresentationMode.Texture)
            {
                EditorGUILayout.PropertyField(serializedObject.FindProperty("browserWidth"));
                EditorGUILayout.PropertyField(serializedObject.FindProperty("browserHeight"));
                EditorGUILayout.PropertyField(serializedObject.FindProperty("targetFrameRate"));
                EditorGUILayout.PropertyField(serializedObject.FindProperty("textureTarget"));
                EditorGUILayout.PropertyField(serializedObject.FindProperty("textureSurface"));
                EditorGUILayout.HelpBox("CEF Texture currently exposes no generic JS bridge and no native mouse/IME forwarding. URL display is functional.", MessageType.Warning);
            }
            else
            {
                EditorGUILayout.PropertyField(serializedObject.FindProperty("overlayTarget"));
                EditorGUILayout.PropertyField(serializedObject.FindProperty("targetCanvas"));
                EditorGUILayout.HelpBox("WebView2 overlays the Windows player HWND and cannot be displayed on a 3D mesh. Korean IME is not yet product certified.", MessageType.Warning);
            }
            serializedObject.ApplyModifiedProperties();
            if (GUILayout.Button("Generate two Prefabs")) UnifiedWebViewSetupMenu.CreatePrefabs();
            if (GUILayout.Button("Generate example Scene")) UnifiedWebViewSetupMenu.CreateExampleScene();
        }
    }
}

