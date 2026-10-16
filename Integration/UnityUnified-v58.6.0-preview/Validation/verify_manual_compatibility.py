from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
host = (root / "Runtime" / "UnifiedOverlaySceneHost.cs").read_text(encoding="utf-8")
telemetry = (root / "DualPlayer" / "UnifiedDualPlayerEvidence.cs").read_text(encoding="utf-8")
runner = (root / "DualPlayer" / "Run-Dual.ps1").read_text(encoding="utf-8")

for item in ("ManualCompatibilityPage", "compositionstart", "compositionend",
             "e.isTrusted", "compat-v1|ime-pass", "compat-v1|dpi125-fail",
             "compat-v1|zorder-pass", "ChildOutsideClientSamples",
             "GetDpiForWindow", "FindWindowEx", "ScreenToClient",
             "GetForegroundWindow", "MinimizeTransitions", "RestoreTransitions"):
    assert item in host, item
for item in ("trustedImeCompositionStarts", "trustedImeCompositionEnds", "trustedInputBatches",
             "dpi100Verdict", "dpi125Verdict", "dpi150Verdict", "zOrderVerdict",
             "overlayHostBoundsSamples", "unityForegroundRegainedCount",
             "nativeChildHostSeen", "-manualCompatibility"):
    assert item in telemetry, item
for item in ("[switch]$ManualCompatibility", "if($ManualCompatibility){$NoScreenshots=$true}",
             "-manualCompatibility {3}", "manualObserved", "USER_REPORTED_FAIL",
             "PARTIAL_OR_NOT_TESTED"):
    assert item in runner, item
assert "SetForegroundWindow" not in host
assert ".value" not in host, "Telemetry must never read WebView2 typed text"

# Only the allowed synthetic page script is extracted for Node JS syntax checking.
match = re.search(r'private const string ManualCompatibilityPage\s*=\s*@"(.*?)";',
                  host, flags=re.DOTALL)
assert match, "Manual JS page missing"
script = match.group(1)
assert "data-v='ime-pass'" in script and "data-v='zorder-fail'" in script
assert "getAttribute('data-v')" in script
import os, subprocess, tempfile
with tempfile.TemporaryDirectory() as tmp:
    path=Path(tmp)/"manual-page.js"
    path.write_text(script,encoding="utf-8")
    outcome=subprocess.run(["node","--check",str(path)],capture_output=True,text=True)
    assert outcome.returncode==0, "Manual HTML JavaScript syntax invalid: "+outcome.stderr

print("Manual IME/DPI/Z-order source contract and JavaScript syntax PASS; no Windows Player executed")
