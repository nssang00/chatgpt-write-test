from pathlib import Path

root = Path(__file__).resolve().parents[1]
dual = root / "DualPlayer"
builder = (dual / "BuildUnifiedDualPlayer.cs").read_text(encoding="utf-8")
probe = (dual / "CefCubeTextureProof.cs").read_text(encoding="utf-8")
evidence = (dual / "UnifiedDualPlayerEvidence.cs").read_text(encoding="utf-8")
runner = (dual / "Run-Dual.ps1").read_text(encoding="utf-8")
screen = (dual / "Screen-Automation.ps1").read_text(encoding="utf-8")

for pattern in ("BLUE TOP / UV UP", "RED BOTTOM / UV DOWN",
                "animation:slide 1.2s linear infinite alternate",
                "left.GetComponent<RawImage>().enabled=false",
                "CefCubeTextureProof"):
    assert pattern in builder, pattern
for pattern in ("progress<.30f", "progress<.72f",
                "FrontPoseInitialObserved", "FrontPoseRestoredObserved",
                "Graphics.Blit(source,sampleTarget)",
                "samplePixels.ReadPixels(", "samplePixels.GetPixels32()",
                "SourcePixelChangeEvents", "MaxChangedPixels",
                "ReferenceEquals(materialInstance.mainTexture,tex)"):
    assert pattern in probe, pattern
for pattern in ("cubeFrontInitialObserved && evidence.cubeFrontRestoredObserved",
                "cubeSourcePixelSamples>=3", "cubeSourcePixelChangeEvents>=2",
                "cubeMaxChangedPixels>=16", "cubePixelReadbackError"):
    assert pattern in evidence, pattern
assert "CEF source GPU pixels did not demonstrate CSS animation" in runner
assert "for($attempt=0;$attempt -lt 16;$attempt++)" in screen
assert "NOT_FOREGROUND_NO_CAPTURE" in screen
assert "SetForegroundWindow" not in screen
uv = (dual / "Verify-TextureUvMarkers.ps1").read_text(encoding="utf-8")
assert "cubeMaterial.mainTextureScale=new Vector2(-1,1)" in builder, "Front-face UV must flip U, not V"
assert "cubeMaterial.mainTextureOffset=new Vector2(1,0)" in builder, "Front-face UV offset"
for pattern in ("BLUE TOP", "RED BOTTOM", "blueMeanY", "redMeanY", "checkedScreenshots",
                "uv-visual-evidence.json", "INVERTED"):
    assert pattern in uv, "Screenshot UV verifier missing: "+pattern
assert 'Verify-TextureUvMarkers.ps1' in runner
assert "CEF texture orientation FAIL" in runner
print("Fixed-front UV + animated CEF GPU source pixel contract PASS (no Unity Player)")
