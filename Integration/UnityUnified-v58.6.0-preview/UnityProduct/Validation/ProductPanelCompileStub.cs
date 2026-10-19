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
    public static class Debug {public static void LogError(object s,Object o) {} public static void LogWarning(object s,Object o) {} public static void Log(object s,Object o) {}}
    public class Camera {}
    public enum RenderMode {ScreenSpaceOverlay,ScreenSpaceCamera,WorldSpace}
    public class Canvas : Object {public RenderMode renderMode;public Camera worldCamera;}
    public struct Vector3 {public float x,y,z;}
    public struct Vector2 {public float x,y; public Vector2(float x,float y){this.x=x;this.y=y;}}
    public struct Rect {public float xMin,yMin,width,height;}
    public class RectTransform : Object {public Rect rect;public void GetWorldCorners(Vector3[] v) {}}
    public static class RectTransformUtility {public static Vector2 WorldToScreenPoint(Camera c,Vector3 v)=>new Vector2();
       public static bool ScreenPointToLocalPointInRectangle(RectTransform r,Vector2 s,Camera c,out Vector2 local){local=s;return true;}}
    public struct RectInt
    {
        public int x,y,width,height;
        public RectInt(int x,int y,int w,int h){this.x=x;this.y=y;width=w;height=h;}
        public override bool Equals(object obj)=>obj is RectInt r && r.x==x && r.y==y && r.width==width && r.height==height;
        public override int GetHashCode()=>x^y^width^height;
    }
    public static class Screen {public static int width=>1400; public static int height=>850;}
    public static class Mathf {public static int RoundToInt(float x)=>(int)x;public static int Max(int x,int y)=>Math.Max(x,y); public static int FloorToInt(float x)=>(int)Math.Floor(x);public static int Clamp(int v,int low,int hi)=>Math.Min(hi,Math.Max(low,v));}
    public static class Application {public static string dataPath=>"C:/TEMP/Game_Data";public static string temporaryCachePath=>"C:/TEMP"; public static string streamingAssetsPath=>"C:/TEMP/StreamingAssets";}
}
namespace UnityEngine.UI {public sealed class RawImage : UnityEngine.Object{public UnityEngine.RectTransform rectTransform=>new UnityEngine.RectTransform();}}
namespace UnityEngine.EventSystems {
    public interface IPointerDownHandler {void OnPointerDown(PointerEventData e);}
    public interface IPointerUpHandler {void OnPointerUp(PointerEventData e);}
    public interface IScrollHandler {void OnScroll(PointerEventData e);}
    public interface IDragHandler {void OnDrag(PointerEventData e);}
    public interface IPointerEnterHandler {void OnPointerEnter(PointerEventData e);}
    public interface IPointerExitHandler {void OnPointerExit(PointerEventData e);}
    public sealed class PointerEventData {
        public enum InputButton {Left,Right,Middle}
        public UnityEngine.Vector2 position, scrollDelta;
        public UnityEngine.Camera pressEventCamera, enterEventCamera;
        public InputButton button;
        public int clickCount;
    }
}
namespace UnityEngine {
    public enum KeyCode {Backspace,Return,KeypadEnter,Tab,Delete,LeftArrow,UpArrow,RightArrow,DownArrow,Home,End,Escape}
    public static class Input {
        public static Vector2 mousePosition=>new Vector2();
        public static string compositionString=>"",inputString=>"";
        public static bool GetMouseButtonDown(int b)=>false;
        public static bool GetKeyDown(KeyCode k)=>false;
        public static bool GetKeyUp(KeyCode k)=>false;
    }
}
namespace Company.WebView {
    // These exports already exist in the pinned CEF 58.4.4 header. Compile-only signatures.
    public static class WebViewRuntime {
        public static string GetTitle()=>"";
        public static void CefPrototype_InteractionSetFocus(int f) {}
        public static void CefPrototype_InteractionMouseMove(int x,int y,int leave) {}
        public static void CefPrototype_InteractionMouseClick(int x,int y,int button,int up,int count) {}
        public static void CefPrototype_InteractionMouseWheel(int x,int y,int dx,int dy) {}
        public static void CefPrototype_InteractionSendKey(int key,int up) {}
        public static void CefPrototype_InteractionSendChar(uint u) {}
        public static void CefPrototype_InteractionImeSetComposition(string s) {}
        public static void CefPrototype_InteractionImeCommitText(string s) {}
        public static void CefPrototype_InteractionImeFinish() {}
    }
}
namespace Company.WebView {public sealed class CefTextureSurface:UnityEngine.MonoBehaviour{}}

