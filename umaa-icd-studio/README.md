# UMAA ICD Studio — MVP

UMAA 스타일의 서비스/Topic/데이터 타입 라이브러리를 바탕으로 **프로젝트별 ICD 초안**을 작성하는 React + Ant Design 웹 애플리케이션입니다. 샘플은 일반 센서 상태/환경 보고용으로 직접 작성한 예제이며 공식 UMAA 정의가 아닙니다. UMAA 표준 문서 생성기나 적합성 인증 도구가 아닙니다.

## 실행

Node.js 20.19+ 또는 22 권장. npm 레지스트리에 접근 가능한 환경에서:

```bash
npm install
npm run dev
```

Vite 출력의 URL(기본 `http://localhost:5173`)을 열면 됩니다.

```bash
npm test        # Node 내장 테스트, 의존성 설치 없이도 실행 가능
npm run build   # dist/ 생성
npm run preview # 빌드 결과 로컬 확인
```

제공 환경에서 npm registry DNS 연결이 차단되어 실제 npm install/브라우저 빌드는 수행하지 못했습니다. JSX 구문 검사 및 Node 핵심 로직 테스트는 통과했습니다.

## 사용 흐름

1. 최초 실행 시 demo 라이브러리와 1개 인터페이스가 표시됩니다.
2. 좌측 서비스 트리에서 Topic을 체크해 선택합니다. 선택을 해제하면 해당 프로젝트 바인딩이 제거됩니다.
3. 상단 구성요소 관리에서 컴포넌트 목록을 편집합니다.
4. 가운데 Interface Matrix의 행을 선택하고 우측에서 Publisher/Subscriber, QoS, 주기, 비고를 입력합니다. 라이브러리 원본은 변경되지 않습니다.
5. Data Dictionary 탭에서 참조되는 하위 타입까지 확인합니다. Document 탭에서 문서 번호/개정/작성자/범위/Domain ID를 설정합니다.
6. 검증 결과 및 ICD 미리보기에서 초안을 확인하고 Markdown/CSV/Project JSON으로 내보냅니다. 경고나 오류가 있는 경우 초안 내보내기 확인이 필요합니다.
7. 프로젝트는 브라우저 localStorage에 자동 저장됩니다. JSON을 백업하거나 가져오기 기능을 통해 다른 브라우저로 이동할 수 있습니다.

## 라이브러리 JSON 계약

`examples/demo-library.json` 참고. `name`, `version`, `source`, `services`, `types` 필수. 서비스의 `id`, `area`, `name`, `pattern`, `topics` 및 Topic의 `id`, `name`, `type`, `role` 필수. 서비스 ID/Topic ID/타입명은 각각 유일해야 합니다. 데이터 타입의 `name`은 완전 한정 이름, `fields`는 `{name,type,key?,unit?,description?}` 배열입니다. 필드 타입은 기본 IDL 타입, 한정 타입명, `sequence<T[,N]>`, `T[N]`, `string<N>` 등의 정규화된 표현을 지원합니다. 복잡한 IDL 문법 전체를 지원하는 것은 아닙니다. `source`에 배포 버전, 원본 파일 경로 등 출처를 기록하세요.

실제 공식 UMAA 패키지는 원본 서비스 정의/IDL을 위 계약으로 변환하는 별도 adapter가 필요합니다. IDL만으로 서비스 분류, 역할, 동작 계약, 필수 인터페이스 등을 모두 유추하지 않습니다. 라이브러리 가져오기 시 기존 선택이 초기화됩니다. 프로젝트 JSON은 라이브러리 스냅샷을 포함합니다.

## 구성 및 범위

- `src/main.jsx`: React/Ant Design 화면 및 상태, 파일 I/O
- `src/core.mjs`: JSON 형식 확인, 참조 탐색, 로컬 검증, 문서 생성
- `src/demo.mjs`: 독립 샘플 라이브러리
- `src/core.test.mjs`: Node test
- `examples/`: 라이브러리, 프로젝트 및 생성 결과 예제

MVP 제한: 단일 Topic별 Publisher/Subscriber 한 쌍, 단일 프로젝트 Domain ID(0~232 범위는 MVP 정책), 제한된 QoS 메타데이터, 브라우저 저장만 지원. 공식 UMAA 필수 역할/서비스 패턴 검증, DDS QoS 호환성 검증, IDL 파싱/컴파일, 인증, 변경 이력, DOCX/PDF 출력은 구현 범위 밖입니다. 실제 민감 데이터는 공유 브라우저 localStorage에 저장하지 마세요. 서버나 외부 API에 업로드하는 코드는 없습니다.

## 참고 자료

- https://www.auvsi.org/advocacy/advocacy-initiatives/unmanned-maritime-autonomy-architecture/
- https://github.com/rticommunity/rticonnextdds-usecases-umaa
- https://www.rti.com/developers/case-code/umaa
