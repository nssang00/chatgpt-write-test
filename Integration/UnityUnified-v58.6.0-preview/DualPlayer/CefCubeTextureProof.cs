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
        public bool IsCubeTextureBound { get; private set; }
        public int TextureBindCount { get; private set; }
        public ulong ObservedCefFrameAdvances { get; private set; }
        public float AngularTravelDegrees { get; private set; }
        public int VisibleFrames { get; private set; }
        // Collider ray order proves scene depth geometry, NOT correct GPU depth pixels.
        public bool OccluderBeforeCubeRay { get; private set; }

        private void Awake()
        {
            if(cubeRenderer!=null) materialInstance=cubeRenderer.material;
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
            if(Time.deltaTime>0f)
            {
                var angularVelocity=new Vector3(13f,32f,9f);
                cubeTransform.Rotate(angularVelocity*Time.deltaTime,Space.World);
                AngularTravelDegrees+=angularVelocity.magnitude*Time.deltaTime;
            }
            if(cubeRenderer.isVisible)VisibleFrames++;
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
            if(materialInstance!=null)Destroy(materialInstance);
        }
    }
}
