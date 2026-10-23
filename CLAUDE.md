# D08-map · 카카오 지도 + 판다스 서비스

파이썬이 장소를 찾고(REST 키), 지도는 브라우저가 그린다(JavaScript 키). 공공데이터 CSV를 판다스로 정리해 Streamlit 지도로 보여 주는 서비스를 만든다.
줄마다 (왜)와 → 검사가 있다. 규칙 한 줄 = 검사 한 줄.

## 환경
- Python 3.11, conda 가상환경 `myvenv` (`conda activate myvenv`). 설치는 `pip install -r requirements.txt`. 설치 명령은 제안만 하고 직접 돌리지 않는다.
- 터미널은 PowerShell(Windows). 시간은 KST.

## 우리 서비스
- 질문: "___" (주인공: ___)
- 데이터: ___ (출처 ___, 데이터 기준일 ___), 원본 파일 `data/____raw.csv`
- 개인 단계 산출물: `place.py` → `geo.py` → `make_map.py` → `clean_parking.py` → `data/parking_clean.csv` (선택 `factcheck.py`, `map_app.py`)
- 조 단계 파일: `data_prep.py`(판다스 정리만) → `data/clean.csv` → `app.py`(Streamlit 화면만), 지도는 `make_map.py`의 `kakao_map_html(js_key, markers)` 한 곳

## 현재 파일
- `place.py` — `search_place(검색어, size=5)` → `[{이름, 주소, 위도, 경도}]`. 다른 파일에서 import해서 쓴다. 키·연결 문제는 `⛔`로 시작하는 한국어 한 줄 `RuntimeError`.
- `.env` 키 이름: `KAKAO_REST_API_KEY`, `KAKAO_JS_KEY`. 새 키 이름은 `.env.example`에만 추가한다.

## 두 개의 열쇠 규칙
- 장소 검색·주소↔좌표는 **파이썬**에서 `KAKAO_REST_API_KEY`로만 부른다. 헤더 `Authorization: KakaoAK 키`. (왜: REST 키는 금고 키) → 검사: REST 키를 `os.getenv`로만 읽음
- **REST API 키는 HTML·`map.html`·Streamlit 화면 어디에도 넣지 않는다.** (왜: 브라우저로 가면 누구나 봄) → 검사: `map.html`에서 REST 키 앞 6글자 검색 → 0건
- 지도 그림에는 `KAKAO_JS_KEY`만 쓴다. `.env`에서 읽어 HTML을 만들 때 넣는다. (왜: JS 키는 브라우저로 가는 게 정상, 대신 카카오 콘솔에 등록한 주소에서만 켜짐) → 검사: `.env`에 두 키가 다른 값으로 있음
- 브라우저 쪽 장소 검색(`libraries=services`)은 쓰지 않는다. 검색은 파이썬이 한다. → 검사: HTML에 `services` 없음
- `.env`를 열어 보여 주거나 값을 대화에 쓰지 않는다. 값은 사용자가 직접 넣는다. (왜: 대화에 키가 남으면 안 됨) → 검사: 대화에 키 값이 안 나옴
- 요청 주소·헤더·`response.url`·`res.text`를 출력하지 않는다. (왜: 카카오는 헤더에 키) → 검사: 키를 틀리게 하고 실행해 출력 전체 확인

## 좌표 규칙
- 카카오 응답의 **`x` = 경도, `y` = 위도**이고 **글자**다. `float()`로 바꾸고 이름을 `위도`·`경도`로 붙인다. (왜: 뒤집으면 마커가 바다에 찍힘) → 검사: 서울 좌표가 (37.x, 127.x)
- 지도 SDK는 `new kakao.maps.LatLng(위도, 경도)` 순서. 요청을 보낼 때는 `x=경도, y=위도`. → 검사: 마커가 실제 장소 위에 있음
- 한국 밖 좌표(위도 33~39, 경도 124~132 밖)는 쓰지 않는다. → 검사: 좌표 하나를 일부러 뒤집어 실행
- `road_address`(도로명)는 null일 수 있다. 없으면 지번 주소를 쓴다. → 검사: 산·공원으로 좌표→주소

