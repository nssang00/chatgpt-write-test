# CompanyWebView Unity Dual OneClick v58.6.0 — 실험 검증

**실행:** 짧은 영문/숫자 경로에 배포 ZIP 1개를 풀고, 바깥쪽 `Run-Dual.cmd` 또는 내부 `oneclick_bundle/Run-Dual.cmd`를 실행합니다. 검증된 CEF v58.4.4 및 WebView2 v58.5.2 원본을 변경하지 않습니다.

현재 OneClick 원칙:

- CEF v58.4.4 기존 `oneclick_bundle/Build/cef-native/stage` 및 `Package/com.company.webview/Runtime`를 자동으로 찾아 **읽기 전용 재사용**합니다.
- 컴파일된 CEF DLL을 새 압축 해제 폴더의 `Build/`로 다시 복사하지 않습니다. `Build/`와 `Package/`의 PLACEHOLDER는 바이너리가 아닙니다. 실제 바이너리는 `%LOCALAPPDATA%\\CWV58`의 짧은 Unity 빌드/Player 폴더에 직접 배치합니다.
- 기존 CEF 런타임이 없으면 `oneclick_bundle/CefOneClick-v58.4.4-source.zip`를 검증 후 빌드하는 경로를 시도합니다. **이 정확한 이름의 SHA-256 고정 소스 ZIP은 실행 배포본에 반드시 포함해야 합니다.** 기본 CI 조립 아티팩트에는 포함되지 않을 수 있으며, 현재 인계 기반 로컬 보완 ZIP에만 확인되어 있습니다. 기존 stage가 없고 소스 ZIP도 없다면 명시적으로 실패합니다.
- 첫 CEF 빌드에는 Unity 2022.3.62f3 Windows Build Support, VS 2022 MSVC C++ Build Tools, CMake, 네트워크 및 큰 여유 디스크가 필요합니다. 공식 CEF 배포판 SHA-1을 검증합니다.
- `Documentation~`, `Samples~`, `Tests~` 및 긴 UnityHarness 경로는 native 소스 추출이나 Unity Assets에 포함하지 않습니다. 유니티에는 기존 CEF `Runtime` 폴더만 복사합니다.

**검증 범위:** Source/ABI/PowerShell 정적 검사와 실제 Unity Windows Player 동시 실행은 다릅니다. Unity Player 양쪽 Backend 렌더링, 한글/이모지 메시지, STA 종료, 창 캡처, IME 후보창/DPI/z-order는 실기 결과가 나오기 전까지 PASS로 간주하지 않습니다.

검증 후 `oneclick_bundle/results/dual-날짜.zip`를 확인하세요. 해당 결과물은 경로/환경 정보를 검토하고 공유합니다.


### 2026-10-16: 3D CEF cube proof (separate experimental Unity scene)

Left CEF screen-space RawImage rendering is DISABLED; its live external CEF GPU Texture2D is bound to an Unlit/Texture material on a rotating Unity Cube MeshRenderer. An offline CSS animated page drives frame updates. A solid orange Sphere placed closer to the Unity Camera tests depth overlap. Right WebView2 remains an independent Windows child HWND Overlay.

Automated PASS now requires `cubeTextureBound`, `cubeTextureBindCount>0`, `cubeObservedFrameAdvances>=3`, `cubeRotationDegrees>180`, `cubeVisibleFrames>0`, and `cubeOccluderBeforeCubeRay`, alongside previous CEF/WebView2 readiness/message/shutdown gates.

Note: The raycast verifies scene Collider depth order, NOT rendered framebuffer occlusion. Inspect captured screenshots for correct cube UV orientation and sphere occlusion; `cubeVisualDepthAndUvPending=true` remains set. Previous flat-panel PASS_AUTO does not prove this new cube experiment. Validated v58.4.4 and v58.5.2 baselines remain unchanged.


### v58.6.0 Fixed-front UV and dynamic GPU pixel proof (next validation)

- Left CEF uses a Unity 3D MeshRenderer, with its screen-space RawImage disabled; right WebView2 is a Windows child HWND.
- Cube orientation schedule: 0–30% facing camera, 30–72% rotating, then 72–100% facing camera. Foreground-only screenshots at 22%, 53%, 81% should show front, rotating, front.
- Offline page contains BLUE TOP / UV UP and RED BOTTOM / UV DOWN markers. Review both front-facing screenshots for readable text and correct vertical orientation. Automatic PASS does not claim pixel-level UV approval.
- During the initial stationary period, Graphics.Blit of the external CEF GPU Texture2D to 96×96 GPU target and ReadPixels must yield at least 3 samples, 2 significant pixel changes, and 16 changed pixels per largest change. These checks distinguish CSS animation from mesh motion.
- Raycast checks collider depth order only. Screenshot review is needed to confirm visually correct occlusion.
- The screenshot tool retries briefly but NEVER forces foreground or captures a different process. Missing screenshots mean manual visual verification remains pending.

#### Manual IME, DPI, and z-order checklist

