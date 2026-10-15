using System;
using UnityEngine;
using UnityEngine.UI;
using Company.WebView;

namespace Company.WebView.Unified.Experimental
{
    // Isolated v58.6.0 test harness, NOT part of the validated v58.4.4 CEF package.
    // Demonstrates that the same external CEF Texture2D drives a rotating Unity mesh.
    public sealed class CefCubeTextureProof : MonoBehaviour
    {
        [SerializeField] private RawImage textureSource;
        [SerializeField] private CefTextureSurface cefSurface;
        [SerializeField] private Renderer cubeRenderer;
        [SerializeField] private Transform cubeTransform;
        [SerializeField] private Transform occluder;
        [SerializeField] private Camera sceneCamera;
        private Material materialInstance;
        private ulong lastAcceleratedCount;
        private float startTime,lastSampleTime;
        private int durationSeconds=120;
        private bool wasRotating;
        private RenderTexture sampleTarget;
        private Texture2D samplePixels;
        private Color32[] previousPixels;
        public bool IsCubeTextureBound { get; private set; }
        public int TextureBindCount { get; private set; }
        public ulong ObservedCefFrameAdvances { get; private set; }
        public float AngularTravelDegrees { get; private set; }
        public int VisibleFrames { get; private set; }
        // Collider ray order proves scene depth geometry, NOT correct GPU depth pixels.
        public bool OccluderBeforeCubeRay { get; private set; }
        public bool FrontPoseInitialObserved { get; private set; }
        public bool FrontPoseRestoredObserved { get; private set; }
        public int SourcePixelSamples { get; private set; }
        public int SourcePixelChangeEvents { get; private set; }
        public int MaxChangedPixels { get; private set; }
        public string PixelReadbackError { get; private set; } = "";

        private void Awake()
        {
            if(cubeRenderer!=null) materialInstance=cubeRenderer.material;
            startTime=Time.realtimeSinceStartup;
            string[] args=Environment.GetCommandLineArgs();
            for(int i=0;i<args.Length-1;i++)
                if(args[i]=="-dualDuration" && Int32.TryParse(args[i+1],out int seconds))
                    durationSeconds=Math.Max(30,Math.Min(300,seconds));
            if(cubeTransform!=null)cubeTransform.rotation=Quaternion.identity;
        }
        private void ReadGpuPixels(Texture source)
        {
            if(source==null || !String.IsNullOrEmpty(PixelReadbackError))return;
            try
            {
                const int edge=96;
                if(sampleTarget==null){sampleTarget=new RenderTexture(edge,edge,0,RenderTextureFormat.ARGB32);sampleTarget.Create();}
                if(samplePixels==null)samplePixels=new Texture2D(edge,edge,TextureFormat.RGBA32,false);
                // Source GPU texture: pixel difference is independent of cube motion.
                Graphics.Blit(source,sampleTarget);
                var prior=RenderTexture.active;
                try {
                    RenderTexture.active=sampleTarget;
                    samplePixels.ReadPixels(new Rect(0,0,edge,edge),0,0,false);
                    samplePixels.Apply(false,false);
                } finally { RenderTexture.active=prior; }
                var pixels=samplePixels.GetPixels32();
                if(previousPixels!=null) {
                    int changed=0;
                    for(int i=0;i<pixels.Length;i++){
                        var a=pixels[i];var b=previousPixels[i];
                        if(Math.Abs(a.r-b.r)+Math.Abs(a.g-b.g)+Math.Abs(a.b-b.b)>48)changed++;
                    }
                    if(changed>=16)SourcePixelChangeEvents++;
                    MaxChangedPixels=Math.Max(MaxChangedPixels,changed);
                }
                previousPixels=pixels;
                SourcePixelSamples++;
            }catch(Exception e){PixelReadbackError=e.GetType().Name+": "+e.Message;}
        }
        private void Update()
        {
            if(textureSource==null || cubeRenderer==null || cubeTransform==null || cefSurface==null)
                return;
            var tex=textureSource.texture;
            if(materialInstance!=null && tex!=null && materialInstance.mainTexture!=tex)
            {
                materialInstance.mainTexture=tex;
                TextureBindCount++;
            }
            IsCubeTextureBound=tex!=null && materialInstance!=null &&
                ReferenceEquals(materialInstance.mainTexture,tex) && !textureSource.enabled;
            ulong count=cefSurface.AcceleratedFrameCount;
            if(count>lastAcceleratedCount)ObservedCefFrameAdvances+=count-lastAcceleratedCount;
            lastAcceleratedCount=count;
            float elapsed=Math.Max(0f,Time.realtimeSinceStartup-startTime);
            float progress=elapsed/Math.Max(1,durationSeconds);
            // Screenshot schedule: 22% FRONT / 53% ROTATING / 81% FRONT.
            if(progress<.30f){
                cubeTransform.rotation=Quaternion.identity;
                if(IsCubeTextureBound && elapsed>2f)FrontPoseInitialObserved=true;
            }else if(progress<.72f){
                wasRotating=true;
                var angularVelocity=new Vector3(13f,32f,9f);
                float step=Time.deltaTime;
                if(step>0f){cubeTransform.Rotate(angularVelocity*step,Space.World);
                    AngularTravelDegrees+=angularVelocity.magnitude*step;}
            }else{
                cubeTransform.rotation=Quaternion.identity;
                if(wasRotating && IsCubeTextureBound)FrontPoseRestoredObserved=true;
            }
            if(cubeRenderer.isVisible)VisibleFrames++;
            if(IsCubeTextureBound && progress<.28f && elapsed-lastSampleTime>=.43f && SourcePixelSamples<50){
                lastSampleTime=elapsed;
                ReadGpuPixels(tex);
            }
            if(!OccluderBeforeCubeRay && occluder!=null && sceneCamera!=null)
            {
                // Orthographic camera: a screen ray through the sphere center must
                // intersect the sphere's collider BEFORE the cube's collider.
                var center=occluder.position;
                var origin=new Vector3(center.x,center.y,sceneCamera.transform.position.z);
                var hits=Physics.RaycastAll(new Ray(origin,Vector3.forward),50f);
                Array.Sort(hits,(a,b)=>a.distance.CompareTo(b.distance));
                int front=-1,back=-1;
                for(int i=0;i<hits.Length;i++)
                {
                    if(hits[i].transform==occluder)front=i;
                    if(hits[i].transform==cubeTransform)back=i;
                }
                OccluderBeforeCubeRay=front>=0 && back>front;
            }
        }
        private void OnDestroy()
        {
            if(sampleTarget!=null){sampleTarget.Release();Destroy(sampleTarget);}
            if(samplePixels!=null)Destroy(samplePixels);
            if(materialInstance!=null)Destroy(materialInstance);
        }
    }
}
