# Unity WebView 58.6.0 — 단일 압축 해제 · 바로 실행

**사용 방법: 압축 해제 → 생성된 폴더 열기 → Run-Dual.cmd 더블클릭.**

더 이상 패치 ZIP, 파일 덮어쓰기, 수동 CEF stage 복사가 필요하지 않습니다.
기존 검증된 CEF v58.4.4 \`oneclick_bundle\` 폴더는 **그대로** 재사용하며 수정하지 않습니다.

예시:

\`\`\`text
Downloads/
├── oneclick_bundle/                 ← 예전 CEF 폴더 그대로
│   ├── Package/com.company.webview/ ← 예전 CEF Unity 소스
│   └── Build/cef-native/stage/      ← 예전 CEF 네이티브 런타임
└── CompanyWebView-Dual-OneClick/
    ├── Run-Dual.cmd                 ← 이 파일만 실행
    ├── Run-Dual.ps1
    ├── SHA256SUMS.txt
    ├── DualPlayer/                  ← 자동검사 도구 및 Unity 씬 빌더
    ├── Runtime/                     ← CEF/WebView2 공통 Unity C# API
    └── Plugins/x86_64/CompanyWebView2UnifiedPreview.dll
\`\`\`

기존 \`oneclick_bundle\`가 Downloads 하위의 다른 폴더에 있어도 제한된 범위에서 자동 탐색합니다.
원하는 경우 \`Run-Dual.cmd -CefRuntimeDir "D:\기존\oneclick_bundle"\`로 전체 기존 폴더를 지정할 수 있지만 통상 필요하지 않습니다.

**중요 조건:** 기존 폴더에 **소스** \`Package/com.company.webview\`와 **실제 빌드된** \`Build/cef-native/stage\`가 모두 있어야 추가 빌드 없이 시작됩니다.
이 ZIP 자체에는 대용량 \`libcef.dll\`이 들어 있지 않습니다. 기존 CEF가 소스만 남아 있거나 현재 PC에 유효한 stage가 없다면 별도 CEF v58.4.4 네이티브 빌드가 필요합니다. 새 CEF 버전으로 조용히 변경하지 않습니다.

자동화: Unity 2022.3.62f3 Windows D3D11 빌드 및 Dual Texture/Overlay 실행 시도, 자동 CEF GPU RawImage 판정, WebView2 메시지 한글 문자열 검사, OS 기준 Player 창 PNG 3장 및 자동 창 크기 변경, 정상 종료와 보고 ZIP 수집.

**중요 검증 경계:** GitHub Windows CI에서는 이 ZIP 패키징/Windows 네이티브 빌드/PowerShell 코드 검사를 수행하며, 실제 Windows Unity Player/Cef GPU 동시 실행은 수행하지 못합니다. 실행 결과는 \`results\dual-날짜.zip\`로 보냅니다.
사용자가 직접 해야 하는 것은 실제 한글 IME 후보창 표시 등 육안 확인뿐입니다. 자동화용 브라우저 페이지에는 비밀번호·개인정보를 입력하지 마세요.

문제가 생기면 생성된 \`results\dual-날짜.zip\` 파일 하나를 업로드하세요. 브라우저 프로필과 원시 전체 로그는 제출 ZIP에서 제외됩니다.
