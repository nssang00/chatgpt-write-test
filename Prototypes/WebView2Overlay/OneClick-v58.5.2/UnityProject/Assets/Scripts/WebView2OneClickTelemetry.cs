// v58.5.2 r3: automatic evidence includes shutdown + STA join.
// Runtime PASS_AUTO is prohibited until WebView2 shutdown completes.
using System;
using System.IO;
using System.Runtime.InteropServices;
using UnityEngine;

namespace Company.WebView.Prototypes
{
    [DefaultExecutionOrder(200)]
    public sealed class WebView2OneClickTelemetry : MonoBehaviour
    {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
        [DllImport("CompanyWebView2OverlayPilot",CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Pilot_GetState();
        [DllImport("CompanyWebView2OverlayPilot",CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Pilot_GetLastError();
        [DllImport("CompanyWebView2OverlayPilot",CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Pilot_GetPongCount();
        [DllImport("CompanyWebView2OverlayPilot",CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Pilot_GetAckCount();
        [DllImport("CompanyWebView2OverlayPilot",CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Pilot_RequestClose();
        [DllImport("CompanyWebView2OverlayPilot",CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Pilot_Close(uint timeoutMs);
        [DllImport("CompanyWebView2OverlayPilot",CallingConvention=CallingConvention.Cdecl)]
        private static extern int WV2Pilot_GetShutdownPhase();
#endif
        [Serializable]
        private sealed class Evidence
        {
            public string harnessVersion="58.5.2";
            public string testRevision="r3";
            public string status="INCOMPLETE";
            public string utc="";
            public string unityVersion="";
            public string error="";
            public int observedReady;
            public int nativeState;
            public int nativeError;
            public int pingCount;
            public int ackCount;
            public bool shutdownRequested;
            public bool shutdownJoined;
            public int shutdownRequestCode;
            public int shutdownResult=-99;
            public int shutdownPhase;
            public int stateAfterShutdown=-99;
            public float shutdownWaitSeconds;
            public bool manualUiImeDpiFocusPending=true;
        }
        private readonly Evidence report=new Evidence();
        private float started;
        private float shutdownStarted;
        private int runtimeSeconds=35;
        private bool shutdownRequested;
        private bool finished;
        private string output;
        private void Start()
        {
            started=Time.realtimeSinceStartup;
            report.unityVersion=Application.unityVersion;
            output=Path.Combine(Application.persistentDataPath,"v58.5.2-evidence.json");
            string[] args=Environment.GetCommandLineArgs();
            for(int i=0;i+1<args.Length;i++)
            {
                if(args[i]=="-pilotReportPath") output=args[i+1];
                if(args[i]=="-pilotAutoSeconds")
                {
                    int n;
                    if(int.TryParse(args[i+1],out n)&&n>=10&&n<=300) runtimeSeconds=n;
                }
            }
            Debug.Log("[WV2-5852-r3] Evidence "+output);
        }
        private void Update()
        {
            if(finished) return;
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            try
            {
                if(!shutdownRequested)
                {
                    int state=WV2Pilot_GetState();
                    report.nativeState=state;
                    if(state==2) report.observedReady=1;
                    report.nativeError=WV2Pilot_GetLastError();
                    report.pingCount=Math.Max(report.pingCount,WV2Pilot_GetPongCount());
                    report.ackCount=Math.Max(report.ackCount,WV2Pilot_GetAckCount());
                    if(state<0) report.error="Native initialization failed "+state;
                    if(Time.realtimeSinceStartup-started>=runtimeSeconds) BeginShutdown();
                }
                else PollShutdown();
            }
            catch(Exception ex)
            {
                report.error=ex.GetType().Name+": "+ex.Message;
                Finish(true);
            }
#else
            report.error="Windows standalone Player required";
            Finish(true);
#endif
        }
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
        private void BeginShutdown()
        {
            shutdownRequested=true;
            shutdownStarted=Time.realtimeSinceStartup;
            report.shutdownRequested=true;
            report.shutdownRequestCode=WV2Pilot_RequestClose();
            Debug.Log("[WV2-5852-r3] Shutdown requested: "+report.shutdownRequestCode);
            if(report.shutdownRequestCode!=0)
            {
                report.error="Native shutdown request failed "+report.shutdownRequestCode;
                Finish(true);
            }
        }
        private void PollShutdown()
        {
            report.shutdownPhase=WV2Pilot_GetShutdownPhase();
            int code=WV2Pilot_Close(0);
            report.shutdownResult=code;
            report.shutdownWaitSeconds=Time.realtimeSinceStartup-shutdownStarted;
            if(code==0)
            {
                report.shutdownJoined=true;
                report.shutdownPhase=WV2Pilot_GetShutdownPhase();
                report.stateAfterShutdown=WV2Pilot_GetState();
                Debug.Log("[WV2-5852-r3] Shutdown joined phase="+report.shutdownPhase);
                Finish(true);
            }
            else if(code!=-30)
            {
                report.error="Native shutdown poll failed "+code;
                Finish(true);
            }
            else if(report.shutdownWaitSeconds>=12f)
            {
                report.error="Native shutdown timeout: phase="+report.shutdownPhase;
                Debug.LogError("[WV2-5852-r3] "+report.error);
                Finish(true);
            }
        }
#endif
        private void Finish(bool quit)
        {
            if(finished) return;
            finished=true;
            report.utc=DateTime.UtcNow.ToString("o");
            report.status=(report.observedReady==1 && report.pingCount>0 && report.ackCount>0 &&
                report.nativeError==0 && report.shutdownRequested && report.shutdownJoined &&
                report.shutdownResult==0 && report.stateAfterShutdown==0 &&
                report.shutdownPhase==7 && String.IsNullOrEmpty(report.error))
                ? "PASS_AUTO":"FAIL_AUTO";
            try
            {
                string dir=Path.GetDirectoryName(output);
                if(!String.IsNullOrEmpty(dir))Directory.CreateDirectory(dir);
                File.WriteAllText(output,JsonUtility.ToJson(report,true));
                Debug.Log("[WV2-5852-r3] "+report.status);
            }
            catch(Exception ex){Debug.LogError("[WV2-5852-r3] Evidence write error "+ex);}
            if(quit)Application.Quit(report.status=="PASS_AUTO"?0:3);
        }
        private void OnApplicationQuit()
        {
            if(!finished)
            {
                report.error="Player quit before shutdown completion";
                Finish(false);
            }
        }
    }
}
