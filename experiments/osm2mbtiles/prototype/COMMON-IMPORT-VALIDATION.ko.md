# 공통 OSM import 검증 및 벤치마크

## 목적

`run.bat both` / `--format both` 실행 시 OSM Carto와 벡터 flex를 각각 한 번씩
수행하던 `osm2pgsql` import를 **한 번의 실행으로 통합**합니다.

- 기존 OSM Carto v6.0.0 Lua 파일은 수정하지 않습니다.
- `combined_flex_source()`가 두 스타일을 `dofile`로 불러오고 각 객체 콜백을
  하나로 결합합니다.
- 벡터 flex는 공유 객체의 원본 `tags`를 수정하지 않고 별도 테이블로 복사한 뒤
  불필요한 출처 정보를 제거합니다. 그 다음 Carto의 콜백이 실행됩니다.
- PNG-only와 Vector-only 모드는 계속 기존 독립 경로를 사용합니다.
- 작업공간의 `combined-import-state.json`으로 동일 원본/스타일/프로필의
  공통 import를 재사용합니다. 재import 실패 시 캐시 키를 남기지 않습니다.
- `--vector-import-profile fast`에서 공통 import는 4스레드/병렬 인덱스를 사용하지만
  PNG 데이터 공간 지역성을 위해 Carto의 CLUSTER 정책을 바꾸지 않습니다.

## 사용법

Windows 명령 프롬프트에서:

```bat
run.bat both
```

CLI에서는:

```bash
python3 -m osm2mbtiles south-korea-latest.osm.pbf \
  --format both --zoom 0-15 --output south-korea-latest.mbtiles \
  --runtime <runtime-dir> --workdir <work-dir>
```

출력: `south-korea-latest.raster.mbtiles` 및 `south-korea-latest.vector.mbtiles`.
동일 작업공간에 이전 분리 import가 있더라도 한 번의 공통 import로 다시 만들어
두 데이터셋이 동일 원본에 대응하도록 합니다. 다음 실행부터 캐시를 재사용합니다.

## 비교 측정 방법

고정 원본 PBF·줌 12~15·PostgreSQL 설정에서 `split,common,common,split`
순서로 실행하여 warm-cache 순서 효과를 줄였습니다. 외부 다운로드, PostgreSQL
클러스터 기동, PNG 렌더링, 벡터 타일 내보내기/검증 시간은 import 시간에서 제외합니다.

검증 기준은 다음과 같습니다.

1. OSM Carto 핵심 테이블 4개와 벡터 테이블 5개의 행 개수 및 모든 열을 포함하는
   정렬된 row JSONB MD5가 정확히 일치해야 합니다.
2. 실제 PostGIS `ST_AsMVT`로 생성한 타일을 gzip 해제하고, 레이어별 피처의
   지오메트리, 모든 속성, 중복 개수를 비교하여 차이가 없어야 합니다.
3. SQLite 무결성 및 PBF 메타데이터가 올바른지 확인합니다.

공통 import를 통해 *OSM PBF 파싱·슬림 중간 저장소·테이블 준비*를 공유하는 효과만
평가합니다. PNG의 전체 OSM Carto 픽셀 일치 여부와 Windows 더블클릭 E2E,
한국 전국 z0~15의 전체 생산 시간은 별도 검증 대상입니다.

## GitHub Actions 실측 결과 (2026-10-28)

| 데이터셋 | 분리 import 중앙값 | 공통 import 중앙값 | 시간 절약 | 배율 |
|---|---:|---:|---:|---:|
| Monaco PBF | 1.868초 | 1.399초 | 0.469초 | 1.335배 |
| 서울 전체 PBF 22.45MB | 31.072초 | 24.472초 | 6.600초 | 1.270배 |

- 반복 순서: `split, common, common, split`. 동일 Linux runner, 동일 원본·DB 설정.
- 측정 범위: OSM Carto의 import·기능/인덱스 SQL, 벡터 import·보조 SQL.
- 데이터 품질: 9개 테이블의 **모든 행 내용 해시 및 건수** 일치.
- 서울 벡터 품질: 줌 12~15, 비어 있지 않은 타일 58개, 디코딩된 피처
  218,140건의 기하·속성·중복 개수 일치.
- 검증 실행: https://github.com/nssang00/chatgpt-write-test/actions/runs/40645840600
- Vector-only Planetiler 서울 참고: https://github.com/nssang00/chatgpt-write-test/actions/runs/40634312587

**해석:** 중복 OSM PBF 순회와 middle-table 준비를 줄였지만, Carto와 상세
벡터 결과 테이블을 모두 PostgreSQL에 저장하고 각 인덱스를 준비하는 비용은
남습니다. 약 21% 향상은 실측으로 입증됐으나 Planetiler보다 반드시 빠른
총 작업 파이프라인이라는 근거는 아닙니다. Planetiler는 PNG를 출력하지 않으므로
비교 대상이 다릅니다. 기존 서울 Planetiler 12.54초는 *벡터 생성 전체* 시간이지만
위 값은 *Carto+벡터 공통 DB import* 시간입니다.

PNG의 전체 OSM Carto 스타일 이미지 바이트 동일성, 한국 전국 z0~15 전체
MBTiles 생성 시간과 PostgreSQL 서버 포함 peak RAM은 이 테스트에서
측정하지 않았습니다. 기존 Mapnik PNG 렌더러는 변경되지 않았고, 동일한
Carto 데이터 테이블이라는 사실은 검증됐습니다. 별도 Mapnik 기본
레이어 PNG 스모크 검증을 수행할 수 있지만, 전체 스타일 픽셀 검증과
동일시하지 않습니다.

## Mapnik PNG 스모크 검증

실제 Mapnik Python 및 PostGIS datasource를 사용해 `planet_osm_polygon`,
`planet_osm_line` 테이블에서 PNG를 렌더링하고 분리/공통 import 결과의
SHA-256 일치 여부를 추가 검사합니다(`benchmarks/common_png_smoke.py`).
**이 테스트의 스타일은 최소 검증용**으로, 전체 OSM Carto CSS의 텍스트 배치·외부
데이터까지 포함한 완전한 픽셀 비교를 의미하지 않습니다.
