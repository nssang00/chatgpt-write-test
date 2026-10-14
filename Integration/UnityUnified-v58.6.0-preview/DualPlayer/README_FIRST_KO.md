# v58.6.0 CEF Texture + WebView2 Overlay: Windows 통합 실기 테스트

**실험용 / 정식 제품 아님.** 기존 v58.4.4 CEF 내부 기준선과 v58.5.2 WebView2 검증본은 변경하지 않습니다.

## 테스트 목표

Unity 2022.3.62f3 Windows D3D11 Player **하나**에서:
- **왼쪽**: CEF 58.4.4 공유 D3D11 Texture → Unity RawImage
- **오른쪽**: WebView2 별도 x64 DLL → Win32 자식 HWND
- 자동 검사: CEF 가속 프레임/실제 RawImage 연결, WebView2 C# 메시지 수신, 양쪽 정상 종료

## PC 준비

- Windows x64, Unity **2022.3.62f3**, Windows Build Support(Mono), Unity 라이선스.
- 기존에 테스트한 CEF 58.4.4 **빌드된 런타임 폴더**. 원래 OneClick의 \`Build\cef-native\stage\`에는 \`native\Release\CompanyWebViewCefTextureProbe.dll\`과 \`runtime\Release\libcef.dll\` 등이 있습니다. 또는 기존 정상 실행 CEF Player의 \`CompanyWebViewCefProbe_Data\Plugins\x86_64\` 폴더를 사용하세요.
- 여유 디스크 10GB 이상 권장. 별도 CEF 58.4.4 소스 스냅샷과 Windows CI에서 빌드한 새로운 WebView2 DLL은 ZIP에 포함됩니다.

## 실행 (CMD 창)

새 폴더에 ZIP을 압축 해제한 후:

\`\`\`bat
Run-Dual.cmd -CefRuntimeDir "D:\old-oneclick\Build\cef-native\stage"
\`\`\`

또는:

\`\`\`bat
Run-Dual.cmd -CefRuntimeDir "D:\CEF-Player\CompanyWebViewCefProbe_Data\Plugins\x86_64"
\`\`\`

Unity 설치 경로가 다르면 \`-UnityExe "C:\path\Unity.exe"\`. 실행 시간을 늘리려면 \`-AutoSeconds 180\`. 소스 해시만 확인하려면 \`Run-Dual.cmd -SelfTest\`.

**주의:** 이 테스트는 처음 실행할 때 새 Unity 프로젝트를 임시 빌드합니다. Unity Player가 열린 동안 우측 WebView2와 좌측 CEF Texture가 동시에 표시되는지 확인하세요. 자동 종료 전 X 버튼으로 닫지 마세요.

## 사용자가 확인할 항목

| 항목 | 통과 확인 |
|---|---|
| D01 | 왼쪽 CEF Texture 프레임이 Unity RawImage 안에 보이는가? |
| D02 | 오른쪽 WebView2 HWND가 동시에 보이고 마우스 클릭이 되는가? |
| D03 | Unity 창 바깥 모서리를 드래그했을 때 양쪽 영역이 어긋나지 않는가? |
| D04 | WebView2 JS → C# 메시지가 동작하는가? (자동 로그 메시지 수신) |
| D05 | 각 방식의 한글 입력, 포커스, IME 후보창이 올바른가? **두 경로 별도 확인 필요** |
| D06 | Player가 자동 종료되고 WebView2 STA joined와 CEF shutdown이 보고되는가? |

이 테스트는 단일 입력칸 자동 생성 기능이 없으며, CEF의 **완전한 한글 IME 조합·후보창은 기존에도 미해결 항목**입니다. 두 엔진을 한 번에 켰다는 사실만으로 제품 검증 PASS가 아닙니다.

## 결과 제출

\`results\dual-날짜.zip\` **하나**와 민감정보를 가린 화면 캡처 2~3장을 업로드하세요. ZIP에는 JSON과 Unity 로그만 저장합니다. \`results\dual-날짜\UnityProject\` 및 Player 폴더는 CEF DLL/웹 프로필 등 환경 정보를 포함할 수 있으므로 업로드하지 마세요.

\`summary.json\`의 \`PENDING_MANUAL\`은 자동 검사 통과이되 수동 화면 검증이 남았다는 뜻입니다. CI는 Unity 라이선스와 GPU 실기 시험을 실행하지 못하므로 이 최초 통합 테스트는 **Windows 사용자 실행 전까지 미검증**입니다.
