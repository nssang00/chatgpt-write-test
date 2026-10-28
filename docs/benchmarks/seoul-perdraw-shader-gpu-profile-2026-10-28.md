# 서울 RTX 5060 Ti — 셰이더 프로그램 및 개별 draw call GPU 프로파일링

검증일: 2026-10-28

## 검증 실행 및 결과 파일

- [성공한 GitHub Actions 실행 #40660357750](https://github.com/nssang00/chatgpt-write-test/actions/runs/40660357750)
- [raw.json, summary.json, 지역별 스크린샷 artifact #12803721112](https://github.com/nssang00/chatgpt-write-test/actions/runs/40660357750/artifacts/12803721112)
- 소스: bench/seoul-perdraw/draw-profiler.js, scene-profile.js, run-perdraw.mjs
- **48/48 장면**, **1,872/1,872 유효 GPU timer queries**. 이 중 144회는 전체 정지 프레임, 1,728회는 개별 draw call.
- RTX 5060 Ti, ANGLE D3D11, Chrome, Windows self-hosted GitHub runner, viewport 1280×720 DPR1.
- 동일한 서울 Planetiler MVT / 18개 원본 source-layer, 스타일 항목 18·64·128개. 18개를 넘는 스타일은 기존 원본 레이어를 중복 참조하는 synthetic overdraw 테스트.
- 서울 4개 지역(강남, 종로, 여의도, 노원) × 3개 스타일 수 × 2 엔진 × 2회.
- OpenLayers 하나의 WebGLVectorTileLayer에 N개 스타일 규칙, MapLibre는 N개 스타일 레이어. MapLibre는 WebGL2, OpenLayers는 WebGL1.

## 셰이더 프로그램 객체와 소스 코드 재사용

| Style entries | ML GPU program objects | ML unique vertex+fragment source pairs | OL GPU program objects | OL unique vertex+fragment source pairs | OL duplicated-source program objects |
|---:|---:|---:|---:|---:|---:|
| 18 | 5 | 5 | 20 | 20 | 0 |
| 64 | 5 | 5 | 66 | 20 | 46 |
| 128 | 5 | 5 | 130 | 20 | 110 |

각 장면의 attachShader → shaderSource 소스를 해싱해 pair-wise 동일성을 비교했다. 동일 소스 조합의 서로 다른 프로그램 객체가 128개 스타일 OpenLayers에 **110개** 존재한다는 것은 재현됐으며, 8개 장면 전부 동일한 수치다.

이 수치는 **WebGL createProgram 객체**와 **실제로 전달한 GLSL 소스의 중복**을 증명한다. **GPU 드라이버가 기계어 셰이더를 130번 독립 컴파일했다는 의미는 아니다.** 드라이버 내부 셰이더 바이너리 캐싱, 기계어 및 stall 발생 여부는 PIX/RenderDoc/native capture가 필요하다.

## 단일 정지 프레임 WebGL draw call 수

| Style entries | ML draw-call count P50 | OL draw-call count P50 |
|---:|---:|---:|
| 18 | 104 | 153 |
| 64 | 341 | 521 |
| 128 | 636 | 1,033 |

두 엔진 **모두 스타일 수 증가에 따라 GPU draw commands가 증가**한다. MapLibre는 모든 스타일을 단일 draw로 합치는 것이 아니다. 다만 같은 서울 타일/스타일 스트레스 환경에서 상대적으로 적은 GL draw calls와 훨씬 적은 프로그램 객체를 유지했다.

## GPU 타이머 쿼리와 측정 가능성

실제 렌더러 GL context에 WebGL GPU time-elapsed query를 열고, 전체 강제 렌더 프레임 또는 스트리밍된 특정 draw 호출 하나만 감쌌다. 실제 GPU_DISJOINT_EXT를 확인하고 QUERY_RESULT_AVAILABLE 이후 비동기 결과를 읽었다. 개별 draw 호출을 무작위에 가까운 층화 방식으로 샘플링했으며, 브라우저 출력 이미지는 생성/검증했다.

타이머 하드웨어/ANGLE 분해능으로 이번 per-draw 쿼리 결과는 32ns 간격으로 양자화됐고 **0ns 표본도 정상적으로 발생**했다. 0ns를 실제 GPU 비용이 없다고 해석하지 말 것.

| Style entries | ML sampled draw GPU time P50 ms | OL sampled draw GPU time P50 ms | ML 0ns proportion | OL 0ns proportion |
|---:|---:|---:|---:|---:|
| 18 | 0.000064 | 0.001056 | 32.29% | 23.96% |
| 64 | 0.000000 | 0.000576 | 50.35% | 21.53% |
| 128 | 0.000032 | 0.000384 | 47.92% | 26.04% |

개별 draw의 0ns가 높은 비율을 차지하며, 개별 GPU timer query 자체가 실행과 동기화에 영향을 줄 수 있다. **이 표는 정확한 ‘셰이더별 GPU 비용’이나 두 엔진의 독립적인 per-draw 효율비를 확정하는 용도로 사용할 수 없다.** 정확한 per-shader GPU 소요시간 분해가 요구된다면 네이티브 GPU 캡처 및 instruction/pipeline profiling 필요.

## 별도로 측정한 계측기 삽입 상태 전체 프레임 시간

기존 비계측 GPU 타이머 실행과 섞지 말 것. 이 실험은 WebGL 객체/호출 method patch, 다른 지역 구성, 소규모 샘플을 사용했다.

| Style entries | ML instrumented whole-frame GPU P50 (ms) | OL instrumented whole-frame GPU P50 (ms) |
|---:|---:|---:|
| 18 | 0.350464 | 2.137984 |
| 64 | 3.631360 | 6.948064 |
| 128 | 4.893440 | 13.136480 |

정확한 production GPU frame timing은 앞선 [비계측 GPU 타이머 640회](https://github.com/nssang00/chatgpt-write-test/actions/runs/40658539240) 결과를 우선 사용할 것.

## Native GPU capture 환경

Windows runner의 PATH에서 renderdoccmd.exe 및 WinPixGpuCapturer.dll을 검사했으나 둘 다 발견되지 않았다. **RenderDoc/PIX 캡처 파일은 생성하지 않았다.** 이번 작업은 WebGL GPU timer-query 기반 호출별 샘플링/셰이더 코드 식별 프로파일링이며, 드라이버 instruction-level shader profiling이 아님.

## 결론

1. **확인:** MapLibre는 스타일 수 증가에도 5개 WebGL program objects / 5개 고유 GLSL 소스 조합을 유지한다. OpenLayers는 N+2 program objects를 생성하며, 128개일 때 110개 객체가 동일 소스 조합을 중복한다.
2. **확인:** 양쪽 모두 draw calls가 증가하지만 OpenLayers가 더 많이 제출했다 (128: 1,033 vs 636).
3. **확인:** 고유 프로그램 코드 수와 인스턴스 수의 차이는 CPU/GL 프로그램 설정 비용의 원인 후보이며, WebGL 호출 수와 GPU 프레임 시간 차이를 설명하는 구조적 단서다.
4. **미확인:** 중복 GLSL program objects가 실제 GPU 기계어 컴파일 시간을 얼마나 늘렸는지, 특정 draw call 또는 shader 종류가 전체 GPU 시간의 몇 %를 차지하는지, 두 엔진의 WebGL1/WebGL2 차이를 제거한 GPU 성능 우열.
