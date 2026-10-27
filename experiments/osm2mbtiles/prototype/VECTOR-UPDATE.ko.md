# OSM Detailed Vector MBTiles (PBF) 실험 기능

기존 PNG 변환의 기본 동작은 **변경하지 않았습니다**. 벡터 모드는 별도 osm2pgsql flex import를 사용해 해당 지역에서 태그가 있는 노드·웨이·관계 데이터를 JSONB와 PostGIS 지오메트리로 추출한 뒤, ST_AsMVT를 통해 MVT PBF로 변환합니다.

## 실행 예시

Windows (`run.bat`을 사용하며 Ubuntu/Debian WSL 및 네이티브 도구 설치가 필요):

```cmd
run.bat                    REM 기존 PNG MBTiles (기본)
run.bat vector             REM south-korea-latest.vector.mbtiles
run.bat vector 12-14       REM 상세 벡터 테스트
run.bat both               REM raster + vector 별도 파일
run.bat --format vector    REM 위 vector와 동일
```

Linux 개발 환경 (준비한 `--runtime` 필요):

```bash
osm2mbtiles south-korea-latest.osm.pbf -z 0-15 \
  --format vector -o south-korea-latest.vector.mbtiles \
  --runtime ./runtime --workdir ./work --processes 4
osm2mbtiles verify-vector south-korea-latest.vector.mbtiles
```

## 데이터 구조

- 18개 논리 레이어: `water`, `waterway`, `landcover`, `landuse`, `boundary`, `road`, `pathway`, `railway`, `aeroway`, `aeroway_area`, `building`, `building_part`, `leisure`, `place`, `poi`, `transport`, `power`, `housenumber`.
- 레이어의 지오메트리는 MVT 4096 extent, 버퍼 64로 타일 단위 클리핑됩니다.
- 주요 이름 `name`, `name:ko`, `name:en`, `name:ja`, 참조번호 `ref`, 도로 `maxspeed`, `lanes`, `surface`, `access`, 건물 `height`, `building:levels`, 상세 주소, POI `opening_hours`, `operator` 등을 OSM 원본에 존재하는 경우 저장합니다.
- 줌 0~12는 표시 밀도를 제어하는 소수 속성만 기록하고, 줌 13 이상은 풍부한 필드 셋을 유지합니다.
- MVT는 gzip으로 압축해 SQLite MBTiles `format=pbf`에 저장하며 `metadata.json.vector_layers`을 제공합니다.
- 벡터 렌더러는 워커별 별도 PostGIS 읽기 연결을 사용하고, 메인 프로세스에서만 SQLite에 배치 기록합니다.
- `run.bat` 기본은 raster이며, vector/both는 추가 모드입니다. WSL 중복 MBTiles는 Windows 파일과 바이트 비교에 성공하면 삭제됩니다.

## 한계와 검증

- 줌별 공개 OSM Carto 표시 정책을 출발점으로 삼은 **근사 필터링**입니다. OSM Carto의 모든 SQL·Natural Earth 저줌 보조 데이터와의 1:1 동등성을 주장하지 않습니다.
- 저줌은 OSM 지역 PBF만 이용하므로 Carto의 Natural Earth 전역 대륙·해안/도시 일반화 일부는 제공되지 않습니다. 타일이 빈 경우 저장하지 않습니다.
- MVT에는 색상/폰트/아이콘이 들어 있지 않으며 시각적 PNG 재현에는 별도 MapLibre 스타일이 필요합니다.
- GeoFabrik 국가 단위 PBF는 별도 벡터 import로 인해 디스크와 import 시간이 증가하며, 한국 전체의 완전한 최종 생성은 별도로 실측해야 합니다.
- 실제 GitHub Actions Monaco PBF 벡터 E2E 검증: `https://github.com/nssang00/chatgpt-write-test/actions/workflows/osm2mbtiles-vector-e2e.yml`