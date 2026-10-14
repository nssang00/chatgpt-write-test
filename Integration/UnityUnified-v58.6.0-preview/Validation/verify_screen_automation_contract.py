from pathlib import Path
r=Path(__file__).resolve().parents[1]
ps=(r/'DualPlayer/Run-Dual.ps1').read_text(encoding='utf-8')
cap=(r/'DualPlayer/Screen-Automation.ps1').read_text(encoding='utf-8')
host=(r/'Runtime/UnifiedOverlaySceneHost.cs').read_text(encoding='utf-8')
tel=(r/'DualPlayer/UnifiedDualPlayerEvidence.cs').read_text(encoding='utf-8')
for v in ('GetForegroundWindow','GetAncestor','GetWindowThreadProcessId',
          'CopyFromScreen','SetWindowPos','ImageFormat.Png','screen-automation.json',
          '01_initial','02_resized','03_restored','sha256',
          'manualVisualApprovalRequired=$true'):
    assert v in cap,v
for v in ('Start-DualScreenAutomation','NoScreenshots','ResolveCefRuntime',
          'screen-automation.json','diagnostics-redacted.log',
          'overlayUnicodeRoundtripCount','PENDING_MANUAL'):
    assert v in ps,v
for v in ('UnicodeRoundtripCount','PingRoundtripCount',
          "chrome.webview.postMessage('한글 가나다 ABC123 😀')",
          'msg==UnicodeFixture'):
    assert v in host,v
assert 'overlayUnicodeRoundtripCount>0' in tel
assert 'overlayPingRoundtripCount>0' in tel
assert 'manualImeDpiZOrderPending=true' in tel
# Uploaded ZIP must contain only small, explicitly selected evidence; never full browser profiles.
safe=ps.split('$safe=@(')[-1].split(')')[0]
assert 'diagnostics-redacted.log' in safe and 'unity-player.log' not in safe
assert 'Get-ChildItem -LiteralPath $shotDir -File -Filter' in ps
assert 'https://' not in cap and 'http://' not in cap
print('Automatic capture/static evidence policy PASS; Windows screenshot not run by CI')
