> **새 기능: 상세 OSM 벡터 PBF MBTiles** — 기본 `run.bat`은 기존 PNG를 생성합니다. `run.bat vector`로 벡터 MBTiles를, `run.bat both`로 두 형식을 생성합니다. 상세 사용법과 한계는 [VECTOR-UPDATE.ko.md](VECTOR-UPDATE.ko.md)를 참고하세요.

# osm2mbtiles-local — Docker 없는 오프라인 래스터 MBTiles 생성기 (프로토타입)

> **Windows 한국 지도 자동 생성:** `run.bat`을 더블클릭하면 Geofabrik `south-korea-latest.osm.pbf`를 자동 다운로드한 뒤 `south-korea-latest.mbtiles`로 변환을 시도합니다. 기존 PBF 드래그 앤 드롭도 지원합니다. **Docker는 필요 없지만 WSL Ubuntu/Debian이 먼저 설치되어 있어야 합니다.** 자세한 내용은 [WINDOWS-ONECLICK.md](WINDOWS-ONECLICK.md)를 참조하세요. Windows 네이티브 런타임 번들은 아직 포함되지 않았습니다.

**목표**: 최종 사용자는 PostgreSQL, PostGIS, osm2pgsql, Mapnik을 직접 설치하거나 DB를 설정하지 않고, `run.bat`을 실행하기만 하면 됩니다. WSL Ubuntu/Debian 사전 설치는 필요합니다.

```bash
osm2mbtiles south-korea.osm.pbf -z 0-15 -o korea.mbtiles
```

**현재 상태는 동작 원리를 검증한 소스 코드 프로토타입입니다.** Docker는 사용하지 않습니다. 다만 **PostgreSQL/PostGIS/Mapnik의 플랫폼별 실행 파일까지 포함한 완성형 런타임은 아직 제작되지 않았습니다.** 따라서 지금 제공하는 ZIP 파일만 압축 해제해서 위 명령어를 실행하는 것은 불가능합니다.

## 작동 흐름

```
PBF 파일 → HeaderBBox 추출 → 자체 로컬 PostgreSQL 초기화·시작
  → PostGIS/hstore 구성 → osm2pgsql flex import
  → OSM Carto SQL 및 외부 데이터/폰트 준비
  → Mapnik 8×8 metatile 생성 → PNG 분리
  → SQLite MBTiles 저장 → PostgreSQL 자동 종료
```

시스템 전역 PostgreSQL 서비스로 등록하지 않습니다. Linux에서는 소켓 전용으로 PostgreSQL을 시작하고, Windows에서는 loopback + SCRAM 인증을 사용하도록 설계했습니다. 재실행할 때 `--workdir`을 사용하면 기존 DB의 import 결과를 재사용할 수 있습니다.

## 구현된 기능

- PBF 헤더의 bounding box 읽기 (없는 PBF는 `--bbox` 지정)
- XYZ 영역 계산과 8×8 metatile 작업 분할
- 앱 전용 PostgreSQL 초기화, 실행, 종료
- `osm2pgsql` flex, OSM Carto SQL 실행 순서 자동화
- Mapnik 렌더링 워커와 256×256 PNG MBTiles 저장
- SQLite 무결성 검사 및 임시 파일을 통한 출력 보호
- `verify`, `compare --pixels`, `--dry-run`, `--max-tiles`
- 작업 디렉터리 사용 시 데이터 import 재사용

## 직접 실행 / 테스트

```bash
python -m pip install -e .
python -m pytest -q
python -m osm2mbtiles korea.osm.pbf -z 0-15 -o korea.mbtiles --dry-run
python -m osm2mbtiles doctor --runtime ./runtime
```

실제로 렌더링하려면 별도로 만든 `--runtime`에 PostgreSQL/PostGIS, osm2pgsql, GDAL, Mapnik Python, 공식 OSM Carto 스타일과 컴파일된 XML, 필요한 폰트·라이브러리를 넣어야 합니다. 개발 PC에 해당 도구가 설치되어 있다면 `tools/stage_from_system.py`로 개발용 링크를 만들 수 있습니다. 사용자 배포용 포터블 런타임은 이와 별도로 빌드해야 합니다.

## 검증의 범위

**실제로 통과한 것:** PBF 헤더 파서, 줌/좌표 계산, PostgreSQL 호출 및 종료, 단계별 fake 실행, 타일 분할·저장, MBTiles 무결성, 픽셀 비교, import 재사용.

**아직 검증하지 못한 것:** 실제 Geofabrik PBF import, 네이티브 PostgreSQL/PostGIS 환경 실행, Mapnik/Carto 실제 이미지 렌더링, 기존 `renderd` 결과와 픽셀 단위 일치, Windows 포터블 런타임 패키징.

