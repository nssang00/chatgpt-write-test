# 공통 OSM import 구현 및 실데이터 검증

## 구조

`run.bat both` → `--format both` → `LocalDatabase.import_shared_extract()` → **단일** `osm2pgsql -O flex` 프로세스. 공통 Lua 스타일은 OSM Carto v6 및 상세 Vector flex의 등록/객체 콜백을 각각 보존한 후 `process_node`, `process_way`, `process_relation`에서 두 콜백을 호출한다. 한 번의 OSM PBF 파싱과 한 번의 slim middle 구축으로 양쪽 PostGIS 테이블을 만든다. 이후 OSM Carto SQL 3개와 상세 Vector 후처리 SQL을 실행하고 같은 데이터베이스로 PNG/Vector MBTiles를 생성한다.

입력/스타일/벡터 정의/프로필 해시 기반 캐시를 관리하며, 순수 PNG/Vector 전용 모드는 기존 import 경로를 유지한다. 기본 import 프로필 `safe`는 제한된 WSL2 메모리를 고려한 보수적 설정이다. `fast`는 4개 처리기 및 병렬 인덱스 사용, Vector 테이블에서 CLUSTER를 생략하므로 자원이 충분한 머신에서만 명시적으로 사용한다.

## 확인된 실데이터 검증

- 2026-10-28: [서울 분리/공통 import 검증](https://github.com/nssang00/chatgpt-write-test/actions/runs/40661385812), 성공. 동일한 서울 PBF(22,454,346바이트)를 바탕으로 Carto/Vector DB 테이블 **9개 전체 행 값**과 MVT **58개 타일, 218,138 피처**의 기하·속성·중복 개수를 비교했다. 차이 0건. 별도 osm2pgsql 2회 24.57초, 공통 import + 후처리 20.21초. **두 측정의 SQL 후처리 포함 범위가 달라 정밀 속도 결론에는 아래 공정 비교를 사용해야 함**.
- 2026-10-28: [Monaco Carto 실영상 및 MVT 검증](https://github.com/nssang00/chatgpt-write-test/actions/runs/40661032099). 데이터 처리 자체는 성공: Carto+Vector DB 테이블 9개 동등, MVT 44타일/30,083피처 동일, 실제 Mapnik OSM Carto PNG 4타일의 디코딩 픽셀 동일. 이후 CI 환경에 `python3-pytest`를 설치하도록 수정했고, [전체 검증 성공 실행 #40662128800](https://github.com/nssang00/chatgpt-write-test/actions/runs/40662128800)에서 같은 9테이블·MVT 44타일/30,083피처·PNG 4타일 전부 동일하며 Python 회귀 테스트도 통과했다.
- 단위 테스트: 로컬 70개 통과 (`python -m pytest -q tests`).

## 서울 동일 입력 재측정 (실측)

[GitHub Actions 성공 실행 #40662063506](https://github.com/nssang00/chatgpt-write-test/actions/runs/40662063506): 소스 서울 PBF 22,454,346바이트, 줌 12~15, 동일 bounding box. 아래 세 import 숫자에는 OSM PBF를 읽어 PostGIS로 옮기는 시간과 Carto/Vector SQL 후처리가 모두 포함된다.

| Import 방식 | 총 초 | 분리 대비 개선 | 데이터 동일성 |
|---|---:|---:|---|
| Carto 1회 + Vector 1회 | 30.66 | 기준 | 기준 |
| 공통 1회 (`safe`) | 24.40 | 20.4% 단축 | Carto/Vector 9테이블 및 58 MVT 타일 동일 |
| 공통 1회 (`fast`) | 20.34 | 33.7% 단축 | Carto/Vector 9테이블 및 58 MVT 타일 동일 |

비교 참고: 같은 GitHub Actions 실행에서 **Planetiler v0.10.2 벡터 전용 생성 10.51초**, 58개 타일, 188,201개 피처, 18개 데이터 레이어를 확인했다. 우리 PostGIS MVT에는 218,138개 피처가 있었다. Planetiler 프로파일은 비슷하게 맞춘 커스텀 YAML이며, SQL 객체 필터·속성·일반화가 완전히 같지 않아 동일 작업량 벤치마크가 아니다. 공통 Import 시간에는 Planetiler에서 만들지 않는 **OSM Carto PNG용 데이터 적재**까지 포함된다. PNG 렌더링 시간은 위의 import 시간에 포함되지 않으며, MVT 파일 인코딩 또한 위 import 항목에는 포함되지 않는다. 따라서 이 수치를 PNG+Vector 전체 생성 시간이나 동등출력 성능 순위로 바꾸어 표현하면 안 된다.

## 벤치마크 주의

Planetiler는 PBF → MVT를 생성하는 별도 엔진으로, PNG를 만들지 않는다. 따라서 합리적 비교 지표는 (1) PNG+Vector 공통 import 절약, (2) 분리 PostGIS 방식과 같은 입력·출력 데이터의 총 처리 시간, (3) Planetiler **벡터 전용** 생성 시간 및 벡터 스키마·피처 차이이다. 완전히 동일한 MVT 내용이 아닌 Planetiler 커스텀 YAML 프로파일의 수치는 성능 방향을 확인하기 위한 참고치로만 해석한다.

## 남은 제약

- 실제 Windows 11 WSL2 하드웨어에서의 종단 간 실행은 GitHub Ubuntu 테스트만으로 입증되지 않는다.
- 한국 전체 zoom 0–15 PNG 및 PBF의 전체 성능, RAM, 디스크 요구량은 이 지역 표본으로 외삽할 수 없다.
- PNG 동등성은 Monaco 줌 14의 OSM Carto 네 타일에서 검증됐으며, 모든 줌과 외부 데이터 변형에 대한 전수 검증은 아니다.