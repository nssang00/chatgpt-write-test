# Windows 실기: WebView2 IME / DPI / Alt+Tab / Z-order

**이번 것은 실기 검증 모드입니다. Windows UI의 DPI 설정을 스크립트가 바꾸지 않으며, 자동 PASS로 한글 후보창과 Z-order를 증명하지 않습니다.** 기존 CEF v58.4.4와 WebView2 v58.5.2의 네이티브 바이너리는 변경하지 않습니다.

## 실행

새 ZIP을 영문 짧은 경로에 한 번만 압축 해제합니다. 일반 자동 테스트는 `Run-Dual.cmd`, 수동 호환성 검증은 **최상위 `Run-Manual-Compatibility.cmd`**입니다. 수동 모드는 Unity Player를 300초(5분) 동안 실행하며, 진행 중에는 다른 창을 테스트하므로 자동 스크린샷 촬영을 **비활성화**합니다. UI와 종료 결과에는 입력한 문자열 자체를 저장하지 않습니다. 시간이 끝날 때까지 Player를 열어 두세요.

오른쪽 WebView2 화면의 `WebView2 HWND / Windows Compatibility` 입력란에 **실제 키보드 한글 IME로** `한글 가나다 abc123` 등을 입력합니다. 한글 조합 중 후보창 위치, 글자 중복/누락, 커서 위치, 포커스 및 Enter 확정을 직접 확인합니다. **스크립트로 주입한 한글 메시지가 IME 검증을 대신하지 않습니다.** PASS/FAIL 버튼은 사용자가 직접 내린 판정을 기록할 뿐입니다.

**DPI:** Windows 설정의 실제 배율을 확인하고, 각 배율(100%, 125%, 150%)에서 테스트하세요. 다른 모니터나 배율이 없는 경우 해당 항목은 NOT_TESTED로 남기세요. 배율 변경마다 별도 실행해도 됩니다. 각 실기 세션에서 Unity 창 이동·크기 변경·복원 후 WebView2 영역이 우측 패널과 일치하는지 확인하고 해당 배율 버튼으로 판정합니다.

**Alt+Tab / Z-order:** Unity에서 다른 앱으로 Alt+Tab, Unity로 복귀, 최소화·복원, 겹쳐진 외부 창의 앞뒤 순서를 확인합니다. WebView2가 Unity가 아닌 다른 앱 위에 남으면 FAIL로 기록하세요. 어떤 외부 앱도 스크린샷으로 저장하지 않습니다.

## 결과와 한계

각 세션 종료 후 `oneclick_bundle/results/dual-날짜.zip`을 공유합니다. `summary.json` 안의 `manualObserved`와 `player-runtime-evidence.json`에 다음 **메타데이터만** 있습니다: trusted DOM composition 시작/종료 횟수, trusted input 이벤트(스로틀링) 수, 수동 PASS/FAIL, Windows에서 측정한 현재 DPI 범위, HWND 자식 창 위치 편차, 포커스 손실·복구, 최소화·복원 횟수. 웹 입력 문자열과 후보 목록·키 이벤트 원문은 저장하지 않습니다.

자동 `PASS_AUTO`는 이전 CEF Texture/웹 메시지/종료 검증이며, IME·DPI·Z-order PASS가 아닙니다. 단일 모니터/배율 테스트로 세 가지 배율 전부를 통과했다고 처리하지 않습니다. 시스템 배율과 창 가림 판정은 사용자의 육안 확인이 필수입니다.
