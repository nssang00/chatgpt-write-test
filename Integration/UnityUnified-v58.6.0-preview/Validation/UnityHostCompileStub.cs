// Compile-only Unity 2022.3 signatures, never a Unity behavioral/runtime proof.
using System;
namespace UnityEngine
{
    public class MonoBehaviour { public bool enabled {get;set;}=true; }
    [AttributeUsage(AttributeTargets.Field)] public sealed class SerializeField : Attribute {}
    [AttributeUsage(AttributeTargets.Method)] public sealed class ContextMenu : Attribute { public ContextMenu(string label) {} }
    public static class Debug {
        public static void Log(object x) {}
        public static void LogError(object x) {}
        public static void LogWarning(object x) {}
    }
    public static class Application {
        public static string dataPath=>"C:/TEST";
        public static string temporaryCachePath=>"C:/CACHE";
    }
    public enum RenderMode { ScreenSpaceOverlay, ScreenSpaceCamera, WorldSpace }
    public class Canvas { public RenderMode renderMode;public Camera worldCamera; }
    public class Camera {}
    public struct Vector3 { public float x,y,z; }
    public struct Vector2 { public float x,y; }
    public class RectTransform {
        public void GetWorldCorners(Vector3[] corners) {}
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
namespace UnityEngine.UI { public class RawImage {} }
namespace Company.WebView { public class CefTextureSurface : UnityEngine.MonoBehaviour {} }
