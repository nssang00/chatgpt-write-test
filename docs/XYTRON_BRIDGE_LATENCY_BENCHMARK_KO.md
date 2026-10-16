# Xytron JS ↔ Native 브릿지 지연시간 벤치마크 계획

상태: **계획 / 아직 미측정**. 작성: 2026-10-16.
[기존 브릿지·리소스 계획](XYTRON_BRIDGE_TRANSPORT_PLAN_KO.md) 및
[전체 로드맵](ROADMAP.md)의 **P1 성능 관측·회귀 기반 작업**.
속도 목표 또는 실제 지연시간을 검증 없이 추정하지 않는다.
이 계획은 기존 NW-014 P0 보안 작업의 완료 판정이나 Scope A1 출시 조건을 변경하지 않는다.

## 왜 측정하나?

Xytron의 함수 호출은 JavaScript 직렬화, 엔진 IPC, Core 디스패치,
C++/Python/C# 실행, Promise 완료 등의 경로를 거친다. 표준 호출
`await xytron.math.add(1, 2)`의 체감 지연시간과 호출량 증가에 따른
큐잉·꼬리 지연(p95/p99)을 실측하고, 프로토콜 개선 전후를 비교한다.
WebView2 / CEF / WKWebView의 내부 IPC가 서로 다르므로 구현 계층과
동작 동일성은 유지하되 엔진별 결과는 구분한다.

## 플랫폼 매트릭스 (실제 브라우저, mock 금지)

| 표기 | OS / 아키텍처 | 엔진 | 측정 상태 |
| --- | --- | --- | --- |
| WIN-WV2 | Windows x64 | WebView2 | 미측정 |
| WIN-CEF | Windows x64 | CEF | 미측정 |
| LNX-CEF | Linux x64 | CEF | 미측정 |
| MAC-WK-ARM | macOS ARM64 | WKWebView | 미측정 |
| MAC-WK-INTEL | macOS x86_64 | WKWebView | 미측정 |
| LNX-WKGTK | Linux x64 | WebKitGTK 4.1 | 엔진 추가 후 |

먼저 **동일 프로세스 C++ in-process** 호출로 브라우저/브릿지 비용을
정량화한다. Python `bytes` / C# `byte[]` worker 왕복은 별도 결과로
측정한다. 관리형 worker의 시작·큐잉·별도 프로세스 IPC 비용을
브라우저별 C++ 지연시간과 섞어 비교하지 않는다.

## 측정 항목

| ID | 경로 | 정확한 측정값 | Payload / 목적 |
| --- | --- | --- | --- |
| LAT-01 | JS → Native → JS, `xytron.math.add()` | JS `performance.now()` 호출 직전부터 Promise 완료까지 **RTT** | 숫자 2개, no-op / 최소 계산 |
| LAT-02 | JS → Native → JS, `xytron.invoke("math.add")` | 동일 JS 측정 시계의 RTT | 직접 프록시 vs raw invoke의 차이 |
| LAT-03 | Native → JS → Native, `WebView::execute()` | Native `steady_clock` 호출 직전부터 `future` 완료까지 **RTT** | JS 미리 등록된 no-op / 계산 |
| LAT-04 | JS `postMessage` → Native → ack event | JS 송신 직전부터 별도 ack 수신까지 **왕복** | 단방향 API의 응답이 아님; 억지로 2로 나눠 단방향 지연이라고 부르지 않음 |
| LAT-05 | JS ↔ Native Binary RPC | LAT-01과 동일 JS RTT | 0B / 1KiB / 64KiB / 1MiB; 바이트 정확성 검사 |
| LAT-06 | 병렬 RPC | JS 전체 배치의 벽시계 시간 + 개별 요청 RTT | 동시성 1 / 8 / 32; ops/s, 큐잉 p95/p99 |
| LAT-07 | Python/C# worker | 실제 worker 응답까지의 전체 RTT | 언어별/프로세스별 별도 기록; 구현 완료 후 |
| LAT-08 | JS 또는 Native 시작 이후 첫 호출 | 첫 응답까지의 RTT | warm 호출과 구분; 시작·문서 주입 비용 포함 여부 명시 |

큰 바이너리(4MiB/16MiB)와 연속 프레임은 기능/메모리·백프레셔
검증 이후 **별도 고성능 시나리오**에서 측정한다. 이를 일반 작은
함수 호출의 속도 수치에 합치지 않는다.

## 측정 방법과 기록

1. 공개 JS API를 사용하고 **실제 WebView 프로세스**에서 실행한다.
   테스트 계산 로직은 no-op, 정수 add와 바이너리 echo로 고정한다.
   실패/오류/시간 초과를 숨기지 않고 독립 집계한다.
