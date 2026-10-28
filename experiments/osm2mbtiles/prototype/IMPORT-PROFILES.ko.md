# PostGIS import 성능 최적화 / 검증 (2026-10-28)

## 실험 결과

- 같은 서울 OSM PBF, bbox 127.015,37.485,127.075,37.535, 줌 12~15.
- MVT 타일 58개에 대해 안전 설정과 4스레드 고속 설정의 지오메트리·속성·중복 피처가 동일했음.
- GitHub Actions 3회 측정, 단일 런 내부 순차 실행이므로 OS 캐시/CPU 간섭 영향은 남아 있음.

| 구성 | 1차 총 시간 | 재검증 1 | 재검증 2 |
|---|---:|---:|---:|
| 안전 import, 순차 인덱스 | 19.33초 | 24.28초 | 19.60초 |
| 4스레드, 병렬 인덱스, CLUSTER 생략 | 12.84초 | 14.08초 | 12.95초 |

세 실험에서 모든 벡터 데이터 동일성을 통과. 단, 메모리 사용은 osm2pgsql 자체 RSS만 측정했고 PostgreSQL 서버·페이지 캐시는 제외되어 있습니다.

검증: https://github.com/nssang00/chatgpt-write-test/actions/runs/40638007975
https://github.com/nssang00/chatgpt-write-test/actions/runs/40638457289
https://github.com/nssang00/chatgpt-write-test/actions/runs/40638462757

## Windows 실행

기본은 안전 모드이며 **기존 PNG 출력/데이터를 그대로 유지**합니다.

```bat
run.bat vector
```

여유 메모리가 있는 PC에서 새 벡터 import를 고속으로 실행하려면:

```bat
set OSM2MBTILES_VECTOR_IMPORT_PROFILE=fast
run.bat vector
```

- fast: osm2pgsql 4스레드, 테이블 병렬 인덱스 생성, 벡터 테이블 CLUSTER 생략.
- safe: osm2pgsql 1스레드, 순차 인덱스 생성, 기존 CLUSTER 사용.
- PostgreSQL 서버를 포함한 메모리 한도는 머신마다 다르므로 WSL 메모리가 부족하면 safe를 사용해야 합니다.
- safe/fast는 벡터 import에만 적용됩니다. PNG용 OSM Carto import는 변경하지 않습니다.
- import 캐시 키에 profile을 포함하므로 변경 시 새 import가 수행됩니다.

## 후속 과제

1. 한국 일부/전체 데이터, 타일 줌 0~15에서 재검증.
2. `both` 모드에서 Carto와 벡터의 2중 osm2pgsql import를 하나의 import로 합치는 실험.
3. PostGIS 서버 포함 최대 RSS, WSL swap, 최종 PNG·벡터 데이터 품질을 종합 평가.
4. 충분한 환경에서는 auto 고속 모드, 낮은 메모리 환경에서는 safe로 자동 전환하는 정책.