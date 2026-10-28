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