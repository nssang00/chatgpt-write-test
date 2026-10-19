# v58.8.0 신규 기능: CEF 텍스처 UI 입력 (실험적)

- `Run-Auto.cmd`가 독립 Unity 프로젝트의 새 UPM 패키지, `CefTextureInputForwarder`, `EventSystem`, `StandaloneInputModule`, 데모 HTML 페이지를 생성한 뒤 Windows x64 D3D11 Player를 빌드합니다. 기존 v58.7.3 성공 Player는 변경하지 않으며 새 캐시 키를 사용합니다.
- CEF 텍스처 클릭·마우스 이동·휠·드래그·기본 키/텍스트를 **기존 컴파일된** `CompanyWebViewCefTextureProbe.dll`의 `Interaction*` 네이티브 함수에 전달합니다. Unity 2022.3 레거시 Input Manager 필요. 터치, 고급 IME, 브라우저 단축키, 자동화된 실기 인증은 아직 P0 미완료입니다.
- 데모 CEF 페이지는 `Assets/StreamingAssets/CompanyWebView/cef-input-demo.html`에 설치됩니다. `companywebview-demo://input` URL에서 이 페이지가 열리고, 버튼 하나의 JS 메시지를 `document.title`을 통해 Unity `MessageReceived`로 전달하며 Unity Player.log에는 `[CEF PAGE->UNITY DEMO]`가 찍힙니다.
- 이 **단방향 제목 폴링은 임시 프로토타입**입니다. 문서 제목을 변경하며, 빠른 연속 메시지가 유실될 수 있고 3,200문자 길이 제한이 있습니다. 범용 `ExecuteJavaScript`, Unity→CEF `PostMessage`, 비동기 RPC는 네이티브 재빌드와 별도 검증이 필요합니다. 현재 CEF `Capabilities.ScriptExecution=false`, `Capabilities.Messages=false`이며 `Capabilities.PageToUnityMessages`는 **데모에서만 opt-in 활성화**됩니다. 외부 웹사이트 메시지를 신뢰해서 실행하지 마세요.
- `Window > Package Manager` 수동 설치는 여전히 가능하며, 자동 빌드 성공과 Player 실제 상호작용 성공은 구분합니다.

---

# v58.7.3 Unity CS0019 자동 수정 (2026-10-19)

- 이전 `compile-errors-redacted.txt`의 `UnityEngine.RectInt` `!=` 오류(CS0019)를 좌표·크기별 비교로 수정했습니다.
- **Run-Auto.cmd** 한 번으로 시작하세요. 직전의 미완료 `2e63f1e5b65ba40e8f5a4a00` Unity 프로젝트가 남아 있고 CS0019 로그가 기록되어 있으면, **기존 `Library` 임포트 캐시를 보존한 채 한 줄만 수정해 Player 빌드를 재시도**합니다.
- 기존 CS0104 복구도 계속 지원합니다. 기존 CEF·WebView2 바이너리는 수정하지 않고 다운로드하지 않습니다.
- 새 Unity 프로젝트가 필요한 경우에는 기존 오프라인 UPM 조립 → Unity Editor 일괄 빌드로 진행합니다.
- 성공: `AutoResults/product-auto-summary.json` `status=AUTO_BUILD_PASS`; 실패: 동일 폴더 `compile-errors-redacted.txt` 및 UnityEditorAutoBuild.log 확인.
- CI는 C# 계약/PowerShell 파서 검증이며, 새 Unity Player 실기 성공을 주장하지 않습니다.

---

# v58.7.2 (2026-10-19) — CS0104 수정 통합 원클릭

**실행:** ZIP을 별도 폴더에 압축 해제한 후 `Run-Auto.cmd` 한 번 실행합니다. 

