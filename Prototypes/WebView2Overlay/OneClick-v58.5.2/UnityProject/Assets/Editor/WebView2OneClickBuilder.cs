// Unity Editor batch build entry point. Requires Unity 2022.3.62f3.
using System;
using System.IO;
using Company.WebView.Prototypes;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class WebView2OneClickBuilder {
 public static void Build(){
  if(Application.unityVersion!="2022.3.62f3")
   throw new InvalidOperationException("Unity 2022.3.62f3 required, got "+Application.unityVersion);
  if(EditorUserBuildSettings.activeBuildTarget!=BuildTarget.StandaloneWindows64)
   throw new InvalidOperationException("Required -buildTarget Win64");
  var a=Environment.GetCommandLineArgs();
  string dest=null;
  for(int i=0;i+1<a.Length;i++)if(a[i]=="-pilotBuildPath")dest=a[i+1];
  if(String.IsNullOrEmpty(dest))throw new ArgumentException("Missing -pilotBuildPath");
  Directory.CreateDirectory(Path.GetDirectoryName(dest));
  Directory.CreateDirectory("Assets/Scenes");
  var scene=EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects,NewSceneMode.Single);
  var go=new GameObject("OneClick WebView2 Pilot");
  var pilot=go.AddComponent<WebView2OverlayUnityPilot>();
  var so=new SerializedObject(pilot);
  var enabled=so.FindProperty("enablePilot");
  if(enabled==null)throw new Exception("enablePilot field not found");
  enabled.boolValue=true;
  so.ApplyModifiedPropertiesWithoutUndo();
  go.AddComponent<WebView2OneClickTelemetry>();
  EditorSceneManager.MarkSceneDirty(scene);
  string scenePath="Assets/Scenes/GeneratedWebView2Pilot.unity";
  if(!EditorSceneManager.SaveScene(scene,scenePath))throw new Exception("Cannot save scene");
  PlayerSettings.companyName="Company";
  PlayerSettings.productName="WebView2 OneClick Pilot";
  PlayerSettings.defaultScreenWidth=1024;
  PlayerSettings.defaultScreenHeight=720;
  PlayerSettings.runInBackground=true;
  var options=new BuildPlayerOptions {
   scenes=new []{scenePath},locationPathName=dest,
   target=BuildTarget.StandaloneWindows64,options=BuildOptions.Development
  };
  var report=BuildPipeline.BuildPlayer(options);
  if(report==null || report.summary.result!=BuildResult.Succeeded)
   throw new Exception("Unity build failed: "+(report==null?"no report":report.summary.result.ToString()));
  Debug.Log("[WV2-5852] UNITY_BUILD_PASS "+dest);
 }
}