추가 기술 문서는 영문 [README.md](README.md)와 [VALIDATION_REPORT.md](VALIDATION_REPORT.md)에 정리되어 있습니다.

### 병렬 렌더링 (참고 구현 반영)

`--processes`(기본 최대 4)는 워커당 Mapnik 스타일을 한 번 로드하고 8×8 메타타일을 병렬 렌더링합니다. MBTiles SQLite 기록은 부모 프로세스 하나가 처리합니다.

```bash
osm2mbtiles korea.osm.pbf -z 0-15 -o korea.mbtiles --processes 4 --metatile 8 --encoding png
```

최종 이미지를 기존 `renderd`와 픽셀 단위로 비교하려면 `--encoding png`(기본값)를 사용하십시오. `--encoding png256`은 팔레트 양자화로 출력이 달라질 수 있습니다. 성능 향상은 데이터 크기, PostGIS 읽기 부하, RAM 및 SSD 속도에 따라 달라집니다. Mapnik 실제 벤치마크는 별도로 수행해야 합니다.


> **2026-10-27 compatibility fix:** `run.bat` checks osm2pgsql >= 1.8.0 for OSM Carto 6 flex style and builds a cached private 1.11.0 copy when Ubuntu/WSL supplies an older binary. Existing PBF cache is reused. See WINDOWS-ONECLICK.md.


### Windows 렌더링 진행률 및 캐시 정리

- 전체 줌(기본 0–15)에 대한 총 PNG 타일 수를 먼저 계산합니다. 렌더러는 퍼센트, 완료 타일/전체 타일, `tile/s`, 예상 남은 시간을 보여줍니다.
- `run.bat` 실행이 성공하면 기본적으로 WSL에 만들어진 **중복 MBTiles만 자동 제거**하고 다운로드 PBF와 PostGIS DB는 유지합니다.
- 별도의 **`cleanup.bat`**을 더블클릭하면 WSL 캐시 용량을 확인하거나, 성공한 변환 후 보관 중인 PostGIS DB만 안전하게 정리할 수 있습니다.
- `set OSM2MBTILES_CLEANUP=prune` 후 `run.bat`을 실행하면 이번 생성이 완료된 뒤 DB까지 정리합니다. 자세한 내용은 `WINDOWS-ONECLICK.md`를 참조하세요.

## 고속 벡터 타일 생성 (PostGIS SQL 최적화)

`run.bat vector`는 기본적으로 `projected` SQL 모드를 사용합니다. PostGIS를 유지한 상태에서 피처별로 **실제로 존재하는 JSONB 태그 키만 추출**해 반복 속성 처리 비용을 줄입니다. 별도의 캐시 테이블이나 디스크 전처리가 필요하지 않습니다.

기존 쿼리를 기준 구현으로 실행하려면 Windows 명령 프롬프트에서 `set OSM2MBTILES_VECTOR_QUERY_MODE=baseline`을 설정한 뒤 `run.bat vector`를 실행할 수 있습니다. `cached`는 실험용 캐시 모드이며 처음 생성할 때 오히려 느릴 수 있습니다.

서울 일부 지역 실측에서는 벡터 타일 생성 15.90초 → 4.69초, import 포함 30.14초 → 18.93초였습니다. 디코딩된 218,140개 피처의 지오메트리와 속성까지 같은 것을 확인했습니다. 세부 제한 사항과 재현 URL은 `POSTGIS-VECTOR-OPTIMIZATION.ko.md`를 참고하세요.

## PNG + Vector 공통 Import (실데이터 검증)

`run.bat both`는 **OSM PBF를 한 번 읽는 `osm2pgsql` 공통 flex import**를 사용합니다. OSM Carto PNG용 테이블과 상세 MVT Vector용 테이블을 동시에 준비한 뒤 Mapnik PNG 및 PostGIS `ST_AsMVT` PBF MBTiles를 각각 생성합니다. PNG만 출력하는 `run.bat`과 Vector만 출력하는 `run.bat vector`는 기존 전용 import 경로를 유지합니다.

기본은 WSL2 안정성을 위한 `safe` import 프로필입니다. RAM/CPU 여유가 있고 실측 결과가 적절한 환경에서는 Windows 명령 프롬프트에서 `set OSM2MBTILES_VECTOR_IMPORT_PROFILE=fast` 후 `run.bat both`를 실행할 수 있습니다. `fast`는 PostgreSQL 서버 메모리까지 고려할 때 저메모리 PC에 권장되지 않습니다.