- Unity 2022.3.62f3의 `CS0104: PackageInfo ... ambiguous reference` 컴파일 오류를 소스에서 수정했습니다.
- 기존 v58.7.1이 이 오류로 실패한 `%LOCALAPPDATA%\CWV58\upm-product\<키>\UnityProject`가 있으면, `Run-Auto.cmd`가 **실패한 프로젝트를 자동으로 복구하고 기존 `Library` 임포트 캐시로 빌드만 다시 실행**합니다. 이전 프로젝트를 지우지 않습니다.
- 해당 이전 실패 캐시가 없으면 이전과 같이 CEF 캐시를 재사용하여 새로운 UPM 패키지·샘플 프로젝트·Prefab·씬 및 Win64 D3D11 Player를 조립합니다.
- CEF, WebView2 네이티브 DLL과 검증된 CEF 소스 ZIP은 이전 버전과 **동일한 바이너리**입니다. 네트워크 다운로드 없음.
- `AutoResults/product-auto-summary.json`에서 `AUTO_BUILD_PASS`를 확인합니다. 실패 시 `AutoResults/compile-errors-redacted.txt` 또는 요약의 `unityLog`를 확인합니다. 공유 전 민감정보를 검토하세요.
- Unity 2022.3.62f3 및 Windows Build Support가 필요합니다. 기본 Editor 경로가 아니면 `Run-Auto.cmd -UnityExe "C:\...\Unity.exe"`로 지정합니다.
- 이 키트는 현재 계정의 개인 Windows 프로젝트 캐시에만 작동하며, 다른 Unity 프로젝트는 수정하지 않습니다.

**검증 경계:** Windows CI에서 컴파일 및 소스 계약을 검증했으며, v58.7.2 원클릭이 실제 사용자 PC의 Unity Editor에서 빌드된 것은 아직 확인되지 않았습니다.

---

# 완전 자동 설치·빌드 (2026-10-18 추가)

**`Run-Auto.cmd`를 한 번 실행**하면 CEF v58.4.4 기존 컴파일 캐시를 재사용하여 다음을 자동 처리합니다.

1. 로컬 CEF + WebView2에서 `Dist/com.company.webview` UPM 패키지 조립 (기존 패키지가 완전하면 재사용). **다운로드나 CEF 재컴파일 없음.**
2. `%LOCALAPPDATA%\CWV58\upm-product\<키>\UnityProject`에 **독립된 Unity 2022.3.62f3 프로젝트** 생성; UPM 패키지를 embedded package로 자동 설치. 기존 프로젝트는 변경하지 않습니다.
3. Unity `-batchmode`로 CEF Texture + WebView2 Overlay Prefab과 `Assets/CompanyWebViewGenerated/DualPreview.unity` 예제 씬 생성 (저장 대화상자 없음).
4. Windows x64 / D3D11 Standalone Player 빌드, CEF 네이티브 리소스 배치, 결과 검증. 재실행 시 입력이 같으면 `CACHE HIT`로 완성된 Player 재사용.
5. `AutoResults/product-auto-summary.json`에 상태·캐시 히트·프로젝트 및 Player 경로 기록.

Unity Editor 기본 경로는 `C:\Program Files\Unity\Hub\Editor\2022.3.62f3\Editor\Unity.exe`입니다. 다른 위치라면 `Run-Auto.cmd -UnityExe "C:\...\Unity.exe"`를 사용하세요. 첫 실행에는 Unity Windows Build Support(IL2CPP 필수 아님, Mono로 검증)가 설치되어 있어야 합니다. 완성 후 실행까지 원하면 `Run-Auto.cmd -LaunchPlayer`를 사용할 수 있습니다.

**검증의 경계:** Windows CI에서는 코드 컴파일 및 자동화 계약을 확인할 수 있지만, 사용자 PC의 Unity Editor 일괄 빌드와 새 제품 프리팹 실기 동작은 실제 실행 결과가 나와야 확정됩니다. 실패 시 5분짜리 이전 렌더링 테스트는 필요하지 않고 `AutoResults/product-auto-summary.json`과 해당 캐시 폴더의 `UnityEditorAutoBuild.log`만 확인하면 됩니다.

---

# Company WebView Unity UPM — Preview 1 (Windows x64)

**목표:** 실험용 `Run-Dual.cmd`가 아닌 Unity Project에 설치해 CEF Texture / WebView2 Overlay를 선택하는 첫 제품형 패키지.

## 설치 (오프라인, 기존 런타임 재사용)

1. 검증된 `CefOneClick-v58.4.4-source.zip`, `%LOCALAPPDATA%\CompanyWebView\CEF-v58.4.4\Build\cef-native\stage`, `CompanyWebView2UnifiedPreview.dll` 준비.
2. Windows PowerShell에서 `Build-UnityProduct.ps1`을 실행. 위 파일·폴더가 실제로 없으면 설명과 함께 중단하며 재다운로드하지 않음.
3. 생성된 `com.company.webview` 폴더의 `package.json`을 Unity Package Manager > **Add package from disk**로 설치.
4. **Tools > Company WebView > Create Texture + Overlay Prefabs (Preview)** 메뉴 실행.
5. **Tools > Company WebView > Create Two-Panel Example Scene (Preview)**에서 예제 씬 생성.
6. Windows x64 Standalone Player를 **D3D11**로 빌드해 실행. Unity Editor Play Mode는 지원하지 않음.

