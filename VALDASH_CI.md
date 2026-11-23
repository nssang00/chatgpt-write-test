# VAL DASH — Windows/React/OAuth Mock 검증

본 저장소의 다른 C++ 프로젝트와 충돌하지 않도록 VAL DASH는 **압축된 독립 소스 번들**(`valdash-local-source.tar.xz`)로 격리됩니다.

- GitHub Actions: `.github/workflows/valdash-local.yml`
- Windows: 번들 압축 해제, `install.bat`, Python 백엔드 테스트, `run.bat` 실행 및 로컬 API 보안 체크
- Ubuntu: React/TypeScript 프로덕션 빌드 및 standalone JS 문법 검사
- OAuth 통합 테스트는 `httpx.MockTransport`를 이용하며 Riot API에 요청하지 않습니다.
- 공식 Riot RSO는 **승인된 앱 자격증명, 라이엇에 등록된 콜백, 실사용자의 브라우저 로그인**이 모두 있어야 동작합니다.
- 현재 게임 데이터(상점, 제재, VP, 랭크, 아이템)는 로그인 여부와 무관하게 가상입니다.

로컬에서 소스를 풀려면:

```bash
mkdir valdash-local
tar -xf valdash-local-source.tar.xz -C valdash-local
```

Windows에서는 `valdash-local\install.bat`, `valdash-local\run.bat`을 순서대로 실행합니다.

## GitHub Actions Secrets / Variables

평상시 CI 테스트에는 **어떤 Riot Secrets도 필요하지 않습니다.** 로그인 검증은 가짜 OAuth 응답으로 진행합니다.

승인된 RSO 앱에 대한 환경설정 존재 여부만 수동 확인하려면 Actions Variables에 `RIOT_RSO_APPROVED=true`, `RIOT_RSO_CLIENT_ID`, `RIOT_RSO_REDIRECT_URI`를, Actions Secrets에 `RIOT_RSO_CLIENT_SECRET`(앱 비밀키)을 넣고 워크플로를 수동 실행합니다. 이 선택적 단계는 실제 Riot 계정 로그인을 수행하지 않습니다.

**실사용자 Riot ID, 비밀번호, 2FA 코드, 쿠키, 토큰을 Secrets에 넣지 마세요.** 개인용 비공개 VALORANT 앱 및 개인 상점 조회는 라이엇 공식 승인 대상이 아닙니다.
