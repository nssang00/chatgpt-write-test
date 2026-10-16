# Xytron JS ↔ Native 브릿지 지연시간: 첫 실브라우저 스모크

측정일: 2026-10-16. 대상 커밋: `3c45b72c80c49c696a324f0110718af8f211018d`.
**표본은 각 독립 GitHub-hosted Runner의 1회 실행**이다.
Release 빌드, warm-up 20, 작은 요청 100회, 64KiB 40회(워밍업 10회).
값 단위: **ms**, 각 칸은 **p50 / p95**.
정식 반복 성능 기준선, 속도 보증 또는 동일 하드웨어 엔진 대조 결과가 아니다.

| 환경 | Tiny `xytron.math.add()` RTT | `postMessage`+ack RTT | Binary 1KiB RTT | Binary 64KiB RTT |
| --- | ---: | ---: | ---: | ---: |
| Windows WebView2 | 0.200 / 0.305 | 0.200 / 0.205 | 0.800 / 0.900 | 36.500 / 37.230 |
| Windows CEF | 0.300 / 0.400 | 0.200 / 0.300 | 0.300 / 0.400 | 0.600 / 0.700 |
| Linux CEF | 0.250 / 0.400 | 0.200 / 0.300 | 0.300 / 0.400 | 0.700 / 0.800 |
| macOS WKWebView ARM64 | 0.000† / 1.000 | 0.000† / 1.000 | 1.000 / 3.000 | 27.500 / 35.100 |
| macOS WKWebView Intel | 1.000 / 5.100 | 1.000 / 1.000 | 2.000 / 3.000 | 58.000 / 79.300 |

† macOS WKWebView 두 Runner에서 `performance.now()`의 최소 관찰
tick은 **1ms**였다. 0.000ms 표본은 0 지연이 아니라 **시계 해상도
내에서 구분하지 못한 측정값**이다. Windows CEF/WebView2의 최소 관찰
tick은 0.1ms였다. 원본 JSON의 `clock_resolution_ms`와
`quantized_zero_fraction`을 반드시 함께 확인해야 한다.

증거(각 job의 `xytron-bridge-latency-*` artifact):
- [Windows CEF + WebView2, Linux CEF](https://github.com/nssang00/chatgpt-write-test/actions/runs/38846688020)
- [macOS WKWebView ARM64 + Intel](https://github.com/nssang00/chatgpt-write-test/actions/runs/38846688063)

**확인된 사실:** 각 브라우저의 공통 공개 JS API에서 측정값과 결과
아티팩트를 생성했다. 64KiB 바이너리의 Windows WebView2 결과가
Windows CEF보다 현저히 크게 나타났다. WebView2에는 현재
`__nativeweb_binary` JSON 숫자 배열 인코딩이 남아 있으므로
바이너리 framing/IPC 최적화가 우선적 실험 후보이다.

**확정되지 않은 해석:** 별도 runner이므로 두 Windows 엔진의 동일
하드웨어 대조 값은 아니다. 인코딩/IPC/디코딩 시간의 정확한 기여도,
풀 baseline(1,000 warm-up / 5,000회 × 5세션), 단방향 편도시간,
Native→JS 반복 `execute` LAT-03, Python/C# worker 비용, 1MiB 이상
바이너리, 장기 p99 SLA는 **미측정**이다. CEF의 0B
`ArrayBuffer` ↔ `Binary` 변환은 첫 CI에서 `RefAnyCast` 실패가
확인돼 별도 기능 결함으로 추적하며 숫자에 포함하지 않았다.

**다음 우선순위:** 동일 Windows Runner에서 CEF↔WebView2 쌍비교,
WebView2 JSON 인코딩/IPC 분리 측정, batch 기반 짧은 RTT 보정,
Native→JS LAT-03 추가, 빈 버퍼 타입 수정 후 회귀, 반복 기준선 구축.

측정 코드:
[`tests/integration/cef/bridge_benchmark.html`](../tests/integration/cef/bridge_benchmark.html) ·
[`tools/run_bridge_benchmark.py`](../tools/run_bridge_benchmark.py).