1. Type Korean IME composition `한글 가나다`, mixed `abc123`, and emoji `😀` into the right WebView2 input. Check candidate window placement, caret movement, characters, and focus stability; do not enter private information.
2. Where supported, repeat at Windows display scales 100%, 125%, 150%. Move and resize the window across available monitors; check the right HWND stays clipped to its panel.
3. Alt+Tab away and back, minimize/restore, and overlap Unity with another application. Verify that WebView2 does not remain over unrelated foreground windows.
4. Mark each manual check PASS, FAIL (include reproduction step), or NOT_TESTED. Do not treat automated CI or Player PASS as an IME/DPI/z-order result.

### v58.6.0 fixed CEF 3D cube front-face UV orientation

2026-10-16 Windows Player evidence (`dual-20261016-075531.zip`) proved a real visual defect despite `PASS_AUTO`: in **both front-facing screenshots**, BLUE TOP was BELOW RED BOTTOM and the entire text appeared rotated 180 degrees. CEF GPU rendering, pixel changes and WebView2 all passed independently, so this is a visual UV mapping problem rather than an overlay substitution.

The isolated Unity test cube's material was corrected from `scale=(1,-1), offset=(0,1)` to `scale=(-1,1), offset=(1,0)`. The hidden RawImage uvRect was reset to identity; it is only a texture source and does not render the mesh. Neither the validated CEF native plugin nor WebView2 DLL is modified.

`DualPlayer/Verify-TextureUvMarkers.ps1` now reads **only** existing foreground screenshots `01_initial.png` and `03_restored.png`, checks that the BLUE TOP marker is visibly above the RED BOTTOM marker on screen, and writes `uv-visual-evidence.json`. When both captures are available and colors are inverted, OneClick reports a failure instead of silently accepting Player `PASS_AUTO`. If screenshots are missing, it reports INCOMPLETE rather than a visual PASS. Glyph readability and real IME/DPI/z-order still require review. This screenshot check applies to this specific dual-cube fixture, not arbitrary web pages.

### 2026-10-16: Separate manual IME/DPI/Z-order evidence mode

Use outer `Run-Manual-Compatibility.cmd` to run a **five-minute** non-screenshot session with real WebView2 keyboard input and user-marked scale/z-order verdicts. The HTML page emits ONLY whitelisted event labels (trusted IME composition start/end, throttled input count, explicit user verdicts); it never reads or sends the typed text. Unity also samples its OWN HWND child bounds, GetDpiForWindow, foreground transitions, minimize/restore counts. See `DualPlayer/MANUAL_COMPATIBILITY_KO.md` for the step-by-step Korean checklist. Results remain `PENDING_MANUAL` or `MANUAL_REVIEW_REQUIRED` rather than certifying any device-scale UI via CI. Run a separate session for each supported display scale; do not mark a scale that was not actually tested.

### 2026-10-16: 반복 다운로드/Unity 프로젝트 재빌드 방지

- 기존 CEF v58.4.4 바이너리 캐시는 `%LOCALAPPDATA%\CompanyWebView\CEF-v58.4.4\Build\cef-native\stage`에 유지되며 이미 있는 경우 재다운로드하지 않습니다. `cef_binary_...tar.bz2`는 최초 빌드 시 또는 CEF stage가 없고 자동 부트스트랩해야 할 때만 요청됩니다.
- 이번 수정으로 **Unity 프로젝트/Player까지 영구 캐시**합니다. `%LOCALAPPDATA%\CWV58\pc\<24-char-key>\UnityProject`와 `Player\UnifiedDualPreview.exe`를 보존합니다. 이전 버전의 `%LOCALAPPDATA%\CWV58\dual-날짜`와 달리 매 실행 시 새 프로젝트를 만들지 않습니다.
- 같은 ZIP의 소스·Unity Editor 설치·CEF 관리 C#·네이티브 빌드 식별자가 변하지 않으면 다음 실행부터 `[DUAL CACHE] HIT`로 Unity Import / BuildPlayer / 대용량 CEF 리소스 재복사를 건너뜁니다. 최초 실행이나 입력 변경 시 `[DUAL CACHE] MISS`로 한 번 빌드합니다. `summary.json`의 `buildCache`와 `playerCacheKey`로 확인합니다.
- 캐시 파일 일부가 없어졌거나 빌드 실패로 완료 마커가 없다면 HIT로 오판하지 않고 다시 빌드합니다. 동일한 캐시 키로 동시에 실행하면 공유 Player 변경을 막기 위해 명확한 오류로 중단합니다.
- 결과 ZIP은 여전히 테스트별로 새로 생성되며 IME·DPI·Z-order 판정은 이전과 동일하게 실제 실기 검증 대상입니다. Windows Unity 자체 패키지의 최초 설치/Unity Hub 다운로드는 이 캐시의 제어 범위 밖입니다.
- **기존 성공한 CEF Native v58.4.4 / WebView2 v58.5.2 코드는 수정하지 않습니다.**
