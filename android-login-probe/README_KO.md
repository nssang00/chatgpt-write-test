# VAL DASH Android WebView 로그인 진단 (v0.9)

## 목적
GO VAL 5.9.12 APK의 정적 분석에서 Android WebView 기반 로그인 구성이 확인됨에 따라, **일반 Android WebView에서 Riot 계정 관리 사이트 로그인이 가능한지** 확인하는 시험 앱입니다.

이 프로젝트는 GO VAL 소스코드를 복사하지 않습니다. GO VAL 특유의 User-Agent 사칭, 로그인 유지 체크박스 강제 변경, 세션 쿠키/토큰 추출, OAuth 토큰 수신, 내부 상점 API 호출을 구현하지 않습니다.

**중요한 비교 한계**: GO VAL은 `auth.riotgames.com/authorize` 인증 요청과 `playvalorant.com/opt_in` 완료 리디렉션을 사용했지만, 이 진단 앱은 `https://account.riotgames.com/`만 열어 계정 사이트 로그인 가능 여부를 비교합니다. 이 테스트에 성공해도 GO VAL의 인증 흐름이나 개인 상점 조회를 재현했다는 뜻이 아닙니다.

## GitHub Actions로 APK 빌드
1. 저장소의 Pull Request 또는 브랜치 Actions에서 `VAL DASH Android Login Probe APK` 실행을 확인합니다.
2. 빌드 성공 시 Actions 실행 페이지의 **Artifacts**에서 `valdash-android-login-probe-debug-apk` ZIP을 내려받습니다.
3. ZIP 안의 `app-debug.apk`를 Android 기기에 설치합니다. 디버그 서명 APK이며 Play Store에 게시할 배포본이 아닙니다.
4. 앱을 실행해 `공식 Riot 계정 페이지 열기`를 누르고 ID/비밀번호를 **Riot가 제공하는 웹 페이지에서 직접** 입력합니다.
5. 로그인 결과를 화면으로 직접 확인하고 `로그인 성공 표시` 또는 `로그인 실패 표시`를 눌러 기록합니다.
6. `진단 JSON 복사` 버튼으로 결과를 복사해 ChatGPT에 붙여넣습니다.

## 진단 제한 / 개인정보
- 진단에는 이벤트 단계, **라이엇 도메인 호스트명**, 메인 프레임 HTTP 오류 코드, 네트워크 오류 코드와 사용자가 직접 표시한 결과만 포함됩니다.
- **비밀번호, 쿠키값, access token, ID token, 응답 본문, 전체 URL 경로·파라미터·fragment, HTML/폼 입력값은 조회·저장·전송하지 않습니다.**
- 제3자 쿠키는 기본 차단 상태이며 토글로 시험할 수 있습니다.
- `앱 로그인 데이터 초기화`는 이 앱 WebView의 저장 데이터만 지웁니다. GO VAL 및 Chrome 로그인은 건드리지 않습니다.
- Github Actions Secrets에 Riot 계정 정보를 등록할 필요가 없습니다. GitHub Actions는 앱을 빌드할 뿐 인증을 실행하지 않습니다.
- 로그인 성공 여부는 앱이 자동으로 판정하지 않습니다. 사용자의 수동 표시와 네트워크 단계만 확인합니다.

## 빌드 환경
- GitHub Actions: ubuntu-latest, JDK 17, Android SDK 35, Gradle 8.11.1, Android Gradle Plugin 8.9.2
- Kotlin 2.1.20
- 별도의 .NET SDK 불필요
- 디버그 APK; 배포용 서명키 없음

## 다음 단계
Android WebView 결과와 GO VAL의 성공 여부를 같은 기기에서 비교합니다. 이 계정 관리 페이지 실험은 첫 단계일 뿐이며, 공식 OAuth 권한 및 게임 상점 API 이용 가능 여부는 별도 사안입니다.

## v1.0 추가 기능 (공개 스킨 도감 / 수동 선택)
- 첫 화면에서 **공개 스킨 도감 / 내 수동 목록**을 선택하면 `valorant-api.com` 공개 데이터의 스킨 이름·이미지를 조회합니다.
- 스킨 검색과 기기에만 저장하는 수동 선택 목록을 지원합니다.
- 이것은 **사용자의 실제 오늘의 상점 정보가 아닙니다.** 개인별 상점 오퍼·VP 가격·갱신 시간은 확보되지 않았고 화면에 표시하지 않습니다.
- Riot 계정 로그인 쿠키나 토큰을 추출하거나 공유하지 않습니다. 외부 스킨 도감에 인증 정보를 보내지 않습니다.
- GitHub Actions 빌드 아티팩트: `valdash-android-skin-catalog-debug-apk`.