실제 Carto 스타일과 Geofabrik Monaco OSM 데이터로 PNG 픽셀과 Vector 속성 동일성을 검증했고, 별도의 서울 PBF 테스트에서는 Carto/Vector 데이터 9개 테이블 및 벡터 58타일 전체를 비교했습니다. 측정/제약/비교 범위는 [SHARED-IMPORT-VALIDATION.ko.md](SHARED-IMPORT-VALIDATION.ko.md)를 참조하세요. 실제 Windows 11 + WSL2 및 한국 전체 줌 0–15 종단 간 검증은 아직 별도입니다.

## 실험용 PostGIS 지역 배치 Vector MVT

기존 `--vector-tiler postgis`가 기본값이며, 성능 실험에서 의미적 동등성을
확인한 지역 배치 SQL 생성기는 명시적으로 선택해야 합니다.

```bash
python3 -m osm2mbtiles convert seoul.osm.pbf --format vector --zoom 12-15 \
  --bbox 126.95,37.47,127.13,37.62 --output seoul-batch.mbtiles \
  --vector-tiler batch --vector-batch-side 2 --processes 4
```

- `batch`는 PostGIS 안에서 지역별 후보 피처를 MATERIALIZED CTE로 추출하고
  여러 타일에 재사용하며, 기존 `ST_AsMVTGeom` + `ST_AsMVT`를 그대로 사용합니다.
- 기본 방식은 변경하지 않았으며 PNG는 기존 경로를 따릅니다.
- 실제 출력은 GitHub Actions의 원본 베이스라인과 디코딩된 MVT의 타일별
  피처 ID/Geometry/속성/중복도 및 메타데이터(출력 이름 제외)를 비교합니다.
- 이 실험은 초기 전체 생성 방식의 개선입니다. OSM replication 기반
  **증분 업데이트는 별도 실험용 CLI로 구현되었지만 이 `convert` 경로에는 연결되지 않았습니다.** `--slim --drop`의
  기존 최초 import 파이프라인도 그대로 유지되어 있습니다.
- 실제 CI 자료: `.github/workflows/osm2mbtiles-batch-parity.yml`.
  Planetiler 벤치마크는 동일 PBF/BBOX/zoom이지만 출력 스타일과 피처 수가 달라
  의미적으로 동일한 출력 처리량 비교가 아닙니다.


## PostGIS Vector 증분 업데이트 (실험용, 별도 CLI)

기존 `convert` 경로는 여전히 최초 변환용으로 `--slim --drop`을 사용합니다.
**증분 업데이트를 원하면 처음부터** 아래의 update 전용 경로로 DB를 준비해야 합니다.
이미 `--drop`으로 만든 DB에 `append`를 실행하는 것은 지원하지 않습니다.

전제: 별도 애플리케이션 소유의 빈 PostgreSQL/PostGIS DB `gis`에
접속 가능한 환경 변수 `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` 설정.
`osm2pgsql`, `psql`, Python `psycopg2` 설치. 네트워크 공개 DB, 운영 DB에
곧바로 실험하지 마세요. 최초 import에서 OSM middle 저장소를 계속 보존하므로
원본 데이터 저장 공간이 더 필요합니다.

```bash
# 1) 최초 생성: PostGIS middle 유지 및 모든 Vector MBTiles 작성
python3 -m osm2mbtiles.vector_incremental init \
  --pbf initial.osm.pbf --output region.mbtiles \
  --bbox 126.97,37.48,127.03,37.53 --zoom 12-15 --processes 4

# 2) OSC 변경 파일 적용: PostGIS append, expire tiles, MBTiles UPSERT/DELETE
python3 -m osm2mbtiles.vector_incremental append \
  --diff change.osc.gz --output region.mbtiles

# 3) OS 오류 등으로 타일 기록에 실패했을 때 재적용 없이 flush만 재시도
python3 -m osm2mbtiles.vector_incremental flush --output region.mbtiles
```

- 초기 import는 기존 `vector-flex.lua`에서 3857 Geometry 네 곳에
  osm2pgsql expire 출력 설정을 덧붙인 스타일을 사용합니다. 파일은
  `region.mbtiles.update-flex.lua`로 고정 저장됩니다.
- append 시 `--slim --append`로 원본을 갱신하고, 현재 구현에서는
  `vector_label_points`를 전부 재작성한 뒤 변경 타일만 다시 생성합니다.
  이 전체 라벨 재작성은 큰 데이터에서 업데이트 성능의 병목이므로 최적화 예정입니다.
