# 완전 자동 설치·빌드 (2026-10-18 추가)

**`Run-Auto.cmd`를 한 번 실행**하면 CEF v58.4.4 기존 컴파일 캐시를 재사용해 다음을 자동 처리합니다.

1. 로컬 CEF와 WebView2에서 `Dist/com.company.webview` UPM 패키지를 조립합니다. 다운로드나 CEF 재컴파일은 하지 않습니다.
2. `%LOCALAPPDATA%\CWV58\upm-product\<캐시키>\UnityProject`에 **별도 Unity 2022.3.62f3 프로젝트**를 생성하고 embedded UPM 패키지를 설치합니다. 기존 사용자 프로젝트는 수정하지 않습니다.
3. Unity `-batchmode`로 Texture 및 Overlay Prefab, `Assets/CompanyWebViewGenerated/DualPreview.unity` 예제 씬을 자동 생성합니다.
4. Windows x64 D3D11 Standalone Player를 빌드하고 CEF 리소스 파일을 배치합니다. 동일 입력으로 재실행하면 `CACHE HIT`로 기존 Player를 재사용합니다.
5. `AutoResults/product-auto-summary.json`에 성공 여부와 Player·Unity Editor 로그 경로를 기록합니다.

Unity Editor는 기본 `C:\Program Files\Unity\Hub\Editor\2022.3.62f3\Editor\Unity.exe`에서 탐색합니다. 필요하면 `Run-Auto.cmd -UnityExe "C:\...\Unity.exe"`로 직접 지정하세요. 최초 자동 빌드에는 Unity Editor와 Windows Build Support가 필요합니다. 실행까지 원하면 `Run-Auto.cmd -LaunchPlayer`를 사용합니다.

**검증 경계:** GitHub Windows CI는 배치 메서드 컴파일·PowerShell 구문·계약 검사만 수행합니다. 실제 Unity Editor 패키지 설치 및 Player 실행은 사용자 PC의 결과가 나오기 전까지 통과로 판정하지 않습니다. 이전의 5분짜리 렌더링 검증은 반복하지 않습니다.

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
- Texture의 마우스·키보드·한글 IME 전달과 CEF JS Bridge는 아직 지원하지 않음.
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
