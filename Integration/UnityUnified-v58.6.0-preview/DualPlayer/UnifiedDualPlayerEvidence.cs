using System;
using System.IO;
using UnityEngine;
using Company.WebView;
using Company.WebView.Unified.Experimental;

public sealed class UnifiedDualPlayerEvidence : MonoBehaviour
{
    [SerializeField] private CefTextureSurface cefSurface;
    [SerializeField] private UnifiedTextureSceneHost textureHost;
    [SerializeField] private UnifiedOverlaySceneHost overlayHost;
    [Serializable] private sealed class Evidence {
        public string harness="58.6.0-dual-experimental";
        public string status="FAIL_AUTO";
        public string error="";
        public bool cefReady;
        public bool cefRawImageBound;
        public long cefAcceleratedFrames;
        public long cefSoftwareFrames;
        public bool overlayReady;
        public int overlayMessageCount;
        public bool overlayCloseRequested;
        public bool overlayJoined;
        public bool cefShutdown;
        public bool manualImeDpiZOrderPending=true;
        public string completedUtc;
    }
    private Evidence evidence=new Evidence();
    private float start;
    private float shutdownStarted;
    private float lastProbe;
    private bool closing;
    private bool reportSaved;
    private int probes;
    private int duration=120;
    private string reportFile;

    private void Start() {
        start=Time.realtimeSinceStartup;
        var argv=Environment.GetCommandLineArgs();
        for(int i=0;i<argv.Length-1;i++){
            if(argv[i]=="-dualDuration")int.TryParse(argv[i+1],out duration);
            if(argv[i]=="-dualEvidencePath")reportFile=argv[i+1];
        }
        duration=Math.Max(30,Math.Min(300,duration));
        if(String.IsNullOrEmpty(reportFile))
            reportFile=Path.Combine(Application.persistentDataPath,"dual-unity-evidence.json");
        Debug.Log("[UNIFIED-DUAL] Runtime started; expect separate Texture LEFT and Overlay RIGHT");
    }
    private void Sample(){
        if(textureHost!=null && textureHost.IsTextureBackendReady)evidence.cefReady=true;
        if(cefSurface!=null) {
            evidence.cefAcceleratedFrames=Math.Max(evidence.cefAcceleratedFrames,(long)cefSurface.AcceleratedFrameCount);
            evidence.cefSoftwareFrames=Math.Max(evidence.cefSoftwareFrames,(long)cefSurface.SoftwareFrameCount);
        }
        if(overlayHost!=null) {
            if(overlayHost.IsOverlayReady)evidence.overlayReady=true;
            evidence.overlayMessageCount=Math.Max(evidence.overlayMessageCount,overlayHost.ReceivedMessageCount);
        }
        if(cefSurface!=null && cefSurface.GetComponent<UnityEngine.UI.RawImage>().texture!=null)
            evidence.cefRawImageBound=true;
    }
    private void Update(){
        if(reportSaved)return;
        try{
            Sample();
            float elapsed=Time.realtimeSinceStartup-start;
            if(!closing && overlayHost!=null && overlayHost.IsOverlayReady &&
               evidence.overlayMessageCount==0 && probes<8 &&
               Time.realtimeSinceStartup-lastProbe>3f){
                overlayHost.SendDualProbe();
                probes++;
                lastProbe=Time.realtimeSinceStartup;
            }
            if(!closing && elapsed>=duration){
                closing=true;
                shutdownStarted=Time.realtimeSinceStartup;
                evidence.overlayCloseRequested=overlayHost!=null && overlayHost.RequestDualShutdown();
                evidence.cefShutdown=textureHost!=null && textureHost.StopForDualTest();
                Debug.Log("[UNIFIED-DUAL] Close requested; preserving native DLL until STA join");
            }
            if(closing){
                evidence.overlayJoined=overlayHost!=null && overlayHost.IsPreviewShutdownComplete;
                if(evidence.overlayJoined || Time.realtimeSinceStartup-shutdownStarted>12f)
                    Finish();
            }
        }catch(Exception ex){
            evidence.error=ex.Message;Debug.LogError("[UNIFIED-DUAL] ERROR "+ex);
            if(!closing){closing=true;shutdownStarted=Time.realtimeSinceStartup;
                if(overlayHost!=null)try{evidence.overlayCloseRequested=overlayHost.RequestDualShutdown();}catch(Exception){}
                if(textureHost!=null)try{evidence.cefShutdown=textureHost.StopForDualTest();}catch(Exception){}
            }
            else Finish();
        }
    }
    private void Finish(){
        if(reportSaved)return;
        reportSaved=true;
        evidence.status=evidence.cefReady && evidence.cefAcceleratedFrames>0 &&
            evidence.cefRawImageBound && evidence.overlayReady && evidence.overlayMessageCount>0 &&
            evidence.overlayCloseRequested && evidence.overlayJoined && evidence.cefShutdown &&
            String.IsNullOrEmpty(evidence.error) ? "PASS_AUTO" : "FAIL_AUTO";
        evidence.completedUtc=DateTime.UtcNow.ToString("o");
        try{
            var parent=Path.GetDirectoryName(reportFile);
            if(!String.IsNullOrEmpty(parent))Directory.CreateDirectory(parent);
            File.WriteAllText(reportFile,JsonUtility.ToJson(evidence,true));
            Debug.Log("[UNIFIED-DUAL] "+evidence.status+" CEF accelerated="+evidence.cefAcceleratedFrames+
                " RawImage="+evidence.cefRawImageBound+" WebView2 msgs="+evidence.overlayMessageCount+
                " joined="+evidence.overlayJoined+" CEF shutdown="+evidence.cefShutdown);
        }catch(Exception ex){Debug.LogError("[UNIFIED-DUAL] Evidence write FAILED "+ex);}
        Application.Quit(evidence.status=="PASS_AUTO"?0:3);
    }
}
