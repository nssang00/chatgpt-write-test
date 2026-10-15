# Windows PowerShell 5.1. Screenshots ONLY the foreground Unity Player window.
# OS-level CopyFromScreen includes WebView2 child HWND; Unity ScreenCapture does not.
function Start-DualScreenAutomation {
 param([System.Diagnostics.Process]$Player,[int]$DurationSeconds,[string]$OutputFolder)
 $report=[ordered]@{schema='dual-window-evidence-v1';status='UNAVAILABLE';foregroundOnly=$true;
   screenshots=@();actions=@();resizeConfirmedByDimensions=$null;manualVisualApprovalRequired=$true}
 $images=Join-Path $OutputFolder 'screenshots'
 New-Item -ItemType Directory -Force -Path $images | Out-Null
 try {
  Add-Type -ReferencedAssemblies @('System.Drawing','System.Windows.Forms') -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public static class DualWindowCapture {
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h,uint f);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int w,int t,uint f);
 [StructLayout(LayoutKind.Sequential)] struct RECT {public int l,t,r,b;}
 static bool Guard(IntPtr h,int process,out RECT r,out string error,bool captureOnly) {
  r=new RECT();error="";
  if(h==IntPtr.Zero){error="WINDOW_NOT_AVAILABLE";return false;}
  uint actual;GetWindowThreadProcessId(h,out actual);
  if(actual!=(uint)process){error="PROCESS_MISMATCH";return false;}
  if(!IsWindowVisible(h)||IsIconic(h)){error="HIDDEN_OR_MINIMIZED";return false;}
  if(GetAncestor(GetForegroundWindow(),2)!=h){error="NOT_FOREGROUND_NO_CAPTURE";return false;}
  if(!GetWindowRect(h,out r)){error="NO_WINDOW_RECT";return false;}
  int w=r.r-r.l,t=r.b-r.t;
  if(w<400||t<300||w>4096||t>3000){error="INVALID_WINDOW_BOUNDS";return false;}
  if(captureOnly && !SystemInformation.VirtualScreen.Contains(Rectangle.FromLTRB(r.l,r.t,r.r,r.b))){
    error="OFFSCREEN_NO_CAPTURE";return false;}
  return true;
 }
 public static string Capture(IntPtr h,int pid,string path) {
  RECT r;string err;if(!Guard(h,pid,out r,out err,true))return err;
  using(var bmp=new Bitmap(r.r-r.l,r.b-r.t)){
   using(var g=Graphics.FromImage(bmp))
    g.CopyFromScreen(r.l,r.t,0,0,bmp.Size,CopyPixelOperation.SourceCopy);
   bmp.Save(path,ImageFormat.Png);
  }
  return "CAPTURED";
 }
 public static string Resize(IntPtr h,int pid,bool smaller) {
  RECT r;string err;if(!Guard(h,pid,out r,out err,false))return err;
  int w=smaller?Math.Max(840,(int)((r.r-r.l)*.82)):Math.Max(1200,(int)((r.r-r.l)*1.18));
  int t=smaller?Math.Max(540,(int)((r.b-r.t)*.82)):Math.Max(760,(int)((r.b-r.t)*1.18));
  var area=SystemInformation.WorkingArea;
  w=Math.Min(w,area.Width-50);t=Math.Min(t,area.Height-50);
  if(w<700||t<450)return "DESKTOP_TOO_SMALL";
  int x=Math.Max(area.Left,Math.Min(r.l,area.Right-w));
  int y=Math.Max(area.Top,Math.Min(r.t,area.Bottom-t));
  return SetWindowPos(h,IntPtr.Zero,x,y,w,t,0x0014)?"RESIZED":"SETWINDOWPOS_FAILED";
 }
}
'@
  $start=[DateTime]::UtcNow
  $phases=@(
   @{name='00_fit_window';frac=.08;op='shrink'},
   @{name='01_initial';frac=.22;op='capture'},
   @{name='02_shrink';frac=.34;op='shrink'},
   @{name='02_resized';frac=.53;op='capture'},
   @{name='03_restore';frac=.66;op='restore'},
   @{name='03_restored';frac=.81;op='capture'}
  )
  foreach($phase in $phases){
   $at=$start.AddSeconds($DurationSeconds*[double]$phase.frac)
   while(-not $Player.HasExited -and [DateTime]::UtcNow -lt $at){
    Start-Sleep -Milliseconds 300;$Player.Refresh()
   }
   if($Player.HasExited){$report.actions+=@{name=$phase.name;result='PLAYER_EXITED'};continue}
   $Player.Refresh();$h=$Player.MainWindowHandle
   if($phase.op -eq 'capture'){
    $png=Join-Path $images ($phase.name+'.png')
    $code='NOT_ATTEMPTED'
    # Retry foreground-only. Never force focus or capture another application's window.
    for($attempt=0;$attempt -lt 16;$attempt++){
     $Player.Refresh();$h=$Player.MainWindowHandle
     $code=[DualWindowCapture]::Capture($h,$Player.Id,$png)
     if($code -eq 'CAPTURED' -or $Player.HasExited){break}
     Start-Sleep -Milliseconds 250
    }
    $entry=[ordered]@{name=$phase.name;result=$code;file=$null;bytes=0;sha256=$null;width=0;height=0}
    if($code -eq 'CAPTURED' -and (Test-Path -LiteralPath $png)){
     $entry.file='screenshots/'+$phase.name+'.png'
     $entry.bytes=(Get-Item -LiteralPath $png).Length
     $entry.sha256=(Get-FileHash -LiteralPath $png -Algorithm SHA256).Hash.ToLowerInvariant()
     $bmp=[System.Drawing.Bitmap]::FromFile($png)
     try{$entry.width=$bmp.Width;$entry.height=$bmp.Height}finally{$bmp.Dispose()}
    }
    $report.screenshots+=$entry
   }else{
    $report.actions+=@{name=$phase.name;result=[DualWindowCapture]::Resize($h,$Player.Id,($phase.op -eq 'shrink'))}
   }
  }
  $count=@($report.screenshots|Where-Object result -eq 'CAPTURED').Count
  if($count -eq 3){
   $a=@($report.screenshots|Where-Object name -eq '01_initial')[0]
   $b=@($report.screenshots|Where-Object name -eq '02_resized')[0]
   $c=@($report.screenshots|Where-Object name -eq '03_restored')[0]
   $report.resizeConfirmedByDimensions=($a.width -gt $b.width -and $a.height -gt $b.height -and
     $c.width -gt $b.width -and $c.height -gt $b.height)
  }
  $report.status=if($count -eq 3){'CAPTURED_3_OF_3'}elseif($count -gt 0){'PARTIAL_CAPTURE'}else{'NO_CAPTURE_PLAYER_NOT_FOREGROUND'}
 } catch {
  $report.status='AUTOMATION_ERROR'
  $report.actions+=@{name='error';result=$_.Exception.Message}
 } finally {
  $report|ConvertTo-Json -Depth 10|
    Set-Content -LiteralPath (Join-Path $OutputFolder 'screen-automation.json') -Encoding UTF8
 }
}
