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

