// Compile-only Unity 2022.3 signatures, never a Unity behavioral/runtime proof.
using System;
namespace UnityEngine
{
    public class Object {}
    public class MonoBehaviour : Object { public bool enabled {get;set;}=true; public T GetComponent<T>() where T:new(){return new T();} }
    public class GameObject : Object {
        public GameObject(string name,params Type[] comps){}
        public RectTransform transform=>new RectTransform();
        public T AddComponent<T>() where T:new(){return new T();}
        public T GetComponent<T>() where T:new(){return new T();}
    }
    [AttributeUsage(AttributeTargets.Field)] public sealed class SerializeField : Attribute {}
    [AttributeUsage(AttributeTargets.Method)] public sealed class ContextMenu : Attribute { public ContextMenu(string label) {} }
    public static class Debug {
        public static void Log(object x) {}
        public static void LogError(object x) {}
        public static void LogWarning(object x) {}
    }
    public static class Application {
        public static string dataPath=>"C:/TEST";
        public static string unityVersion=>"2022.3.62f3";
        public static string temporaryCachePath=>"C:/CACHE";
        public static string persistentDataPath=>"C:/TEMP";
        public static void Quit(int code) {}
    }
    public static class Time { public static float realtimeSinceStartup=>0; }
    public static class JsonUtility {public static string ToJson(object data,bool pretty)=>"{}";}
    public enum RenderMode { ScreenSpaceOverlay, ScreenSpaceCamera, WorldSpace }
    public enum FullScreenMode {Windowed}
    public struct Color {public Color(float r,float g,float b,float a){} }
    public class Canvas : Object {public RenderMode renderMode;public Camera worldCamera;public RectTransform transform=>new RectTransform();}
    public class Camera {}
    public struct Vector3 { public float x,y,z; }
    public struct Vector2 {public float x,y;public Vector2(float a,float b){x=a;y=b;} }
    public class RectTransform : Object {
        public GameObject gameObject=>new GameObject("RectStub");
        public Vector2 anchorMin,anchorMax,offsetMin,offsetMax;
        public void SetParent(RectTransform parent,bool worldPositionStays){}
        public T GetComponent<T>() where T:new(){return new T();}
        public void GetWorldCorners(Vector3[] corners){}
    }
    public struct RectInt {
        public int x,y,width,height;
        public RectInt(int a,int b,int c,int d) {x=a;y=b;width=c;height=d;}
    }
    public static class Screen { public static int width=>1280;public static int height=>720; }
    public static class Mathf { public static int RoundToInt(float v) => (int)Math.Round(v); }
    public static class RectTransformUtility {
        public static Vector2 WorldToScreenPoint(Camera camera,Vector3 corner)=>new Vector2();
    }
}
namespace UnityEngine.UI {public class RawImage : UnityEngine.Object {public object texture;public UnityEngine.Color color;}public class CanvasScaler : UnityEngine.Object {}public class GraphicRaycaster : UnityEngine.Object {}}
namespace Company.WebView { public class CefTextureSurface : UnityEngine.MonoBehaviour {public ulong AcceleratedFrameCount {get;set;} public ulong SoftwareFrameCount {get;set;} } }
