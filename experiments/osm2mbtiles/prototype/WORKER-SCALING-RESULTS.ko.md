# 서울 실데이터 병렬 워커 확장 실험 (2026-10-28)

검증 GitHub Actions: https://github.com/nssang00/chatgpt-write-test/actions/runs/40670814852

## 검증 범위

- Ubuntu 24.04 GitHub-hosted runner, `nproc=4` / Python logical CPU=4.
- 같은 서울 OSM PBF (원본 입력 SHA-256은 CI evidence `input.sha256` 참조).
- BBOX `126.95,37.47,127.13,37.62`; z12~15: 435개 작업 계획, 434개 비어 있지 않은 타일.
- PostGIS 16, osm2pgsql flex, OSM Carto v6.0.0, Planetiler v0.10.2.
- PostGIS는 `safe` 공통 import 1회(17.43초), 이후 SQL JSONB projected 모드로 PBF MBTiles를 워커별 독립 실행. Import 시간은 PostGIS 벡터 측정에서 제외.
- Planetiler는 커스텀 YAML 프로파일을 이용해 OSM PBF에서 벡터 MBTiles까지 매번 생성. Planetiler의 `--threads`는 지정한 상위 설정이며 JVM 전체 스레드 수를 의미하지 않음.
- 워커/스레드: 1,2,4,8; 1회차 오름차순, 2회차 내림차순.
- 각 PostGIS 출력은 1워커 출력과 디코딩 MVT geometry, properties, duplicate multiplicity가 완전히 동일하도록 비교. 모든 비교 통과.

## 실측 (초)

| Workers/threads | PostGIS tile-only pass 1 | PostGIS pass 2 | 평균 | Planetiler PBF→MBTiles pass 1 | Planetiler pass 2 | 평균 |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 28.80 | 21.92 | 25.36 | 10.58 | 7.99 | 9.29 |
| 2 | 13.99 | 13.88 | 13.94 | 8.30 | 8.83 | 8.57 |
| 4 | 11.31 | 11.83 | 11.57 | 9.14 | 8.62 | 8.88 |
| 8 | 10.45 | 10.31 | 10.38 | 10.54 | 9.47 | 10.01 |

- PostGIS SQL+PBF tile-only: 8워커 평균이 1워커 대비 2.44배, 4워커 대비 1.11배 빠름.
- Planetiler는 본 데이터·환경에서 2스레드 평균이 가장 빠름. 일부 개별 패스에서 1스레드가 더 빠르므로 단일 실행으로 최적 스레드를 단정하지 말 것.
- PostGIS 공통 import + 8워커 타일 ≈ 17.43+10.38=27.81초(단순 합산). Planetiler 평균 8.57초의 작업 범위가 같지 않음: PostGIS import는 PNG용 Carto+벡터 테이블을 준비하고, Planetiler 커스텀 YAML은 PBF Vector-only이며 피처 선택/속성이 불일치함.
- 두 엔진 모두 실제 출력 비어 있지 않은 434개 타일이나, 출력 파일 크기는 PostGIS 약 35MB, Planetiler 약 23MB로 콘텐츠 구성 차이 큼. 동등 출력 성능 비교가 아님.
- `/usr/bin/time`의 RSS는 클라이언트 프로세스를 중심으로 측정되어 PostgreSQL 서버 백엔드 프로세스의 합계는 포함하지 않음. JVM RSS와 동등 메모리 비교 금지.
- `--threads`는 Planetiler 전체 OS/JVM 생성 스레드 수를 엄밀하게 제한하지 않는다. 1스레드 설정에서도 Java CPU 사용 시간이 실행 시간보다 긴 점에 유의.

## 프로그램 구조

- `--format=both`: `LocalDatabase.import_shared_extract()`가 Carto flex와 Vector flex 콜백을 결합해 PBF 한 번 순회·PostGIS에 두 테이블 제품군 작성. 안전 import 1프로세스/고속 import 4프로세스.
- `--format=raster`: Carto import만 한 번 실행; `--format=vector`: Vector import만 실행.
- PostGIS Vector exporter: `xyz_tasks()`는 BBOX/zoom을 `(z,x,y)`별로 스트리밍 생성, `multiprocessing.Pool.imap_unordered(..., chunksize=1)`을 통해 동적 작업 큐 방식으로 분산. 각 워커는 독립 PostGIS 연결을 가짐. 부모가 gzip/MVT를 하나의 SQLite/MBTiles에 기록.
- PNG renderer: 8x8 metatile 단위로 작업 생성(`tiles.metatiles`), `imap_unordered`로 Mapnik 워커에 분산하고 부모가 SQLite에 기록. 사용자 `generate_mbtiles.py`와 유사한 설계.
- 사전 영역 할당은 `(z,x,y)` 또는 metatile 좌표 작업을 분할하는 뜻이며 DB 자체를 워커별로 샤딩하거나 한 워커에 고정 지역 파티션을 사전 배당한다는 뜻은 아님.

## 재현

- `.github/workflows/osm2mbtiles-worker-scaling.yml`: GitHub-hosted Ubuntu/PostGIS/Java 실행.
- `benchmarks/worker_scaling_seoul.py`: 동일 PBF·PostGIS DB 재사용 벡터 SQL 및 Planetiler 병렬도 2회 반복 테스트. 결과물 `worker_scaling.json`, `summary.md`, 개별 타임 로그.

**권장:** 4 vCPU에서는 PostGIS 벡터 4워커를 안전한 기본값으로, 8워커는 DB 커넥션/메모리 여유가 있을 때 선택형; Planetiler는 우선 2~4 스레드. 전국 데이터에서는 작업량·코어 수가 달라지므로 별도로 재측정해야 함.