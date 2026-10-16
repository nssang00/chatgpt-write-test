# Company WebView 제품화 · 구현 및 검증 매트릭스
기준일: 2026-10-16. 경쟁 기준: Vuplex(완성도) / Alacrity(성능) / TurboWeb(GPU 추적).
기준선: CEF v58.4.4, WebView2 v58.5.2, Unity Windows 실기 v58.6.0 검증 상태. **기존 PASS 브랜치 불변.**

## 원칙 및 판정 방식

* `AUTO_PASS`: GitHub Actions에서 실제 실행한 .NET 단위/계약, PowerShell 패키지 조립, 정적·빌드 도구 검사. 가짜 DLL/Unity 스텁은 테스트 픽스처일 뿐 네이티브 실기 PASS가 아니다.
* `PLAYER_PASS`: 실제 Windows Unity Player에서 확인한 GPU/HWND/입력/종료 증거가 있을 때만 부여한다.
* `MANUAL_PENDING`: DPI·IME 후보창·가시적 Z-order 등 실기에서만 판정 가능한 기능.
* `NOT_IMPLEMENTED`: API/네이티브 지원 미구현. 테스트를 녹색으로 만들기 위해 빈 함수나 가짜 PASS를 넣지 않는다.
* 변경된 모듈의 테스트와 기존 회귀만 Actions에서 실행. 전체 5분 원클릭 재실행은 릴리스 후보/네이티브 경로 변경 시에만 요청한다.

## 구현 백로그 + 수락 테스트

| ID | 우선 | 경쟁 기준 | 구현 작업 | GitHub Actions 자동화 (실행 가능한 것) | 실기 통과 조건 | 현 상태 |
|---|---|---|---|---|---|---|
| PKG-01 | P0 | Vuplex | 고정 CEF/WebView2를 사용한 UPM 패키징, asmdef, 설치 안내 | Windows: 필수 파일 누락 시 실패, DLL 원본 SHA 보존, 중복 출력 거부, test fixture 미포함, JSON/asmdef 검사 | 신규 Unity 2022.3 Windows 빈 프로젝트에서 설치/빌드 | **이번 브랜치: 코드 구현·CI 대상, 실기 보류** |
| UX-02 | P0 | Vuplex | Unity Editor에서 CEF Texture / WebView2 Overlay prefab 생성 | Unity Editor API 구조 정적 검사, .NET host 컴파일 검사(실제 Editor 아님) | prefab 생성 후 씬에 배치, 저장/재시작/Player 실행 | **이번 브랜치: Preview wizard, 실기 보류** |
| CORE-03 | P0 | 공통 | 두 백엔드 공통 생성/탐색/상태/에러·기능 표시 API | .NET Mock에서 Target/Mode 조합, 잘못된 옵션, open 예외 정리, dispose, message limit | 실제 두 모드에서 Navigation·오류 이벤트·실패 복구 | 기본 기능 구현, 확장 필요 |
| JS-04 | P0 | Vuplex | **CEF** ExecuteJS·JS↔C# String/JSON/Event 연결 | 프로토콜 roundtrip, Unicode/large-payload, malformed, timeout mock | CEF+WV2 실제 웹페이지 왕복 일치 | **CEF bridge NOT_IMPLEMENTED** |
| IN-05 | P0 | Vuplex | Texture 마우스/스크롤/키보드/포커스, 좌표계 | 픽셀·UV·Screen/World 좌표 변환 pure C# unit, 입력 상태 기계 mock | HTML form, drag, scroll, edit, keyboard modifiers | **NOT_IMPLEMENTED** |
| MULTI-06 | P0 | Vuplex | singleton → 인스턴스별 CEF/WV2 컨트롤러 | Mock 2/4/8개 독립 라우팅·Close·실패 격리 | Windows Player 2/4/8개 + scene teardown | **NOT_IMPLEMENTED** |
| LIFE-07 | P0 | Vuplex | Destroy/Scene/PlayStop/DomainReload 정상화 | mock 실패 삽입 100회, 자원 해제 호출 수, 중복 Close/Dispose | Scene/PlayStop/Destroy 100회; RAM/VRAM/핸들 회수 | 단일 종료 PASS, 확장 필요 |
| BUILD-08 | P0 | Vuplex | Mono·IL2CPP/Unity LTS·Unity 6 지원 범위 | Windows C# compile + 패키지 구조, 조건부 CI(Unity license가 제공되면 batch Editor build) | 각 빌드 모드별 Windows 실제 구동 | **IL2CPP 미검증** |
| GPU-09 | P0/P1 | Alacrity | 프레임 측정·동기화·GC/CPU/GPU 프로파일 | 카운터/리포트 파서 계약, 실패 임계값 단위 테스트, 성능 리포트 artifact | 1080p 60/144/240Hz, 1440p 144, 4K 60, 지연·p99 frame pacing | GPU 가속 실기 PASS, 고주사율 미측정 |
| OVL-10 | P1 | Vuplex | DPI/IME·후보창/Z-order 안정화 | Win32 DPI scale 계산, HWND bounds tests, 이벤트 allowlist | IME 조합·후보창 수동 확인, DPI 100/125/150 멀티 모니터 | 100% 위치 실측 PASS, 나머지 미확정 |
| RPC-11 | P1 | Alacrity | Binary/Async RPC/타임아웃·예외전파 | payload fuzz, request id·timeout·cancel·binary tests | 실제 브라우저 promise roundtrip | **NOT_IMPLEMENTED** |
| GPU-12 | P1/P2 | TurboWeb | Software fallback, GPU 진단, alpha·mouse-through | 기능 플래그/우회경로 mock, 포맷 테스트 | GPU unavailable, transparent UI, D3D11 alpha | **NOT_IMPLEMENTED** |
| REL-13 | Release | 공통 | Chromium 보안/재배포 라이선스·서명·예제 | SBOM/NOTICE 존재, 버전 핀, artifact hash, 빌드 불변성 | 제3자 신규 설치, 깨끗한 Windows 기기 | **NOT_IMPLEMENTED** |

