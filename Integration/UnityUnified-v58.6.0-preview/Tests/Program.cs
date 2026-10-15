using System;
using System.Reflection;
using System.Runtime.InteropServices;
using Company.WebView.Unified.Experimental;

internal sealed class RecordingBackend : IUnifiedBackend
{
    public bool Opened, Closed, Disposed, FailOpen;
    public int Calls, Pumps, Resizes, JS, Posts;
    public bool IsReady => Opened && !Disposed;
    public bool IsShutdownComplete => Closed;
    public WebViewCapabilities Capabilities { get; } = new WebViewCapabilities { Navigation=true, TextureSurface=true };
    public void Open(UnifiedWebViewOptions options) { Opened=true; if (FailOpen) throw new InvalidOperationException("expected failure"); }
    public void LoadUrl(string s) { Calls++; }
    public void Reload() { Calls++; }
    public void Stop() { Calls++; }
    public void GoBack() { Calls++; }
    public void GoForward() { Calls++; }
    public void Resize(int w,int h) { Resizes++; }
    public void SetBounds(int x,int y,int w,int h) { Resizes++; }
    public void NotifyParentMoved() { }
    public void Pump() { Pumps++; }
    public bool TryReadMessage(out string message) { message=null;return false; }
    public void PostMessage(string data) { Posts++; }
    public void ExecuteJavaScript(string script) { JS++; }
    public void Close() { Closed=true; }
    public void Dispose() { Disposed=true; }
}
internal static class ContractTests
{
    private static int assertions;
    static void Check(bool ok,string reason) { assertions++; if(!ok)throw new Exception("FAIL "+reason); }
    static void Expect<T>(Action test) where T:Exception { bool threw=false;try{test();}catch(T){threw=true;}Check(threw,typeof(T).Name); }
    static UnifiedWebViewOptions Opt(PresentationMode m,TargetKind t) => new UnifiedWebViewOptions{Mode=m,Target=t};
    public static void Main()
    {
        // The real Windows Player returned two WebView2 messages, but Unicode/ping
        // comparisons failed: a default ANSI StringBuilder marshaler truncated UTF-16.
        var readMessage=typeof(WebView2OverlayBackendBridge).GetMethod(
            "WV2Unified_ReadMessage",BindingFlags.NonPublic|BindingFlags.Static);
        Check(readMessage!=null,"WebView2 native reader declaration exists");
        var import=readMessage.GetCustomAttribute<DllImportAttribute>();
        Check(import!=null && import.CharSet==CharSet.Unicode,"WebView2 receive buffer MUST marshal UTF-16");
        Check(UnifiedWebView.ResolveMode(PresentationMode.Auto,TargetKind.RawImage)==PresentationMode.Texture,"RawImage");
        Check(UnifiedWebView.ResolveMode(PresentationMode.Auto,TargetKind.MeshMaterial)==PresentationMode.Texture,"Mesh");
        Check(UnifiedWebView.ResolveMode(PresentationMode.Auto,TargetKind.RenderTexture)==PresentationMode.Texture,"RenderTexture");
        Check(UnifiedWebView.ResolveMode(PresentationMode.Auto,TargetKind.None)==PresentationMode.Overlay,"default overlay");
        Check(UnifiedWebView.ResolveMode(PresentationMode.Auto,TargetKind.ScreenRect)==PresentationMode.Overlay,"screen overlay");
        Expect<ArgumentException>(()=>UnifiedWebView.ResolveMode(PresentationMode.Texture,TargetKind.ScreenRect));
        Expect<ArgumentException>(()=>UnifiedWebView.ResolveMode(PresentationMode.Overlay,TargetKind.RawImage));
        Expect<ArgumentOutOfRangeException>(()=>UnifiedWebView.ResolveMode((PresentationMode)99,TargetKind.None));
        Expect<ArgumentException>(()=>UnifiedWebView.Create(Opt(PresentationMode.Auto,TargetKind.ScreenRect)));
        Expect<ArgumentException>(()=>UnifiedWebView.Create(Opt(PresentationMode.Overlay,TargetKind.None)));
        Expect<ArgumentException>(()=>UnifiedWebView.Create(Opt(PresentationMode.Texture,TargetKind.RawImage)));
        var backend=new RecordingBackend();
        using(var web=UnifiedWebView.CreateCore(Opt(PresentationMode.Auto,TargetKind.RawImage),_=>backend))
        {
            Check(backend.Opened && web.Mode==PresentationMode.Texture && web.IsReady,"created texture backend");
            web.LoadUrl("https://example.com");web.Reload();web.Stop();web.GoBack();web.GoForward();
            Check(backend.Calls==5,"navigation delegated");
            web.Resize(700,400);web.Pump();Check(backend.Resizes==1 && backend.Pumps==1,"resize/pump");
            Expect<NotSupportedException>(()=>web.PostMessage("x"));
            Expect<NotSupportedException>(()=>web.ExecuteJavaScript("1+1"));
            Expect<ArgumentOutOfRangeException>(()=>web.Resize(0,10));
            web.Close();Check(backend.Closed,"close");
        }
        Check(backend.Disposed,"disposed");
        var fail=new RecordingBackend{FailOpen=true};
        Expect<InvalidOperationException>(()=>UnifiedWebView.CreateCore(Opt(PresentationMode.Texture,TargetKind.RawImage),_=>fail));
        Check(fail.Disposed,"failed-open cleanup");
        var op=Opt(PresentationMode.Texture,TargetKind.RawImage);
        op.CefSubprocessPath="compile-only";op.CefCachePath="compile-only";
        using(var cef=UnifiedWebView.Create(op)) { cef.LoadUrl("about:blank");cef.Pump();cef.Resize(640,480);cef.Close(); }
        Console.WriteLine("Unity unified preview contract PASS: "+assertions+" assertions (no actual Unity/GPU)");
    }
}
