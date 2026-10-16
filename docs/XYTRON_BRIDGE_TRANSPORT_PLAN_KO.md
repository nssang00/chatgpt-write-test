# Xytron 브릿지·리소스 통합 구현 계획 (2026-10-16)

상태: 합의된 제품 방향 + 단계별 구현 계획. 완료 체크는 구현/실제 브라우저 검증이 확인된 것만 표시한다.
개발 브랜치: nativeweb/autonomous-integration, PR #7 (draft, main 미병합).

## 공개 API (CEF / WebView2 동일, C++ / Python / C# 백엔드 동일)

- 대표 JS 함수 호출: `await xytron.math.add(1, 2)`.
  `xytron.invoke("math.add", 1, 2)`는 호환/동적 호출용 원시 API.
- 단방향: JS `xytron.postMessage(channel, data)`,
  `xytron.onMessage(channel, callback)` / `offMessage(id)`.
  C++ `WebView::postMessage/onMessage/offMessage`.
- Native `Binary` (`ByteArray` 동일 타입) -> JS `ArrayBuffer`.
  `std::vector<std::string>`은 byte buffer 아님. Python bytes와 C# byte[] 매핑은 별도 개발.
- 큰 파일: Plugin Resource Provider가 유효기간·권한 검증된 URL을 제공하고,
  JS는 표준 `fetch(url)` / Response.body / Blob으로 소비.
- 반복 갱신되는 큰 데이터: 명시적인 shared-buffer API, 소유권/해제 계약.
- 플러그인/모듈이 주 확장 단위. 임의 custom scheme은 고급 선택 기능.

## 작업 순서

1. **P0 보안 유지 + 단방향 브릿지 baseline**
   - [x] C++ Core EventDispatcher 재사용; JS ↔ Native postMessage/onMessage 연결.
   - [x] CEF/ WebView2 진짜 브라우저 E2E에 메시지/ArrayBuffer 검증 추가.
   - [ ] 브라우저 CI 통과 확인 및 문서/구현 실제 상태 동기화.
   - [x] 단방향 event에 stale session token 재전송 방어 브라우저 테스트 추가.
   - [x] native 메시지 콜백 예외 격리 및 Core regression 추가.
   - [ ] NW-014: old renderer in-flight IPC/navigation/frame 재사용 경쟁,
     method/event grant 강화. 이벤트에 권한 없는 채널 접근을 허용하지 않을 정책 필요.
2. **P1 기본 바이너리 계약 완성**
   - [x] `Binary`와 `ByteArray` 이름 동일화 (소유형 std::vector<unsigned char>).
   - [ ] CEF typed-array 입력 (Uint8Array/DataView 포함) 변환.
   - [ ] WebView2의 현재 JSON byte-number-array 성능 개선: control envelope + raw binary.
   - [ ] Python/C# worker IPC의 스칼라/64KiB 제약 해소, framing/limit/backpressure,
     bytes/byte[] 왕복·worker crash·cancel 검증.
3. **P1 Plugin Resource Provider + fetch**
   - [ ] core ResourceRouter / 요청/응답/stream/cancel 타입, 등록 해제.
   - [ ] 고정 `app://` 권한 있는 opaque resource URL 구현.
   - [ ] 응답 Content-Type/Range/cache/CORS/CSP와 엔진별 스트리밍 확인.
   - [ ] C++/Python/C# provider, 플러그인 언로드/문서 내비게이션 철회 테스트.
4. **P2 고급 Custom Scheme**
   - [ ] 선언형 manifest + 사전 엔진 등록 (CEF 초기화/WebView2 Environment 생성 전).
   - [ ] `xytron new scheme <name> --module <id>` 템플릿,
     C++/Python/C# `onRequest(request)` 및 에러/취소 테스트 생성.
   - [ ] 첫 실증 예제: `mbtiles://` -> SQLite XYZ/TMS 조회 / PBF MIME.
   - [ ] `serial://` 예제는 재시도·장치 I/O 부작용에 주의, RPC/event 우선.
5. **P2+ 고성능 선택적 공유 버퍼**
   - [ ] CEF 공유 메모리 IPC vs WebView2 SharedBuffer 어댑터.
   - [ ] JS ArrayBuffer 접근 권한, release, navigation/unload 크래시 안전성.
   - [ ] 대용량 throughput·copies·backpressure 벤치마크 후 opt-in.

## 핵심 제약

- 일반 사용자는 엔진 종류를 모른다. 내부 전송 구현은 달라도 API/오류/타입 일치.
- 공유 버퍼나 transfer의 ownership 변화는 데이터 크기만으로 자동 발생시키지 않음.
- Custom Scheme 이름은 엔진 생성 전 선언해야 하며 플러그인 실행 중 새 스킴
  등록은 재시작/기존 resource URL fallback이 필요할 수 있음.
- User-defined scheme/Resource Provider는 파일/포트/DB 전역 권한이 아님.
  문서 세션·프레임·모듈별 grant, URI normalization, SSRF/경로 순회와
  요청 헤더·MIME·CORS 정책, 취소 및 백프레셔를 각각 검증.
- 단방향 postMessage는 송신 성공 확인과 전달 보장을 약속하지 않는다.
- P0 완료 및 릴리스/merge 여부는 별도 검증·사용자 승인 필요.
