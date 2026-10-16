using System;
namespace UnityEngine
{
    public class Object {}
    public class MonoBehaviour : Object {}
    [AttributeUsage(AttributeTargets.Class)] public sealed class DisallowMultipleComponent : Attribute {}
    [AttributeUsage(AttributeTargets.Class)] public sealed class AddComponentMenu : Attribute {public AddComponentMenu(string s) {}}
    [AttributeUsage(AttributeTargets.Field)] public sealed class SerializeField : Attribute {}
    [AttributeUsage(AttributeTargets.Field)] public sealed class MinAttribute : Attribute {public MinAttribute(int i) {}}
    [AttributeUsage(AttributeTargets.Field)] public sealed class RangeAttribute : Attribute {public RangeAttribute(int min,int max) {}}
    public static class Debug {public static void LogError(object s,Object o) {} public static void LogWarning(object s,Object o) {}}
    public class Camera {}
    public enum RenderMode {ScreenSpaceOverlay,ScreenSpaceCamera,WorldSpace}
    public class Canvas : Object {public RenderMode renderMode;public Camera worldCamera;}
    public struct Vector3 {public float x,y,z;}
    public struct Vector2 {public float x,y; public Vector2(float x,float y){this.x=x;this.y=y;}}
    public class RectTransform : Object {public void GetWorldCorners(Vector3[] v) {}}
    public static class RectTransformUtility {public static Vector2 WorldToScreenPoint(Camera c,Vector3 v)=>new Vector2();}
    public struct RectInt
    {
        public int x,y,width,height;
        public RectInt(int x,int y,int w,int h){this.x=x;this.y=y;width=w;height=h;}
        public static bool operator ==(RectInt a,RectInt b)=>a.Equals(b);
        public static bool operator !=(RectInt a,RectInt b)=>!a.Equals(b);
        public override bool Equals(object obj)=>obj is RectInt r && r.x==x && r.y==y && r.width==width && r.height==height;
        public override int GetHashCode()=>x^y^width^height;
    }
    public static class Screen {public static int width=>1400; public static int height=>850;}
    public static class Mathf {public static int RoundToInt(float x)=>(int)x;public static int Max(int x,int y)=>Math.Max(x,y);}
    public static class Application {public static string dataPath=>"C:/TEMP/Game_Data";public static string temporaryCachePath=>"C:/TEMP";}
}
namespace UnityEngine.UI {public sealed class RawImage : UnityEngine.Object{}}
namespace Company.WebView {public sealed class CefTextureSurface:UnityEngine.MonoBehaviour{}}