- dirty tile 목록은 `vector_expired_tiles` PostGIS 테이블에 유지되며,
  MBTiles는 하나의 SQLite 트랜잭션으로 UPSERT/DELETE합니다. SQLite
  커밋 후 PostGIS 큐 정리에 실패해도 `flush` 재시도가 가능합니다.
- 미확정 osm2pgsql 실패(`phase=applying`) 후에는 `append`를 자동
  재시도하지 않습니다. DB에 일부 변경만 적용되었을 수 있으므로 상태 확인 또는
  별도 재구축이 필요합니다. 여러 독립 프로세스가 DB에 직접 쓰지 않는
  단일 업데이트 운영을 전제로 합니다.
- GitHub Actions: `.github/workflows/osm2mbtiles-incremental-parity.yml`.
  CI는 합성 OSM 변경(추가/이동/속성수정/삭제) -> `--append` ->
  영향 타일만 재생성 -> 새 DB의 전체 재생성 결과를 디코딩된 MVT로 비교합니다.
- 아직 **PNG 증분 업데이트, 원격 replication sequence 수집/검증, 전국 규모,
  프로파일/줌 변경을 동반한 무중단 갱신은 지원/검증하지 않습니다.**
  유효 범위 밖의 변경이나 스타일 변경에는 전체 재생성이 필요합니다.


## 새로운 타일 출력 옵션 및 전체 시간

새 옵션은 기존 CLI를 깨지 않도록 별칭으로 추가했습니다.

| 목적 | 신규 옵션 | 이전 옵션 (호환 유지) |
|---|---|---|
| 타일 종류 선택 | `--tile-type raster|vector|both` (기본 raster) | `--format raster|vector|both` |
| Raster 인코딩 선택 | `--raster-format png|png256` (기본 png) | `--encoding png|png256` |

`--format png|pbf`는 지원하지 않습니다. Raster는 PNG/PNG256, Vector는 gzip 압축된
MVT/PBF로 출력합니다. 두 종류를 함께 생성하는 `both`는
`<name>.raster.mbtiles`, `<name>.vector.mbtiles` 파일 2개를 작성합니다.
신·구 옵션을 동시에 썼는데 값이 상충하면 즉시 오류가 납니다.
Vector만 생성할 때 `--raster-format`은 지정할 수 없습니다.

```bash
python3 -m osm2mbtiles convert seoul.osm.pbf \
  --tile-type both --raster-format png --zoom 12-14 \
  --output seoul.mbtiles --processes 4 --vector-tiler batch
```

CLI는 성공·실패 모두 `[TIME] Total convert elapsed: ...` 형식으로 전체 변환
시간(초 및 시:분:초)을 출력합니다. Windows 실행기는 다운로드 이후 WSL 생성,
MBTiles 검증·Windows 복사 시간을 별도로 표시합니다.

### Windows 서울 OSM 자동 다운로드·실생성 테스트

프로젝트 폴더에서 다음 배치 파일을 실행하세요.

```bat
test-seoul.bat
test-seoul.bat 12-15 vector
test-seoul.bat 12-14 both
```

- 기본: **서울 OSM**(`https://tiles.osm.kr/download/seoul-non-military.osm.pbf`)을
  `test-output` 폴더에 내려받고 재실행 시 재사용합니다.
- 기본 출력: `--tile-type both`, z12~14, PNG + MVT/PBF MBTiles 두 개.
  기본 Vector 엔진은 `batch`, Raster 인코딩은 손실 없는 `png`.
- 실제 지도 스타일은 기존 `run_windows.ps1` / `run_wsl.sh`의 OSM Carto +
  Mapnik 경로를 재사용합니다. 가짜 타일이나 fixture 출력이 아닙니다.
- 출력 위치: `test-output/seoul-non-military.raster.mbtiles` 및
  `test-output/seoul-non-military.vector.mbtiles`.
- 배치 파일은 다운받은 PBF, 기존 WSL 설치 및 인터넷 연결이 필요합니다.
  `run.bat`과 마찬가지로 Windows 10/11 + Ubuntu/Debian WSL이 필요합니다.
  완료 시 다운로드부터 Windows 복사까지의 전체 시간도 출력합니다.
- 기존 출력이 있으면 덮어쓰기 전에 사용자 확인을 요구합니다.
- `run.bat --tile-type both 12-14`도 사용할 수 있습니다. 이때 원본은 기본
  Geofabrik 한국 전체 PBF이므로 **서울 테스트와 다릅니다**.
- 고급 환경변수 `OSM2MBTILES_VECTOR_TILER=postgis|batch`,
  `OSM2MBTILES_VECTOR_BATCH_SIDE=1..8`,
  `OSM2MBTILES_RASTER_FORMAT=png|png256`를 Windows 런처에 전달합니다.
