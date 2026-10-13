using System;
namespace UnityEngine {
  public class MonoBehaviour {}
  [AttributeUsage(AttributeTargets.Class)]
  public sealed class DefaultExecutionOrder : Attribute { public DefaultExecutionOrder(int value) {} }
  public static class Application {
    public static string unityVersion => "2022.3.62f3";
    public static string persistentDataPath => ".";
    public static void Quit(int code) {}
  }
  public static class Time { public static float realtimeSinceStartup => 0f; }
  public static class Debug {
    public static void Log(object msg) {}
    public static void LogError(object msg) {}
  }
  public static class JsonUtility { public static string ToJson(object value, bool prettyPrint) => "{}"; }
}