### 프리팹과 Inspector

- 생성된 `Assets/CompanyWebViewGenerated/Prefabs/CefTexturePanel.prefab`: `RawImage` + 검증된 `CefTextureSurface` + 제품용 `UnifiedWebViewPanel`.
- 생성된 `Assets/CompanyWebViewGenerated/Prefabs/WebView2OverlayPanel.prefab`: `RectTransform` + 제품용 `UnifiedWebViewPanel` (Canvas 참조는 씬에서 지정).
- Inspector에서 URL, 모드, 브라우저 크기·FPS, 타깃을 설정할 수 있음. 여러 백엔드 호출을 한 API로 전달하며, 지원하지 않는 작업은 예외 처리함.
- `CefTextureSurface`의 RenderTexture/3D Material 자동 바인딩은 아직 미구현. 현재 프리팹은 **RawImage UI Texture** 용도이며, 3D Cube 실기 증명은 기존 테스트 브랜치의 별도 코드임.

## 분명한 제한

- **한 모드당 인스턴스 1개:** CEF 1개 + WebView2 1개까지; 다중 브라우저 구현 전.
- Texture의 마우스·휠·기본 키/텍스트 입력은 v58.8.0에 실험적으로 연결됨. 한글 IME는 정식 인증 전이고, 범용 CEF JS Bridge는 아직 미지원.
- Overlay의 한글 IME·복수 DPI·Z-order는 아직 완전한 제품 검증 전.
- JS `ExecuteJavaScript`는 WebView2에서만 발송 가능하며 반환값/예외 전달 미구현.
- CEF runtime을 상용 빌드에 포함하려면 적절한 오픈소스 고지와 CEF 재배포 조건을 별도로 검토.
- 이 UPM 제품 코드의 정적·컴파일 회귀 통과는 네이티브 Unity Player의 새 프리팹 실기 PASS가 아님.

## v58.7.0 Windows PowerShell startup path fix (2026-10-18)

`Build-UnityProduct.ps1` now resolves `CefArchive`, `WebView2Dll`, `OutputRoot`, and default `CefStage` **after** the `param()` block. This prevents the `Join-Path : Path parameter is empty` error on Windows PowerShell 5.1. Nothing is downloaded; existing local validated CEF stage remains mandatory. Custom `-CefStage` paths are still supported.

If a required runtime file is absent, the installer will now report its actual missing path rather than the earlier parameter-binding error.

## v58.7.0 CEF 재사용 경로 수정 (2026-10-18)

첫 UPM 소스 키트는 `%LOCALAPPDATA%\CompanyWebView\CEF-v58.4.4\Build\cef-native\stage`의 `native\Release` 레이아웃만 검사해서, 기존 OneClick이 저장한 **Unity Player 캐시**의 평면 `Plugins\x86_64` 형식을 놓쳤습니다. 이번 수정은 캐시를 먼저 검색합니다. CEF 다운로드나 컴파일은 수행하지 않습니다.

자동 검색 우선순위: `CEF_V58_4_4_RUNTIME_DIR`, `%LOCALAPPDATA%\CWV58\pc\*\Player\UnifiedDualPreview_Data\Plugins\x86_64`, `%LOCALAPPDATA%\CWV58\dual-*` Player, 이전 CEF stage, Downloads의 이전 OneClick 디렉터리(제한된 깊이).

실제 파일이 다른 위치에 있다면 `Build-UnityProduct.ps1 -CefStage "C:\...\Player\UnifiedDualPreview_Data\Plugins\x86_64"`처럼 직접 지정할 수 있습니다. `-CefStage`는 완성된 `native/Release + runtime/Release` 디렉터리 또는 `libcef.dll`과 `CompanyWebViewCefTextureProbe.dll` 등이 모두 있는 평면 `Plugins\x86_64` 경로를 받습니다. 선택한 경로가 불완전하면 자동으로 다른 바이너리로 대체하지 않고 명확히 실패합니다.

**실기 범위:** 자동 경로 탐색의 정적·Windows PowerShell 검사와 Unity Player 실행/패키지 설치 검증은 별개입니다. 이미 통과한 5분짜리 렌더링 시험은 다시 실행할 필요가 없습니다.

