from pathlib import Path
import hashlib, io, json, re, zipfile

root=Path(__file__).resolve().parents[1]
code=(root/'Runtime/UnifiedWebViewPanel.cs').read_text('utf-8')
editor=(root/'Editor/UnifiedWebViewSetupMenu.cs').read_text('utf-8')
builder=(root/'Build-UnityProduct.ps1').read_text('utf-8')
post=(root/'Editor/UnifiedWebViewBuildCopy.cs').read_text('utf-8')
for s in ('UnifiedWebView.Create(', 'PresentationMode.Texture', 'PresentationMode.Overlay',
          'RectTransformUtility.WorldToScreenPoint', 'MessageReceived', 'void Close()',
          'File.Exists(subprocess)', 'GetWindowThreadProcessId', 'activeTexture', 'activeOverlay'):
    assert s in code, s
for s in ('PrefabUtility.SaveAsPrefabAsset', 'CefTexturePanel.prefab',
          'WebView2OverlayPanel.prefab', 'CreateExampleScene',
          'SaveCurrentModifiedScenesIfUserWantsTo', 'CustomEditor(typeof(UnifiedWebViewPanel))',
          'SerializedObject', '"target"'):
    assert s in editor, s
assert editor.count('SaveAsPrefabAsset')>=1
for s in ('07e06a42f38cab584ce4e35091d47710539cbaee21883e033ecb97565ec24eb8',
          'd5fdceca1991d4797148b0d20e4169d4b8e7f318d378da07ad23ac526efba644',
          'NativePayload~', 'CompanyWebView2UnifiedPreview.dll',
          'CompanyWebViewCefTextureProbe.dll', 'Company.WebView.Editor.asmdef',
          'CopySource', 'ExtractToFile', 'Get-FileHash'):
    assert s in builder, s
assert 'Invoke-WebRequest' not in builder and 'Start-Process' not in builder, 'No downloads/build in UPM assembly'
for s in ('IPostprocessBuildWithReport', 'StandaloneWindows64',
          'NativePayload~', 'BuildFailedException', 'libcef.dll', 'File.Copy'):
    assert s in post, s
assert 'Editor' not in (root/'Runtime/UnifiedWebViewPanel.cs').read_text('utf-8').split('using UnityEngine.UI;')[0]
for s in ['UnifiedWebView.cs','CefTextureBackendBridge.cs','WebView2OverlayBackendBridge.cs']:
    assert (root/'ExistingRuntime'/s).exists(), s
assert (root/'Editor/Company.WebView.Editor.asmdef').exists()
# Avoid binding-time Join-Path failures in Windows PowerShell 5.1.
param_text=builder.split('param(',1)[1].split('\n)',1)[0]
assert '$PSScriptRoot' not in param_text and 'Join-Path' not in param_text, 'Do not resolve paths while binding script arguments'
for needle in ('$kitDir=$PSScriptRoot', 'Split-Path -Path $MyInvocation.MyCommand.Path -Parent',
               "Join-Path $kitDir 'CefOneClick-v58.4.4-source.zip'",
               "Join-Path $kitDir 'CompanyWebView2UnifiedPreview.dll'",
               "Join-Path $kitDir 'Dist'"):
    assert needle in builder, 'UPM path resolution contract: '+needle
print('UPM product preview source contract PASS (no Unity Editor/Player execution)')

