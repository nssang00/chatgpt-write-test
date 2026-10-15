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
    [SerializeField] private CefCubeTextureProof cubeProof;
    [Serializable] private sealed class Evidence {
        public string harness="58.6.0-dual-experimental";
        public string status="FAIL_AUTO";
        public string error="";
        public bool cefReady;
        public bool cefRawImageBound;
        public long cefAcceleratedFrames;
        public long cefSoftwareFrames;
        public bool overlayReady;
        public bool cubeTextureBound;
        public int cubeTextureBindCount;
        public ulong cubeObservedFrameAdvances;
        public float cubeRotationDegrees;
        public int cubeVisibleFrames;
        public bool cubeOccluderBeforeCubeRay;
        public bool cubeVisualDepthAndUvPending=true;
        public bool cubeFrontInitialObserved;
        public bool cubeFrontRestoredObserved;
        public int cubeSourcePixelSamples;
        public int cubeSourcePixelChangeEvents;
        public int cubeMaxChangedPixels;
        public string cubePixelReadbackError="";
        public int overlayMessageCount;
        public int overlayUnicodeRoundtripCount;
        public int overlayPingRoundtripCount;
        public bool automaticWindowScreenshotsAreSeparateEvidence=true;
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
        if(cubeProof!=null){
            evidence.cubeTextureBound |= cubeProof.IsCubeTextureBound;
            evidence.cubeTextureBindCount=Math.Max(evidence.cubeTextureBindCount,cubeProof.TextureBindCount);
            evidence.cubeObservedFrameAdvances=Math.Max(evidence.cubeObservedFrameAdvances,cubeProof.ObservedCefFrameAdvances);
            evidence.cubeRotationDegrees=Math.Max(evidence.cubeRotationDegrees,cubeProof.AngularTravelDegrees);
            evidence.cubeVisibleFrames=Math.Max(evidence.cubeVisibleFrames,cubeProof.VisibleFrames);
            evidence.cubeOccluderBeforeCubeRay |= cubeProof.OccluderBeforeCubeRay;
            evidence.cubeFrontInitialObserved |= cubeProof.FrontPoseInitialObserved;
            evidence.cubeFrontRestoredObserved |= cubeProof.FrontPoseRestoredObserved;
            evidence.cubeSourcePixelSamples=Math.Max(evidence.cubeSourcePixelSamples,cubeProof.SourcePixelSamples);
            evidence.cubeSourcePixelChangeEvents=Math.Max(evidence.cubeSourcePixelChangeEvents,cubeProof.SourcePixelChangeEvents);
            evidence.cubeMaxChangedPixels=Math.Max(evidence.cubeMaxChangedPixels,cubeProof.MaxChangedPixels);
            if(!String.IsNullOrEmpty(cubeProof.PixelReadbackError))
                evidence.cubePixelReadbackError=cubeProof.PixelReadbackError;
        }
        if(overlayHost!=null) {
            if(overlayHost.IsOverlayReady)evidence.overlayReady=true;
            evidence.overlayMessageCount=Math.Max(evidence.overlayMessageCount,overlayHost.ReceivedMessageCount);
            evidence.overlayUnicodeRoundtripCount=Math.Max(evidence.overlayUnicodeRoundtripCount,overlayHost.UnicodeRoundtripCount);
            evidence.overlayPingRoundtripCount=Math.Max(evidence.overlayPingRoundtripCount,overlayHost.PingRoundtripCount);
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
               (evidence.overlayUnicodeRoundtripCount==0 || evidence.overlayPingRoundtripCount==0) && probes<8 &&
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
            evidence.cefRawImageBound && evidence.cefAcceleratedFrames>=3 &&
            evidence.cubeTextureBound && evidence.cubeTextureBindCount>0 &&
            evidence.cubeObservedFrameAdvances>=3 && evidence.cubeRotationDegrees>180f &&
            evidence.cubeVisibleFrames>0 && evidence.cubeOccluderBeforeCubeRay &&
            evidence.cubeFrontInitialObserved && evidence.cubeFrontRestoredObserved &&
            evidence.cubeSourcePixelSamples>=3 && evidence.cubeSourcePixelChangeEvents>=2 &&
            evidence.cubeMaxChangedPixels>=16 && String.IsNullOrEmpty(evidence.cubePixelReadbackError) &&
            evidence.overlayReady && evidence.overlayMessageCount>0 &&
            evidence.overlayUnicodeRoundtripCount>0 && evidence.overlayPingRoundtripCount>0 &&
            evidence.overlayCloseRequested && evidence.overlayJoined && evidence.cefShutdown &&
            String.IsNullOrEmpty(evidence.error) ? "PASS_AUTO" : "FAIL_AUTO";
        evidence.completedUtc=DateTime.UtcNow.ToString("o");
        try{
            var parent=Path.GetDirectoryName(reportFile);
            if(!String.IsNullOrEmpty(parent))Directory.CreateDirectory(parent);
            File.WriteAllText(reportFile,JsonUtility.ToJson(evidence,true));
            Debug.Log("[UNIFIED-DUAL] "+evidence.status+" CEF accelerated="+evidence.cefAcceleratedFrames+
                " RawImage="+evidence.cefRawImageBound+" WebView2 unicode="+evidence.overlayUnicodeRoundtripCount+" WebView2 msgs="+evidence.overlayMessageCount+
                " cubeBound="+evidence.cubeTextureBound+" cubeFrameAdvances="+evidence.cubeObservedFrameAdvances+
                " cubeRotation="+evidence.cubeRotationDegrees+" occlusionRay="+evidence.cubeOccluderBeforeCubeRay+
                " frontInitial="+evidence.cubeFrontInitialObserved+" frontRestored="+evidence.cubeFrontRestoredObserved+
                " sourcePixels="+evidence.cubeSourcePixelSamples+" pixelChanges="+evidence.cubeSourcePixelChangeEvents+
                " maxChanged="+evidence.cubeMaxChangedPixels+" gpuReadbackError="+evidence.cubePixelReadbackError+
                " joined="+evidence.overlayJoined+" CEF shutdown="+evidence.cefShutdown);
        }catch(Exception ex){Debug.LogError("[UNIFIED-DUAL] Evidence write FAILED "+ex);}
        Application.Quit(evidence.status=="PASS_AUTO"?0:3);
    }
}
