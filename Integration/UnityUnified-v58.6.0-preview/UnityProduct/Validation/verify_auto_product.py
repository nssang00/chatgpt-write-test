from pathlib import Path
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
             '[UPM AUTO] CACHE HIT','[UPM AUTO] CACHE MISS',
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

# Unity 2022 RectInt does not implement !=, and our stub must faithfully model it.
panel=(root/'Runtime/UnifiedWebViewPanel.cs').read_text('utf-8')
stub=(root/'Validation/ProductPanelCompileStub.cs').read_text('utf-8')
assert 'bounds != lastBounds' not in panel
for name in ('bounds.x != lastBounds.x', 'bounds.y != lastBounds.y',
             'bounds.width != lastBounds.width', 'bounds.height != lastBounds.height'):
    assert name in panel, name
assert 'operator !=(RectInt' not in stub and 'operator ==(RectInt' not in stub
print('Unity 2022 RectInt CS0019 source regression PASS')