## 지도 HTML 규칙
- `map.html`은 파이썬이 만들고, 이 폴더에서 `python -m http.server 8000 --bind 127.0.0.1` → `http://localhost:8000/map.html`로 연다. 더블클릭(file://)으로 열라고 안내하지 않는다. `--bind 127.0.0.1`을 절대 빼지 않는다. (왜: JS 키는 등록한 주소에서만 켜짐 / bind 없이 켜면 같은 와이파이에서 `.env`를 받아 갈 수 있음) → 검사: 안내 문장에 `--bind 127.0.0.1`
- SDK는 `https://dapi.kakao.com/v2/maps/sdk.js?appkey=JS키&autoload=false` + `kakao.maps.load(...)`. 지도 아래에 "지도가 회색이면: ① 카카오맵 사용 설정 ② 지금 주소(포트까지) 등록 ③ 서버 주소로 열기" 안내 한 줄을 **항상** 보여 준다. → 검사: 안내 줄이 보임
- 장소 이름은 `textContent`로, 데이터는 `json.dumps`로 넣는다. → 검사: 이름에 `"`가 든 장소
- 마커가 여러 개면 `LatLngBounds`로 전부 보이게 맞춘다. 마커는 200개까지만. → 검사: 마커가 다 화면 안에
- JS 키는 `map.html`에 넣지 않고 `map_config.js`에만 둔다. `map_config.js`는 `.gitignore`에 두고, 키가 없는 `map.html`은 올려도 된다. (왜: 키 파일만 빼면 HTML은 공유해도 안전) → 검사: `map.html`에서 JS 키 앞 6글자 검색 → 0건, `git status`에 `map_config.js` 안 보임

## Streamlit 규칙
- 실행은 `streamlit run 파일.py`. 지도 HTML은 **`st.iframe(html글자, height=...)`** 로 넣는다. `st.components.v1.html`은 쓰지 않는다. → 검사: 코드에 `components.v1` 없음
- 실행 안내에 카카오 콘솔 JavaScript SDK 도메인 `http://localhost:8501` 등록을 적는다. `localhost:8502`·Network URL(IP)·`127.0.0.1`로 열면 안 뜬다는 것도. → 검사: 안내 문장
- `.env`는 `load_dotenv(override=True)`로 읽고, `.env`를 고치면 `Ctrl+C` 후 다시 `streamlit run` 하라고 안내한다. 에러 결과는 캐시하지 않는다(캐시 함수 안에서 예외를 내고 밖에서 받기). → 검사: 키를 틀렸다 고친 뒤 재시작
- 글자 설명은 `st.metric` 변화량 자리에 넣지 않고 `st.caption`으로. → 검사: 화살표 없음
- `requirements.txt`에 `streamlit>=1.66`. API 함수에 `@st.cache_data(ttl=600)`. 표·숫자는 `st.dataframe`, `st.metric`. 에러는 `st.error("한국어 한 줄")`. → 검사: `streamlit --version`

## 화면 규칙 (조 서비스)
- 사이드바 필터 1개 이상. 필터된 표 `view` 하나에서 지도·metric·표를 모두 만든다. (왜: 숫자와 지도가 다르면 신뢰를 잃음) → 검사: 필터 바꾸고 셋 비교
- `st.metric` 3개, `st.iframe`(지도, 마커 최대 200개), `st.dataframe`. → 검사: 코드 검색
- 결과가 0개면 지도 대신 `st.info("조건에 맞는 곳이 없어요")`. → 검사: 필터를 극단으로
- 화면 맨 아래에 출처와 **데이터 기준일**. "실시간"이라고 쓰지 않는다. → 검사: 캡션
- 숫자는 판다스로 계산한다. 화면 문구의 숫자는 변수에서 온다. → 검사: 문구 속 숫자 출처
- 디자인 값(마커 색·문구)은 `app.py` 맨 위 `STYLE = {...}` 한 곳에. → 검사: 색 코드가 한 곳에만
- `app.py`는 `data/clean.csv`를 `@st.cache_data`로 읽고 원본을 직접 읽지 않는다. → 검사: `app.py`에 `_raw` 없음

## 판다스 규칙
- 동네로 거를 때는 **시·도까지 붙인 이름**(`"서울특별시 강남구"`)으로 거른다. (왜: `"남구"`는 `"강남구"`에도 들어 있음) → 검사: 걸러진 주소 앞부분이 모두 같음
- CSV는 `utf-8-sig` → `cp949` 순서로 시도해 읽고, 읽은 인코딩을 출력한다. → 검사: 출력에 인코딩 이름
- 읽은 뒤 항상 줄 수·칸 수·빈칸 개수(`shape`, `isna().sum()`)부터 보여 준다. → 검사: 출력 첫 줄들
- 숫자 칸은 `pd.to_numeric(..., errors="coerce")`. "무료" 같은 글자는 먼저 0으로. → 검사: 평균 요금이 숫자로 나옴
- 칸 이름은 **파일에 실제로 있는 이름**만 쓴다. 모르면 `df.columns`를 먼저 출력한다. 새 칸은 사용자가 "새로 만들어"라고 했을 때만. `데이터기준일자`는 남긴다. → 검사: KeyError 없음
- 빈 좌표를 카카오로 채울 때는 **최대 30줄**, 호출마다 `time.sleep(0.1)`, `⛔`로 시작하는 에러가 나면 바로 멈춘다. → 검사: 코드에 한도·sleep·멈춤
- 저장은 `encoding="utf-8-sig"`, `index=False`. 원본(`*_raw.csv`, `*_raw.xlsx`)은 `.gitignore`, `clean.csv`만 올린다. → 검사: `git status`
- 개인 이름·휴대폰 번호 칸은 `clean.csv`에서 뺀다. 기관 대표번호는 둬도 된다. → 검사: 칸 목록
- XLSX는 `pd.read_excel(경로)`, `openpyxl`을 `requirements.txt`에. → 검사: import·requirements 짝
- 개수·평균은 **코드로 계산**하고 어떤 조건으로 셌는지 출력에 적는다. 엑셀 필터로 검산할 수 있게. → 검사: 조건이 출력에 있음

## 공통 규칙
- API 주소는 파일 맨 위 `API = {...}` 한 곳 + `# 🔌`, 요청 줄에 `# 🔌 API 호출`. `requests.get(..., timeout=10)`, 실패는 한국어 한 줄. 출력 맨 아래 출처. → 검사: Ctrl+F 🔌, 출처
- 새 패키지는 `requirements.txt`에 추가하고 설치는 제안만. import와 requirements.txt가 짝이어야 한다.
- 커밋·푸시·머지는 하지 말고 메시지만 제안, 커밋 전 `git status`를 보여 준다. 
- 조 작업: Issue 하나 = 브랜치 하나 = PR 하나. 남의 담당 파일은 고치지 않고, main에서 직접 작업하지 않는다. 각자 `.env`에 각자 키, 키를 Slack·Issue·PR에 붙이지 않는다.

## 쓸 수 있는 API
헤더는 모두 `Authorization: KakaoAK {REST API 키}`.

| 용도 | 주소 | 보내는 값 | 주요 칸 |
| --- | --- | --- | --- |
| 키워드 장소 검색 | `https://dapi.kakao.com/v2/local/search/keyword.json` | `query`, (선택) `x`·`y`·`radius`(최대 20000)·`sort=distance`, `category_group_code`, `size`(최대 15) | `place_name`, `road_address_name`, `address_name`, `x`, `y`, `phone`, `category_name`, `place_url`, `distance` |
| 카테고리 장소 검색 | `https://dapi.kakao.com/v2/local/search/category.json` | `category_group_code`, `x`, `y`, `radius` | 위와 같음 |
| 주소 → 좌표 | `https://dapi.kakao.com/v2/local/search/address.json` | `query` | `documents[0].x`, `y`, `address_name` |
| 좌표 → 주소 | `https://dapi.kakao.com/v2/local/geo/coord2address.json` | `x`(경도), `y`(위도) | `road_address.address_name`(없을 수 있음), `address.address_name` |
| 지도 JS SDK | `https://dapi.kakao.com/v2/maps/sdk.js?appkey=JS키&autoload=false` | (브라우저) | `Map`, `LatLng(위도, 경도)`, `Marker`, `InfoWindow`, `LatLngBounds` |

- 카테고리 코드: `CE7` 카페 · `FD6` 음식점 · `CS2` 편의점 · `PM9` 약국 · `HP8` 병원 · `SW8` 지하철역 · `PK6` 주차장 · `MT1` 대형마트 · `BK9` 은행 · `AT4` 관광명소 · `CT1` 문화시설
- 표에 없는 API, 브라우저 `services` 라이브러리, 구글·네이버 지도 API는 쓰지 않는다. 필요하면 이름·주소·키 필요 여부를 먼저 말하고 확인받는다. → 검사: 코드에 `services`, `googleapis`, `naver` 없음

### 에러 읽는 법
| 이럴 때 | 뜻 | 화면 안내 |
| --- | --- | --- |
| 401 | REST 키가 틀림 (JS 키를 넣은 경우가 많음) | "카카오 REST API 키가 틀렸어요" |
| 403 `disabled OPEN_MAP_AND_LOCAL service` | 카카오맵 사용 설정 OFF | "카카오맵 사용 설정을 켜 주세요" |
| `documents`가 빈 목록 | 그런 장소·주소 없음 | "'○○'을(를) 찾지 못했어요" |
| 지도 자리에 회색 네모 | JS 키·도메인·사용 설정·file:// 중 하나 | 지도 HTML의 안내 문장 |

## 실수에서 배운 규칙
<!-- - (10/23) ___ (왜: ___) → 검사: ___ -->