2. 문서 로드 + 네이티브 브릿지 준비 완료 후 **warm-up 1,000회**,
   직렬 호출 **5,000회**, **5개 독립 반복 세션**을 시작값으로 사용한다.
   CI 부하가 크면 사유와 축소된 표본 수를 기록하며 고정 수치를
   사실처럼 강제하지 않는다. Cold-start는 별도 표본/재시작.
3. 단일 반복의 **p50 / p95 / p99 / 평균 / 최소 / 최대 / 표준편차**를
   밀리초 또는 마이크로초로 기록한다. p99를 해석할 수 있도록
   성공 표본 수, 실패 수, 타임아웃 수를 함께 저장한다.
   처리량은 별도의 고정 동시성 구간에서 **ops/s**로 보고한다.
4. **같은 프로세스의 단조시계**로 왕복 시간을 재고, JS
   `performance.now()`와 Native `steady_clock` 원시 타임스탬프를
   빼서 편도 지연시간을 계산하지 않는다. 통신 경계 세부 시간은
   각 프로세스의 로컬 단계별 trace로만 기록한다.
5. CPU 아키텍처, OS/Runner image, Xcode/.NET/Python 런타임,
   CEF/WebView2/WebKit 엔진 버전, 빌드(Release), 모드,
   브릿지/프로토콜 커밋 SHA, 워크로드, 반복 횟수, payload 바이트 수,
   측정 시각, 타이머 해상도 및 테스트 환경을 JSON에 남긴다.
6. OS/아키텍처가 다른 Runner 결과를 그대로 엔진의 우열로 판단하지
   않는다. **동일 OS·장비·호스트 조건**에서만 엔진 간 직접 비교한다.
   특히 Windows CEF ↔ WebView2는 동일 조건의 쌍비교 대상으로 삼는다.
   Linux/macOS와의 차이는 환경 차이가 포함된 참고값이다.
7. GitHub-hosted Runner에는 공유 환경 잡음과 변동이 있다. 초기에는
   **전용 nightly/manual benchmark workflow**에서 JSON/CSV 원본과
   요약 Markdown을 Actions artifacts로 저장하고 추세를 관찰한다.
   PR에는 별도 짧은 smoke(표본 수 축소, 실패·중단 검사)를 두되,
   초기에는 수치 악화만으로 fail 처리하지 않는다.

## 결과와 완료 기준

- [ ] 동일 workload(함수/반환값·payload·반복·동시성) 공통 fixture 작성.
- [x] 기존 3개 엔진 + macOS WKWebView ARM/Intel 실브라우저 벤치마크 실행 단계 및
  GitHub Actions raw/summary artifact 업로드 설정 추가.
- [ ] 실제 5개 Runner 조합 smoke 결과 확인 및 측정값 수집.
- [ ] LAT-01/02/04/05/06 첫 smoke 실측값 검증; LAT-03 Native→JS는 후속.
- [ ] warmup 1000 / samples 5000 / 5회 독립 run의 반복 기준선 수집.
- [ ] LAT-01~LAT-06 기준값(JSON/CSV+Markdown) 및 재현 명령 기록.
- [ ] Debug/Release 차이, 첫 호출/warm, 동시성 큐잉을 별도 시각화.
- [ ] WebView2 tagged JSON byte-array의 인코딩/디코딩 오버헤드에
  대한 추적 항목, 개선 전/후 비교값 확보.
- [ ] 완료 뒤 Python/C# worker LAT-07과 Resource Provider/`fetch` 별도
  throughput 측정 계획 확장.
- [ ] Runner 편차 확인 후 동일 환경의 반복 기준선에 따라 **지속적인
  회귀 기준** 정의. 예: 최근 3회 이상 유의미한 p95 악화 시 경고
  및 측정 재확인. 임계치(ms), 허용 변화율은 **실측 뒤 결정**.

현재 스모크 설정(예비): warm-up 20, 샘플 100회, 바이너리 64KiB는 40회.
이는 초기 CI 오작동 및 지연시간 분포 확인용으로 1,000/5,000의 정식
기준선과 구분한다. Python runner는 수치를 합격선으로 비교하지 않고,
브라우저 종료/표본 누락/바이트 불일치만 실패시킨다.

**완료의 의미:** 실제 RTT를 숫자와 재현 환경으로 제시할 수 있고,
뒤의 Binary IPC / Resource Provider / SharedBuffer 작업이 성능을
개선했는지 확인할 수 있다. 아직 어떤 수치도 측정 완료로 표기하지 않는다.
