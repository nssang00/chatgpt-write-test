# PostGIS Vector MBTiles 최적화 실험 (2026-10-28)

## 검증 환경
- GitHub Actions: Ubuntu 24.04, PostgreSQL 16, PostGIS 3, osm2pgsql flex, Python psycopg2
- 데이터: 서울 OSM PBF 22,451,147 bytes. 입력 SHA-256: `b7c887feff4b12b8e16d0481ae247b1246b45df06a05fb98d431270a299edd27`
- 출력 BBOX: 127.015,37.485,127.075,37.535; 줌 12~15; 워커 2개
- 쿼리 3가지 방식은 동일한 import DB에 연결. 입력 다운로드 시간, PostgreSQL cluster 초기화/시작 시간은 측정에서 제외.
- 비교 Planetiler v0.10.2는 유사한 상세 18레이어 YAML 프로파일 사용: **출력 동등성 없음**.

## 실측 (GitHub Actions 40633815701)
| 처리 | 기본 SQL | 캐시 방식 | JSONB 키 투영 (선택) | Planetiler |
|---|---:|---:|---:|---:|
| OSM → PostGIS import (공유) | 14.24s | 14.24s | 14.24s | 없음 |
| 추가 전처리 | 0s | 17.58s | 0s | 없음 |
| 타일 생성 | 15.90s | 6.38s | 4.69s | 12.52s (PBF→MBTiles 전체) |
| 최초 전체 처리 (입력 준비 후) | 30.14s | 38.20s | **18.93s** | **12.52s** |

- `projected`가 `baseline`에 비해 타일 생성 약 3.39배 빠르며 최초 전체 처리 약 37% 단축.
- **MVT 정합성 검증:** 58개 타일, 218,140개 피처, 모든 레이어의 디코딩한 지오메트리/속성/중복 개수 동일. JSONB 키 투영과 캐시 모두 검증 성공.
- MBTiles 바이너리 SHA가 달라도 피처 순서와 SQLite 저장 순서가 다를 수 있으므로, 정합성은 디코딩된 피처 멀티셋으로 검증함.
- GitHub 성공 로그: https://github.com/nssang00/chatgpt-write-test/actions/runs/40633815701
- 실험은 **서울 일부 출력** 기준이며, 한국 전체 줌 0~15 완료나 PNG 렌더링 시간 개선은 주장하지 않음.
- Planetiler 대비 동일 레이어명/유사 속성 구성이나 줌별 객체 선택·일반화·스키마가 달라 엄밀한 출력 동등성 성능 측정은 아님.

## 사용
`run.bat vector`는 기본 `projected` 모드. 기존 SQL 재현은 Windows에서 `set OSM2MBTILES_VECTOR_QUERY_MODE=baseline` 실행 후 `run.bat vector`.
Python CLI: `osm2mbtiles ... --format vector --vector-query-mode projected`.
비교용 `--vector-query-mode cached`는 별도 PostGIS 속성 캐시와 디스크 용량이 필요하며 첫 생성에는 비추천.

## 해석
PostGIS 자체 때문에 타일 생성 속도가 반드시 낮은 것은 아니다. 동일 PostGIS/동일 타일 데이터로 SQL 설계 변경만으로 유의미한 개선을 실측했다. 하지만 별도 import 비용과 PostgreSQL 프로세스·디스크 점유는 남는다. 최초 대용량 벡터 단일 생성에서는 Planetiler식 직접 객체 스트리밍이 유리할 수 있다. PNG와 Vector 동시 생성 시 import 공유는 별도로 최적화할 과제다.

## 재현
GitHub Actions `.github/workflows/osm2mbtiles-seoul-benchmark.yml`에서 세 가지 PostGIS 쿼리 모드와 Planetiler를 같은 입력과 runner에 실행하며 `benchmarks/compare_postgis_modes.py`가 디코딩 동일성을 검증한다.