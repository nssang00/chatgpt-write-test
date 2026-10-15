# CompanyWebView v58.6.0 - one zip, nested oneclick_bundle

**사용법: 영문 ZIP 1개 압축 해제 -> 새로 생긴 폴더에서 Run-Dual.cmd 실행.**

파일과 폴더 이름은 모두 영문입니다. 원래의 검증된 oneclick_bundle은 절대로 덮어쓰지 않습니다.

```text
Downloads/
├── oneclick_bundle/                      <-- 기존 CEF v58.4.4 검증본 (변경 금지)
│   ├── Package/com.company.webview/Runtime/
│   └── Build/cef-native/stage/
└── CompanyWebView_v58_6_0/              <-- 새 ZIP을 풀어서 생성된 영문 폴더
    ├── Run-Dual.cmd                     <-- 이것만 더블클릭
    └── oneclick_bundle/                 <-- ZIP에 미리 포함된 새 폴더
        ├── Run-Dual.cmd
        ├── Run-Dual.ps1
        ├── Runtime/                      <-- 공통 Unity API
        ├── DualPlayer/                   <-- Unity 빌드/검증/스크린샷
        ├── Plugins/x86_64/              <-- WebView2 x64 DLL
        ├── Package/com.company.webview/  <-- 최초 실행 때 기존 CEF Runtime만 자동 복사
        ├── Build/cef-native/stage/       <-- 최초 실행 때 기존 검증 CEF native 자동 복사
        └── results/                      <-- 실행 후 결과 JSON/PNG ZIP
```

새 ZIP 내부에 `oneclick_bundle` **폴더 구조는 미리 만들어 두었습니다.** 대용량 CEF libcef.dll과 소스는 이전에 검증된 폴더에서 최초 실행 시 새 하위 폴더로 복사합니다. 현재 ZIP 자체에 대용량 CEF 런타임은 내장돼 있지 않습니다. 외부 폴더를 사용자에게 선택시키지 않고 자동 검색하되, 이전 런타임이 없다면 환경에 따라 빌드 단계가 필요합니다.

**이번 오류 수정:** `Documentation~` 및 긴 감사 문서 경로는 Unity 프로젝트로 복사하지 않습니다. 검증된 `Package/com.company.webview/Runtime` 디렉터리만 사용합니다. Unity 임시 프로젝트와 Player 출력은 `%LOCALAPPDATA%\\CWV58`의 짧은 경로에서 만듭니다.

자동 검증: CEF Texture RawImage 프레임, WebView2 메시지 및 한글 문자열 왕복, 창 축소/복구, 스크린샷 3장, 종료와 결과 ZIP. **실제 Unity Player에서 모든 동작을 통과했는지 여부는 사용자 Windows 실기 결과로만 판정**합니다.

테스트 결과는 새 폴더 내부 `oneclick_bundle/results/dual-날짜.zip`만 업로드하세요. 사용자가 직접 확인할 것은 실제 한국어 IME 후보창 등 자동 판정하기 어려운 화면 품질입니다.
