from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]
src=(root/'Run-Auto.ps1').read_text('utf-8')
cmd=(root/'Run-Auto.cmd').read_text('utf-8')
assembly=(root/'Build-UnityProduct.ps1').read_text('utf-8')
ui=(root/'Editor/UnifiedWebViewSetupMenu.cs').read_text('utf-8')
builder=(root/'Editor/UnifiedWebViewAutoBuild.cs').read_text('utf-8')
for word in ('Run-Auto.ps1','-File','%~dp0'):
    assert word in cmd,word
for word in ('param(','[string]$UnityExe','[switch]$LaunchPlayer',
             '$kitDir=$PSScriptRoot',"Join-Path $kitDir 'Build-UnityProduct.ps1'",
             "'Packages\\com.company.webview'", "'ProjectSettings\\ProjectVersion.txt'",
             'Company.WebView.Unified.Editor.UnifiedWebViewAutoBuild.Build',
             '-batchmode','-nographics','-quit','-buildTarget Win64',
             "[UPM AUTO] CACHE HIT",'[UPM AUTO] CACHE MISS',
             'BuildComplete.key','Get-FileHash','UnityEditorAutoBuild.log','product-auto-summary.json',
             'Copy-Item -LiteralPath $package', 'if($proc.ExitCode -ne 0)',
             'CompanyWebViewCefTextureProbe.dll','CompanyWebView2UnifiedPreview.dll'):
    assert word in src,word
assert 'Invoke-WebRequest' not in src and 'DownloadFile' not in src
assert 'Run-Dual' not in src, 'No five-minute test required'
assert 'SaveCurrentModifiedScenesIfUserWantsTo()' not in builder
assert 'CreateExampleSceneBatch()' in ui and 'CreateExampleSceneBatch()' in builder
assert "'UnifiedWebViewAutoBuild.cs'" in assembly
for word in ('BuildPipeline.BuildPlayer', 'GraphicsDeviceType.Direct3D11',
             'BuildResult.Succeeded', 'EditorBuildSettings.scenes',
             'GetCommandLineArgs', '-productBuildPath'):
    assert word in builder,word
print('One-click UPM product automation static contract PASS; no Unity Editor/Player executed')

# Regression for Unity 2022.3.62f3 CS0104 and one-click automatic cached-project recovery.
post=(root/'Editor/UnifiedWebViewBuildCopy.cs').read_text('utf-8')
recovery=(root/'Recover-CS0104.ps1').read_text('utf-8')
assert 'var info = PackageInfo.FindForAssembly(' not in post
assert 'UnityEditor.PackageManager.PackageInfo.FindForAssembly(' in post
assert 'Run-Auto.ps1' in cmd and 'powershell.exe' in cmd
assert 'Recover-CS0104.ps1' not in cmd, 'Feature release must not silently rebuild old v58.7 projects'
assert 'CS0104.*PackageInfo' in recovery and 'Select-String' in recovery
assert 'BuildComplete.key' in recovery and 'error CS[0-9]+' in recovery
assert 'Invoke-WebRequest' not in recovery and 'Run-Dual' not in recovery
assert 'existing Unity Library cache' in recovery
print('CS0104 fix and cached previous-project recovery contract PASS')

assert 'compile-errors-redacted.txt' in src

# UnityEngine.RectInt does not expose the != operator in Unity 2022.3; compile harness must match.
panel=(root/'Runtime/UnifiedWebViewPanel.cs').read_text('utf-8')
stub=(root/'Validation/ProductPanelCompileStub.cs').read_text('utf-8')
assert 'bounds != lastBounds' not in panel
for k in ('bounds.x != lastBounds.x', 'bounds.y != lastBounds.y',
          'bounds.width != lastBounds.width', 'bounds.height != lastBounds.height'):
    assert k in panel
assert 'operator !=(RectInt' not in stub and 'operator ==(RectInt' not in stub
assert 'CS0019.*RectInt' in recovery and '$candidate.NeedsRect' in recovery
assert 'fixedCS0019' in recovery and 'before-cs0019-fix.bak' in recovery
assert 'old Dist package contains Unity 2022 CS0019' in src
print('Unity 2022 RectInt CS0019 + reused-failed-project recovery contract PASS')
