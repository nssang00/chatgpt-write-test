// Windows Standalone-only automatic runtime evidence; not a complete UI verification.
using System;
using System.IO;
using System.Runtime.InteropServices;
using UnityEngine;

namespace Company.WebView.Prototypes {
 [DefaultExecutionOrder(200)]
 public sealed class WebView2OneClickTelemetry : MonoBehaviour {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
  [DllImport("CompanyWebView2OverlayPilot",CallingConvention=CallingConvention.Cdecl)]
  private static extern int WV2Pilot_GetState();
  [DllImport("CompanyWebView2OverlayPilot",CallingConvention=CallingConvention.Cdecl)]
  private static extern int WV2Pilot_GetLastError();
  [DllImport("CompanyWebView2OverlayPilot",CallingConvention=CallingConvention.Cdecl)]
  private static extern int WV2Pilot_GetPongCount();
  [DllImport("CompanyWebView2OverlayPilot",CallingConvention=CallingConvention.Cdecl)]
  private static extern int WV2Pilot_GetAckCount();
#endif
  [Serializable] private sealed class Evidence {
   public string harnessVersion="58.5.2";
   public string status="INCOMPLETE";
   public string utc="";
   public string unityVersion="";
   public string error="";
   public int nativeState=0;
   public int nativeError=0;
   public int observedReady=0;
   public int pingCount=0;
   public int ackCount=0;
   public bool manualUiImeDpiFocusPending=true;
  }
  private readonly Evidence report=new Evidence();
  private float begin;
  private int seconds=35;
  private bool ended;
  private string output;
  private void Start() {
   begin=Time.realtimeSinceStartup;
   report.unityVersion=Application.unityVersion;
   output=Path.Combine(Application.persistentDataPath,"v58.5.2-evidence.json");
   string[] args=Environment.GetCommandLineArgs();
   for(int i=0;i+1<args.Length;i++){
    if(args[i]=="-pilotReportPath") output=args[i+1];
    if(args[i]=="-pilotAutoSeconds"){
     int n;if(int.TryParse(args[i+1],out n)&&n>=10&&n<=300)seconds=n;
    }
   }
   Debug.Log("[WV2-5852] evidence path="+output);
  }
  private void Update() {
   if(ended)return;
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
   try {
    int state=WV2Pilot_GetState();
    report.nativeState=state;
    if(state==2)report.observedReady=1;
    report.nativeError=WV2Pilot_GetLastError();
    report.pingCount=Math.Max(report.pingCount,WV2Pilot_GetPongCount());
    report.ackCount=Math.Max(report.ackCount,WV2Pilot_GetAckCount());
    if(state<0)report.error="Native startup failed: "+state;
   } catch(Exception ex){report.error=ex.GetType().Name+": "+ex.Message;}
#else
   report.error="Windows standalone Player required";
#endif
   if(Time.realtimeSinceStartup-begin>=seconds)Complete();
  }
  private void Complete() {
   if(ended)return;
   ended=true;
   report.utc=DateTime.UtcNow.ToString("o");
   report.status=(report.observedReady==1 && report.pingCount>0 && report.ackCount>0 &&
    report.nativeError==0 && String.IsNullOrEmpty(report.error)) ? "PASS_AUTO":"FAIL_AUTO";
   try {
    Directory.CreateDirectory(Path.GetDirectoryName(output));
    File.WriteAllText(output,JsonUtility.ToJson(report,true));
    Debug.Log("[WV2-5852] "+report.status);
   }catch(Exception ex){Debug.LogError("[WV2-5852] Write evidence failed: "+ex);}
   Application.Quit(report.status=="PASS_AUTO"?0:3);
  }
  private void OnApplicationQuit() {
   if(!ended){report.error="Player ended early";Complete();}
  }
 }
}
