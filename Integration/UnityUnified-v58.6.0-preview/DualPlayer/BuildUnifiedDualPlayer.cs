using System;
using System.IO;
using Company.WebView;
using Company.WebView.Unified.Experimental;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

// Generated ONLY in an isolated scratch project, not in the validated CEF baseline.
public static class BuildUnifiedDualPlayer
{
    private static void Assign(UnityEngine.Object component,string field,UnityEngine.Object value)
    {
        var serialized=new SerializedObject(component);
        var p=serialized.FindProperty(field);
        if(p==null)throw new Exception("Unity serialized field missing: "+field);
        p.objectReferenceValue=value;
        serialized.ApplyModifiedPropertiesWithoutUndo();
    }
    private static void Enable(UnityEngine.Object component,string field,bool value)
    {
        var serialized=new SerializedObject(component);
        var p=serialized.FindProperty(field);
        if(p==null)throw new Exception("Unity bool field missing: "+field);
        p.boolValue=value;
        serialized.ApplyModifiedPropertiesWithoutUndo();
    }
    private static RectTransform CreatePanel(Canvas canvas,string name,float anchorLeft,float anchorRight)
    {
        var go=new GameObject(name,typeof(RectTransform),typeof(RawImage));
        var rect=(RectTransform)go.transform;
        rect.SetParent(canvas.transform,false);
        rect.anchorMin=new Vector2(anchorLeft,0.05f);
        rect.anchorMax=new Vector2(anchorRight,0.95f);
        rect.offsetMin=new Vector2(8,8);
        rect.offsetMax=new Vector2(-8,-8);
        return rect;
    }
    public static void Build()
    {
        if(Application.unityVersion!="2022.3.62f3")
            throw new Exception("Exact Unity 2022.3.62f3 required: "+Application.unityVersion);
        if(EditorUserBuildSettings.activeBuildTarget!=BuildTarget.StandaloneWindows64)
            throw new Exception("Use -buildTarget Win64");
        var args=Environment.GetCommandLineArgs();
        string path=null;
        for(int i=0;i<args.Length-1;i++)
            if(args[i]=="-dualBuildPath")path=args[i+1];
        if(String.IsNullOrEmpty(path))throw new ArgumentException("Missing -dualBuildPath");
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path)));
        Directory.CreateDirectory("Assets/Scenes");
        PlayerSettings.SetGraphicsAPIs(BuildTarget.StandaloneWindows64,new[]{GraphicsDeviceType.Direct3D11});
        PlayerSettings.companyName="Company";
        PlayerSettings.productName="Unified WebView Dual Mode Experimental";
        PlayerSettings.defaultScreenWidth=1400;
        PlayerSettings.defaultScreenHeight=850;
        PlayerSettings.fullScreenMode=FullScreenMode.Windowed;
        PlayerSettings.resizableWindow=true;
        PlayerSettings.runInBackground=true;
        var scene=EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects,NewSceneMode.Single);
        var canvasObject=new GameObject("Unified Dual WebView Canvas",typeof(RectTransform),typeof(Canvas),typeof(CanvasScaler),typeof(GraphicRaycaster));
        var canvas=canvasObject.GetComponent<Canvas>();
        canvas.renderMode=RenderMode.ScreenSpaceOverlay;
        var left=CreatePanel(canvas,"LEFT - CEF Accelerated Texture",0,0.5f);
        var right=CreatePanel(canvas,"RIGHT - WebView2 Native Overlay",0.5f,1);
        var cefSurface=left.gameObject.AddComponent<CefTextureSurface>();
        var textureHost=left.gameObject.AddComponent<UnifiedTextureSceneHost>();
        Assign(cefSurface,"target",left.GetComponent<RawImage>());
        Assign(textureHost,"rawImage",left.GetComponent<RawImage>());
        Assign(textureHost,"validatedTextureSurface",cefSurface);
        // An offline data URL avoids external network dependence for texture frame readiness.
        var host=new SerializedObject(textureHost);
        host.FindProperty("initialUrl").stringValue="data:text/html,%3Chtml%3E%3Cbody%20style%3D%22background%3A%23b8e0ce%3Bfont-family%3AArial%3Bfont-size%3A36px%22%3ECEF%20Texture%20LEFT%3C%2Fbody%3E%3C%2Fhtml%3E";
        host.ApplyModifiedPropertiesWithoutUndo();
        var imageRight=right.GetComponent<RawImage>();
        imageRight.color=new Color(0.90f,0.92f,0.98f,1);
        var overlayHost=right.gameObject.AddComponent<UnifiedOverlaySceneHost>();
        Enable(overlayHost,"enablePreview",true);
        Assign(overlayHost,"targetRect",right);
        Assign(overlayHost,"canvas",canvas);
        var root=new GameObject("Dual Integration Evidence");
        var telemetry=root.AddComponent<UnifiedDualPlayerEvidence>();
        Assign(telemetry,"cefSurface",cefSurface);
        Assign(telemetry,"textureHost",textureHost);
        Assign(telemetry,"overlayHost",overlayHost);
        var scenePath="Assets/Scenes/UnifiedDualPreview.unity";
        if(!EditorSceneManager.SaveScene(scene,scenePath))throw new Exception("Scene save failed");
        EditorBuildSettings.scenes=new[]{new EditorBuildSettingsScene(scenePath,true)};
        AssetDatabase.SaveAssets();
        var opts=new BuildPlayerOptions{
            scenes=new[]{scenePath},
            locationPathName=Path.GetFullPath(path),
            target=BuildTarget.StandaloneWindows64,
            options=BuildOptions.Development
        };
        var report=BuildPipeline.BuildPlayer(opts);
        if(report==null || report.summary.result!=BuildResult.Succeeded)
            throw new Exception("Dual Unity Player failed: "+(report==null?"null":report.summary.result.ToString()));
        Debug.Log("[UNIFIED-DUAL] UNITY_BUILD_PASS "+Path.GetFullPath(path));
    }
}
