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
        // CEF accelerated D3D11 surface arrives with top-left texture origin;
        // RawImage samples bottom-left origin. Flip V on the isolated dual-test panel only.
        // Do not modify the validated v58.4.4 CefTextureSurface implementation.
        left.GetComponent<RawImage>().uvRect=new Rect(0f,1f,1f,-1f);
        // Keep RawImage active only as CEF external GPU texture OWNER; never draw it.
        // The 3D cube below, not a screen-space RawImage, is the visible left viewport.
        left.GetComponent<RawImage>().enabled=false;
        var cefSurface=left.gameObject.AddComponent<CefTextureSurface>();
        var textureHost=left.gameObject.AddComponent<UnifiedTextureSceneHost>();
        Assign(cefSurface,"target",left.GetComponent<RawImage>());
        Assign(textureHost,"rawImage",left.GetComponent<RawImage>());
        Assign(textureHost,"validatedTextureSurface",cefSurface);
        // An offline data URL avoids external network dependence for texture frame readiness.
        var host=new SerializedObject(textureHost);
        // Blue TOP / red BOTTOM are visible UV-direction markers on a static cube face.
        // Orange CSS square moves while the cube is still; GPU pixel readback checks this.
        const string cubeHtml="<!doctype html><html><meta charset='utf-8'>"+
            "<style>html,body{margin:0;height:100%;background:#b8e0ce;overflow:hidden;}"+
            ".top{position:absolute;top:0;left:0;right:0;height:108px;"+
            "background:#284dff;color:white;font:900 46px Arial;padding:12px;}"+
            ".bottom{position:absolute;bottom:0;left:0;right:0;height:104px;"+
            "background:#e53b55;color:white;font:900 43px Arial;padding:12px;}"+
            ".move{position:absolute;top:270px;left:30px;width:116px;height:116px;"+
            "background:#ff8a00;animation:slide 1.2s linear infinite alternate;}"+
            "@keyframes slide{from{transform:translateX(0)}to{transform:translateX(530px)}}"+
            ".mid{position:absolute;top:162px;left:40px;font:36px Arial;color:#10392e}"+
            "</style><body><div class='top'>BLUE TOP / UV UP</div>"+
            "<div class='mid'>CEF GPU TEXTURE / UNITY CUBE</div>"+
            "<div class='move'></div><div class='bottom'>RED BOTTOM / UV DOWN</div>"+
            "</body></html>";
        host.FindProperty("initialUrl").stringValue="data:text/html;charset=utf-8,"+Uri.EscapeDataString(cubeHtml);
        // Square source page matches the cube face UV aspect ratio.
        host.FindProperty("width").intValue=768;
        host.FindProperty("height").intValue=768;
        host.ApplyModifiedPropertiesWithoutUndo();
        // Direct CEF external GPU Texture2D -> MeshRenderer Material (not HWND).
        var camera=Camera.main;
        if(camera==null)throw new Exception("Default camera missing");
        camera.transform.position=new Vector3(0,0,-15);
        camera.transform.rotation=Quaternion.identity;
        camera.orthographic=true;
        camera.orthographicSize=4.5f;
        camera.clearFlags=CameraClearFlags.SolidColor;
        camera.backgroundColor=new Color(0.10f,0.17f,0.25f,1f);
        var cube=GameObject.CreatePrimitive(PrimitiveType.Cube);
        cube.name="CEF live GPU texture - ROTATING UNITY CUBE";
        cube.transform.position=new Vector3(-3.8f,0,0);
        cube.transform.localScale=new Vector3(3.4f,3.4f,1.25f);
        var cubeShader=Shader.Find("Unlit/Texture");
        if(cubeShader==null)throw new Exception("Unlit/Texture shader missing");
        var cubeMaterial=new Material(cubeShader);
        cubeMaterial.name="CEF external GPU texture material";
        cubeMaterial.mainTextureScale=new Vector2(1,-1);
        cubeMaterial.mainTextureOffset=new Vector2(0,1);
        if(!AssetDatabase.IsValidFolder("Assets/Materials"))
            AssetDatabase.CreateFolder("Assets","Materials");
        AssetDatabase.CreateAsset(cubeMaterial,"Assets/Materials/CefGpuCube.mat");
        var renderer=cube.GetComponent<MeshRenderer>();
        renderer.sharedMaterial=cubeMaterial;
        var occluder=GameObject.CreatePrimitive(PrimitiveType.Sphere);
        occluder.name="DEPTH TEST - sphere in FRONT of rotating CEF cube";
        occluder.transform.position=new Vector3(-3.8f,-0.65f,-3.5f);
        occluder.transform.localScale=Vector3.one*1.25f;
        var occluderShader=Shader.Find("Unlit/Color");
        if(occluderShader==null)throw new Exception("Unlit/Color shader missing");
        var occluderMaterial=new Material(occluderShader);
        occluderMaterial.name="Depth occluder solid orange";
        occluderMaterial.color=new Color(1f,0.42f,0.09f,1f);
        AssetDatabase.CreateAsset(occluderMaterial,"Assets/Materials/DepthOccluder.mat");
        occluder.GetComponent<MeshRenderer>().sharedMaterial=occluderMaterial;
        var cubeProof=cube.AddComponent<CefCubeTextureProof>();
        Assign(cubeProof,"textureSource",left.GetComponent<RawImage>());
        Assign(cubeProof,"cefSurface",cefSurface);
        Assign(cubeProof,"cubeRenderer",renderer);
        Assign(cubeProof,"cubeTransform",cube.transform);
        Assign(cubeProof,"occluder",occluder.transform);
        Assign(cubeProof,"sceneCamera",camera);
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
        Assign(telemetry,"cubeProof",cubeProof);
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
