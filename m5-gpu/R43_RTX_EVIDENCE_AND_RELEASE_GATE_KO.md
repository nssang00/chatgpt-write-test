# M5 R35–R43 RTX 실측 검증 / 2026-10-23 KST

## 최종 판정

- **R35 원래 인수 게이트: NO-GO.** `Worker`가 첫 화면의 임계 경로에 있는 콜드 시작까지 포함하여 Building/Road/Mixed 전 장면에서 OpenLayers 10.10.0 대비 ≥50% 단축하는 기준은 충족하지 못했다.
- **R42/R43의 새로운 opt-in 아키텍처: 검증된 실험 후보.** *첫 화면은 메인 스레드에서 렌더하고*, GPU 화면 캡처 후 2개 Worker를 기동해 후속 타일 인코딩을 수행한다. 따라서 첫 화면 시간에 Worker 초기화 시간이 합산되지 않는다. 이 대안을 원래 R35의 always-worker 합격으로 재해석하면 안 된다.
- **릴리스: 보류.** 기존 기본 OFF, 실험 브랜치만 사용, `main` 무변경. 실제 앱 통합, 추가 시나리오(DPR2, 인터랙션, 장시간 사용)를 별도 검증해야 한다.

## 환경 / 측정

- 실물 self-hosted Windows RTX: DESKTOP-F97I399 / NVIDIA GeForce RTX 5060 Ti, driver 610.47.
- 고정 R35 원본: `C:\M5_R35\M5_R35_RTX_READY_SELF_CONTAINED_2026-10-22.zip` SHA-256 `3e5d3cb5d525b818a3b560731dac0ae17ce734ab5a96057c67c546c4b7cb2776`.
- OpenLayers 대조군을 각 실험 전후로 실행해 **더 빠른** 값을 기준으로 보수적으로 비교. 모든 캠페인 중간값이 50% 기준 이상이어야 해당 실험에서 PASS.
- 실험 분기: `m5/r34-shared-decode-workerpool-20261022`.

## 단계별 원시 증거

