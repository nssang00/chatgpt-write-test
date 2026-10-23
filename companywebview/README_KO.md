# CompanyWebView: GitHub-hosted Windows + self-hosted GPU CI

이 폴더는 `chatgpt-write-test`의 NativeWeb 개발을 변경하지 않는 CompanyWebView 전용 CI 설정이다.

## 실제 동작

- `companywebview-windows.yml`: PR/Push에서 **GitHub-hosted `windows-2022`** 의 MSVC C++17 + .NET 도구 체인 검사. 기본 검사 통과는 CompanyWebView 컴파일 PASS가 아니다.
- 기본 브랜치에서 **workflow_dispatch** 시 `build_product=true`로 비공개 소스 ZIP을 SHA-256 검증해 내려받고, C# stub, JS 계약 검사, Windows CEF DLL + subprocess MSVC 빌드를 수행한다. Unity Editor/Player, GPU 실기 검증은 수행하지 않는다.
- `companywebview-gpu.yml`: 기본 브랜치 수동 실행 전용. `[self-hosted, Windows, X64, cwv-gpu]` + `cwv-gpu` environment에서 Unity Windows Player와 D3D11 GPU 증거를 검사한다. PR, Push 자동 GPU 실행 없음.

## 필수 설정

GitHub 저장소 **Secrets**: `CWV_KIT_URL` — 접근 제한된 CompanyWebView v6 GitHubActions OneClick_SourceKit ZIP의 만료 관리되는 HTTPS 다운로드 URL. 공개 저장소에 ZIP/소스/키를 commit하지 않는다.

GitHub 저장소 **Variables**:
- `CWV_KIT_SHA256` — 위 소스 ZIP의 64자리 SHA-256
- `CWV_CEF_SDK_URL` / `CWV_CEF_SDK_SHA256` — Windows CEF binary SDK ZIP
- `CWV_UNITY_API_URL` / `CWV_UNITY_API_SHA256` — Unity native plugin header ZIP
- GPU 실행기: `CWV_GPU_CEF_ROOT`, `CWV_GPU_UNITY_API`, `CWV_GPU_UNITY_EDITOR` (self-hosted 머신의 로컬 경로)

Self-hosted GPU 러너를 `cwv-gpu` 라벨로 등록하고 `cwv-gpu` Environment를 생성해 승인자 보호를 설정한다. GPU 머신은 인터랙티브 Windows 세션, 그래픽 드라이버, Unity 2022.3.62f3 및 Windows Build Support가 필요하다.

## 보안 및 증거 기준

- 이 저장소는 **public**이다. 개인/비공개 CompanyWebView 전체 소스·컴파일 바이너리·Player 로그는 업로드하지 않는다.
- 외부 ZIP은 SHA-256이 일치하지 않으면 빌드 시작 전에 FAIL.
- GitHub-hosted Windows에서 CEF 네이티브·관리형 stub만 컴파일; GPU PASS로 표시하지 않는다.
- GPU PASS는 실제 Player 스모크 로그와 `acceleratedFrames > 0, softwareFrames = 0`을 모두 확인해야 한다.
- GPU self-hosted는 수동 호출만 지원하고 PR 코드를 실행하지 않는다. 로그와 전체 아카이브는 머신에만 남으며 Actions에는 경로 없는 요약 지표만 업로드한다.
- 변수/러너/Unity 라이선스가 준비되지 않으면 해당 실제 빌드는 **BLOCKED/FAIL**, PASS가 아니다.

## 배포 상태

이 CI 변경을 GitHub 저장소에 반영한 것만으로 `CWV_KIT_URL`, SDK, self-hosted GPU가 준비되는 것은 아니다. 전제조건 충족 후에만 제품 컴파일과 GPU 검증 증거가 생성된다.