## GitHub Actions 운영

1. `offline-regression`: 기존 ABI·정적·PowerShell·GPU 스크린샷 픽스처·캐시 테스트 유지.
2. `product-package-preview` (Windows 같은 workflow 단계): 합성 CEF runtime/WebView2 fixture로 UPM 생성·검증, 잘못된 입력 실패 테스트.
3. `product-api-contract`: .NET 8 mock CEF+WebView2 공통 API 오류·기본 메시지 회귀.
4. **실제 Unity Editor 빌드**는 GitHub Runner에 유효한 Unity Editor+Windows Build Support+라이선스 제공 전까지 `NOT_RUN`이라고 명시한다. Actions 성공을 Unity/CEF GPU PASS로 표기하지 않는다.
5. 별도 최종 통합 실기: P0 기능이 추가된 신규 Player 1회씩, 60/144/240Hz/IME/DPI/멀티 인스턴스는 실제 지원환경에서 별도 검증.

## 완료 판정 및 출시 게이트

* **P0 제품 베타:** PKG-01/UX-02/CORE-03/JS-04/IN-05/MULTI-06/LIFE-07/BUILD-08 필수 검증 PASS. CEF와 WebView2 API 격차를 숨기지 않을 것.
* **성능 주장:** GPU-09 동일 PC/해상도/HTML 측정표와 분산값 확보 전까지 Alacrity 수치보다 빠르다고 주장하지 않음.
* **TurboWeb 기준:** D3D12/Vulkan은 D3D11 Windows MVP 안정화 전에는 도입하지 않음.
* **배포:** REL-13 라이선스·보안·클린 설치 통과 전에는 상용 판매를 선언하지 않음.

이번 작업에 포함되는 범위는 PKG-01, UX-02의 첫 코드, CORE-03/LIFE-07 자동화 강화 및 CI이며, 나머지 항목은 구현되지 않은 것으로 남긴다.
