# 데이터 안내 (탕방 · 서울 목욕탕·사우나)

서울 목욕탕·사우나·온천 **506곳**. 화면은 `web/public/data/onsen.json` 한 파일만 읽는다. 이 문서는 그 파일이 어떤 자료에서, 어떤 순서로 만들어지는지 정리한 것이다.

## 폴더 분류

| 폴더 | 무엇이 들어 있나 | 누가 만드나 | 깃에 올리나 |
|---|---|---|---|
| `raw/` | 내려받은 **원본** 그대로 (행안부 CSV, 서울시 인허가 등) | 사람이 받아 둔다 | 올리지 않는다 (`.gitkeep`만) |
| `collected/` | 원본에서 **정리·수집한** 목록 (이름·주소·좌표·전화) | ego-lite 브라우저로 수집 / 스크립트 | 올린다 (`naver_raw.jsonl`, 좌표 캐시는 제외) |
| `curated/` | **사람이 확인·작성한** 자료 (요금, 제외 목록) | 사람 | 올린다 |
| `merged/` | 위 자료를 **합친 결과** | `onsen_merge.py` | 올린다 |

원칙: 사람이 손으로 확인한 값은 `curated/`에만 둔다. 스크립트가 다시 돌아도 덮어쓰지 않게 하려는 것이다. `collected/`와 `merged/`는 다시 만들 수 있는 파일이다.

## 파일 목록

### `raw/` — 내려받은 원본 (올리지 않음)
| 파일 | 내용 | 출처 | 기준일 |
|---|---|---|---|
| `skorea-municipalities-2018-geo.json` | 전국 시군구 경계 (18MB) | 통계청 SGIS 2018, 공공누리 제1유형. `southkorea/southkorea-maps` 저장소 `kostat/2018/json/`에서 받음 | 2018-12-24 |

`python export_gu_boundary.py` → `web/public/data/seoul-gu.json`(서울 25개 구 경계, 약 50KB, 점 간격 약 9m로 줄임). 내 위치가 어느 구인지 알려 주는 데 쓴다.

### `collected/` — 수집·정리한 목록
| 파일 | 줄 | 내용 | 출처 | 기준일 |
|---|---|---|---|---|
| `seoul_bath_clean.csv` | 521 | 서울 일반 목욕탕·사우나 | 카카오 로컬 | 2026-10-24 |
| `seoul_bath_license_clean.csv` | 166 | 서울시 인허가에만 있는 목욕탕 (좌표는 카카오로 채움) | 서울시 목욕장업 인허가(서울 열린데이터광장) | 2026-10-24 |
| `onsen_clean.csv` | 9 | 서울 온천·온천 숙박 | 카카오 로컬 | 2026-10-23 |
| `onsen_official_clean.csv` | 6 | 행안부 온천이용업소(서울) | 행정안전부 전국 온천이용업소 현황 | 2026-08-27 |
| `onsen_parking.csv` | 27 | 온천 근처 주차장(반경 안) | 카카오 로컬(PK6) | 2026-10-23 |
| `naver_raw.jsonl` | 9 | 네이버 플레이스 수집 원자료 (올리지 않음) | 네이버 플레이스 | 2026-10-26 |

### `curated/` — 사람이 확인·작성
| 파일 | 줄 | 내용 | 출처 |
|---|---|---|---|
| `onsen_prices.csv` | 151 | **확인된 요금** (성인 평일·주말, 수건, 주차, 어린이, 메모, 확인일) | 네이버 플레이스 가격표 145곳(2026-10-27), 서울시 착한가격업소·상한가격 6곳(2026-09-30) |
| `naver_notfound_exclude.csv` | 187 | 네이버 플레이스에서 같은 주소의 시설을 못 찾아 **제외한 곳** | 직접 확인(2026-10-27) |
| `tangbang_places_price_data.json` | 2 | 요금 조사 자료(실측 확인 / 인근 평균 추정) | 직접 조사 |

### `merged/` — 합친 결과
| 파일 | 줄 | 내용 |
|---|---|---|
| `onsen_merged.csv` | 506 | 서울 전체 목록. 칸: 이름, 시도, 시군구, 주소, 위도, 경도, 전화, 구분, 분류, 카카오ID, 카카오장소주소, 출처, 데이터기준일자 |

출처별 구성: 카카오 404 · 서울시 인허가 98 · 행안부+카카오 2 · 행안부 2.

### 화면용 최종본
`web/public/data/onsen.json` (`export_web_data.py`가 만든다) — 합친 목록에 요금·주차장을 붙인 것. 확인된 요금 151곳, 추정 요금 272곳(화면에는 "요금 미확인"으로 표시), 요금 정보 없음 약 83곳.

## 만드는 순서

```
collected/*  ─┐
curated/naver_notfound_exclude.csv ─┤→ onsen_merge.py → merged/onsen_merged.csv ─┐
                                    │                                            ├→ export_web_data.py → web/public/data/onsen.json
curated/onsen_prices.csv ───────────┴────────────────────────────────────────────┤
collected/onsen_parking.csv, curated/tangbang_places_price_data.json ────────────┘
```

```
python onsen_merge.py       # 목록 합치기 → data/merged/onsen_merged.csv
python export_web_data.py   # 요금·주차장 붙이기 → web/public/data/onsen.json
```

## 자주 쓰는 칸

- `카카오ID`: 가게를 구분하는 열쇠. `curated/onsen_prices.csv`와 `collected/onsen_parking.csv`가 이 값으로 목록과 이어진다.
- `구분`: `목욕탕·사우나` / `온천` / `온천 숙박` / `온천 목욕탕·사우나`
- `출처`(합친 목록): 어느 자료에서 왔는지. 같은 가게가 여러 자료에 있으면 행안부 이름·주소, 카카오 좌표를 쓴다.
- `데이터기준일자` / `확인일`: 자료를 만든 날(수집 자료는 `데이터기준일자`, 요금·제외 목록은 `확인일`).

## 알아 둘 점

- **수집은 ego-lite 브라우저로 한다.** 예전에 쓰던 수집 스크립트(카카오 API·공공데이터·네이버 크롤링)와 Streamlit 앱은 지웠다. 새 자료는 ego-lite로 모아 `collected/`에 같은 칸으로 저장하면 된다. 파이썬은 `onsen_merge.py`(합치기), `export_web_data.py`(화면용 JSON), `onsen_official.py`(시도 이름 표·시군구 뽑기 함수를 합치기 스크립트가 가져다 쓴다) 세 개만 남아 있다.
- `raw/`에는 지금 원본이 없다. 행안부 원본 CSV는 삭제했고(공공데이터포털에서 다시 받을 수 있다), 서울시 인허가 원본은 보관하지 않았다.
- 시도 표기는 파일마다 다르다 (`서울` / `서울특별시`). 합칠 때 `주소`가 `서울`로 시작하는 줄만 남긴다.
- 서울 외 지역 자료는 모두 지웠다(서비스는 서울 전용).