| 단계 | Actions run | 결과 | 검증 범위 / 관찰 |
|---|---:|---|---|
| R35 원래 인수 | [39802154312](https://github.com/nssang00/chatgpt-write-test/actions/runs/39802154312) | **FAIL** | 8개 캠페인 모두 수집했지만 Worker 초기화 포함 50% 기준 실패. Building OL212.4ms/cold2 214.4ms, Road OL97.1ms/cold2 137.9ms, Mixed OL295.0ms/cold2 199.0ms. 픽셀 허용 범위 충족 |
| R36 레이어 스케일 | [39803651992](https://github.com/nssang00/chatgpt-write-test/actions/runs/39803651992) | PASS (탐색) | 1/2/4/8/16레이어 총 30측정. 8/16레이어에서는 중복 레이어로 공유 디코딩 꺼져 32/64회 PBF 디코딩 |
| R37 중복 소스 공유 | [39805548215](https://github.com/nssang00/chatgpt-write-test/actions/runs/39805548215) | PASS (탐색) | 중복 소스에서도 타일당 1회 parse; 8/16레이어 32/64회→4회. CPU 372 typed-array streams exact, GPU RGBA8 exact |
| R38 첫 화면 후 Worker | [39806530638](https://github.com/nssang00/chatgpt-write-test/actions/runs/39806530638) | PASS (대안) | 첫 화면 50% 단축, 이후 Worker 준비/실제 MVT 작업 확인 |
| R39 후속 Worker 재렌더 | [39807850919](https://github.com/nssang00/chatgpt-write-test/actions/runs/39807850919) | FAIL (성능) | 2W 두 캠페인 중 Road 하나 49.444%; 후속 Worker GPU 재렌더 30/30 RGBA8 동일. [4W 시도](https://github.com/nssang00/chatgpt-write-test/actions/runs/39807081535) Road 49.568% |
| R40 32레이어 스타일 스케일 | [39808523405](https://github.com/nssang00/chatgpt-write-test/actions/runs/39808523405) | PASS (탐색) | 32레이어·반복 소스·차등 스타일. OL1866.2ms vs cold2 454.7ms (75.6% 단축), decode 128→4. GPU RGBA8 exact |
| R41 PBF no-copy | [39808865031](https://github.com/nssang00/chatgpt-write-test/actions/runs/39808865031) | FAIL (성능) | Road 캠페인 B 48.455% |
| R42 빠른 PBF 리더+no-copy+deferred 2W | [39809390711](https://github.com/nssang00/chatgpt-write-test/actions/runs/39809390711) | **3회 연속 PASS (대안)** | 동일 커밋 3회 독립 실행, 18개 장면×캠페인 비교 전부 ≥50%. Worker 후속 리렌더 90/90 exact RGBA8 |
| R43 팬·줌·회전 상태 검증 | [39810943247](https://github.com/nssang00/chatgpt-write-test/actions/runs/39810943247) | PASS (대안) | 첫 화면 6개 비교 전부 ≥50%, 후속 Worker 재렌더 30/30 exact, 팬·줌·회전·복합 4개 뷰×30샘플=120/120 exact RGBA8 |

모든 파일은 실행별 GitHub Actions artifact에 보존된다. 특히 [R42 artifact 목록](https://github.com/nssang00/chatgpt-write-test/actions/runs/39809390711), [R43 artifact](https://github.com/nssang00/chatgpt-write-test/actions/runs/39810943247/artifacts/12439468539)를 참조.

## R42 동일 커밋 3회 실행: 보수적 OL 기준 대비 개선률

| 실행 | Building A/B | Road A/B | Mixed A/B | 후속 재렌더 |
|---|---|---|---|---|
| Attempt 1 | 56.812% / 56.864% | 55.236% / 53.510% | 60.498% / 61.452% | 30/30 exact |
| Attempt 2 | 58.735% / 59.173% | 51.804% / 53.434% | 57.319% / 58.246% | 30/30 exact |
| Attempt 3 | 56.190% / 56.903% | 53.054% / 52.262% | 52.465% / 56.609% | 30/30 exact |

**R43** 같은 구조에서 Building 56.452%/55.948%, Road 52.494%/60.998%, Mixed 59.860%/58.601%, Worker 후속 재렌더 exact 30/30, 팬·줌·회전·복합 변환 후 exact 120/120.

## 반영 범위 / 안전 게이트

- 모든 코드는 위 **실험 브랜치의 opt-in 테스트 패치와 workflow**에 존재. 기존 R35 ZIP은 SHA-256 고정/읽기 전용으로 복제 후 패치하며, `main`이나 기본 렌더 동작을 변경하지 않음.
- R37 중복 소스 공유 파싱은 `allowDuplicateLayers` opt-in, 브라우저에서 `r37DuplicateDecode=1`일 때만 사용.
- R38 이후 첫 화면 전략은 `workerPool=deferred` opt-in. R41/42는 이 경로에서만 no-copy/경량 MVT 파서를 사용.
- **원래 R35 릴리스 기준**(처음부터 Worker가 직접 인코딩하는 cold-start 포함 ≥50% 단축)은 여전히 FAIL. 대안 첫 화면 측정과 혼동 금지.
- 아직 미검증: DPR2, 실제 터치/마우스 사용자 동작, 장시간 메모리/Worker 장애 및 종료, 타일 재요청/취소, 다중 독립 원천 MVT, 수십 레이어의 실제 production 스타일.
- R43 팬·줌·회전은 고정 타일 장면의 `frame.viewState` 변경 후 CPU/Worker GPU 출력 비교이며, 전체 실제 지도 상호작용 E2E 테스트는 아님.

## 다음 변경 이전 결정 기준

1. 제품 요구가 반드시 '첫 프레임에 Worker를 사용하고 그 시작 비용을 포함'이라면 현재 NO-GO; 실제 2W 초기화 85–115ms를 Road의 50% 예산 안에 넣는 다른 Worker bootstrap 아키텍처가 요구된다.
2. 목표가 사용자가 보는 **first-render frame** 50% 단축이라면 R42/R43의 opt-in 첫 CPU 렌더→Worker 후속 렌더 방식은 강력한 후보. 단 위 미검증 조건을 추가 PASS하기 전에는 기본 ON/merge 불가.
3. 릴리스 게이트를 바꾸거나 측정 구간의 Worker startup을 임의로 제외하면서 기존 R35 인수 합격이라고 주장하면 안 된다.
