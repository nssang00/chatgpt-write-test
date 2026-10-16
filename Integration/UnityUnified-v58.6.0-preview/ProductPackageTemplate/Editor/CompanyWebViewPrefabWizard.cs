using System;
using Company.WebView;
using Company.WebView.Unified.Experimental;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace Company.WebView.EditorTools
{
    /// <summary>
    /// Preview only. Generates serialized references through Unity's own Editor,
    /// avoiding hand-authored GUIDs and avoiding mutation of validated native baselines.
    /// No input/IME/multi-instance/IL2CPP guarantee is implied by creating a prefab.
    /// </summary>
    public static class CompanyWebViewPrefabWizard
    {
        private const string Root = "Assets/CompanyWebViewGenerated";
        private const string Prefabs = Root + "/Prefabs";

        [MenuItem("Tools/Company WebView/Create Preview Prefabs")]
        public static void CreatePreviewPrefabs()
        {
            RequireFolder("Assets", "CompanyWebViewGenerated");
            RequireFolder(Root, "Prefabs");
            CreateTexturePrefab();
            CreateOverlayPrefab();
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("Company WebView preview prefabs generated at " + Prefabs +
                      ". Windows Player only; mouse/IME/multiple views are not yet certified.");
        }

        private static void RequireFolder(string parent, string child)
        {
            var full = parent + "/" + child;
            if (!AssetDatabase.IsValidFolder(full))
                AssetDatabase.CreateFolder(parent, child);
        }

        private static void SetRef(UnityEngine.Object target, string field, UnityEngine.Object value)
        {
            var serialized = new SerializedObject(target);
            var property = serialized.FindProperty(field);
            if (property == null)
                throw new InvalidOperationException("Preview component field changed: " + field);
            property.objectReferenceValue = value;
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void SetBool(UnityEngine.Object target, string field, bool value)
        {
            var serialized = new SerializedObject(target);
            var property = serialized.FindProperty(field);
            if (property == null)
                throw new InvalidOperationException("Preview component field changed: " + field);
            property.boolValue = value;
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void CreateTexturePrefab()
        {
            var root = new GameObject("Company WebView - Texture", typeof(RectTransform), typeof(RawImage));
            try
            {
                var image = root.GetComponent<RawImage>();
                var cef = root.AddComponent<CefTextureSurface>();
                var host = root.AddComponent<UnifiedTextureSceneHost>();
                SetRef(cef, "target", image);
                SetRef(host, "rawImage", image);
                SetRef(host, "validatedTextureSurface", cef);
                PrefabUtility.SaveAsPrefabAsset(root, Prefabs + "/CompanyWebViewTexture.prefab");
            }
            finally { UnityEngine.Object.DestroyImmediate(root); }
        }

        private static void CreateOverlayPrefab()
        {
            var root = new GameObject("Company WebView - Overlay", typeof(RectTransform));
            try
            {
                var host = root.AddComponent<UnifiedOverlaySceneHost>();
                SetRef(host, "targetRect", root.GetComponent<RectTransform>());
                SetBool(host, "enablePreview", true);
                // Canvas is resolved as screen-space when not assigned. Parent this
                // prefab under a Screen Space Overlay Canvas in the user's scene.
                PrefabUtility.SaveAsPrefabAsset(root, Prefabs + "/CompanyWebViewOverlay.prefab");
            }
            finally { UnityEngine.Object.DestroyImmediate(root); }
        }
    }
}
