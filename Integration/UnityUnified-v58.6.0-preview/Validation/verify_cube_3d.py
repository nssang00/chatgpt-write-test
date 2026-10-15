from pathlib import Path
root=Path(__file__).resolve().parents[1]
dual=root/'DualPlayer'
builder=(dual/'BuildUnifiedDualPlayer.cs').read_text(encoding='utf-8')
probe=(dual/'CefCubeTextureProof.cs').read_text(encoding='utf-8')
evidence=(dual/'UnifiedDualPlayerEvidence.cs').read_text(encoding='utf-8')
launcher=(dual/'Run-Dual.ps1').read_text(encoding='utf-8')
for required in ('GameObject.CreatePrimitive(PrimitiveType.Cube)',
                 'GameObject.CreatePrimitive(PrimitiveType.Sphere)',
                 'new Vector3(-3.8f,-0.65f,-3.5f)',
                 'CameraClearFlags.SolidColor',
                 'left.GetComponent<RawImage>().enabled=false',
                 'cube.AddComponent<CefCubeTextureProof>()',
                 'Assign(telemetry,"cubeProof",cubeProof)',
                 'Unlit/Texture',
                 'Assets/Materials/CefGpuCube.mat',
                 'animation:slide 1.2s linear infinite alternate',
                 'Uri.EscapeDataString(cubeHtml)'):
    assert required in builder, 'Missing Unity 3D scene evidence: '+required
for required in ('materialInstance.mainTexture=tex',
                 'ReferenceEquals(materialInstance.mainTexture,tex)',
                 'AngularTravelDegrees+=',
                 'ObservedCefFrameAdvances',
                 'Physics.RaycastAll',
                 'OccluderBeforeCubeRay=front>=0 && back>front',
                 'cubeRenderer.isVisible'):
    assert required in probe, 'Missing mesh/material proof: '+required
for required in ('cubeTextureBound',
                 'cubeTextureBindCount',
                 'cubeObservedFrameAdvances>=3',
                 'cubeRotationDegrees>180f',
                 'cubeVisibleFrames>0',
                 'cubeOccluderBeforeCubeRay',
                 'cubeVisualDepthAndUvPending=true'):
    assert required in evidence, 'Missing 3D evidence gate: '+required
assert "Copy-Item -LiteralPath (Join-Path $root 'DualPlayer\\CefCubeTextureProof.cs')" in launcher
assert 'CEF 3D cube mesh/material/animation/depth-geometry not proven' in launcher
assert 'WV2Unified' not in probe and 'HWND' not in probe, '3D proof must not use native overlay'
print('Unity CEF 3D animated cube / material identity / depth geometry contract PASS; actual Player NOT RUN')
