# 카카오 지도 · 판다스 규칙 (D8 오전 + 14시)

> 이 내용을 **`git-practice/d8-map/CLAUDE.md`** 에 붙여 넣으세요. (D7 키 금고 규칙은 그대로 + 오늘 추가)
> 오늘은 **파이썬이 장소를 찾고(REST 키), 지도는 브라우저가 그려요(JavaScript 키).**
> 줄마다 (왜)와 → 검사가 있어요. 규칙 한 줄 = 검사 한 줄.

---

## 두 개의 열쇠 규칙
- 장소 검색·주소↔좌표는 **파이썬**에서 `KAKAO_REST_API_KEY`로만 부른다. 헤더 `Authorization: KakaoAK 키`. (왜: REST 키는 금고 키) → 검사: 코드에서 REST 키를 `os.getenv`로만 읽음
- **REST API 키는 HTML·`map.html`·Streamlit 화면 어디에도 넣지 않는다.** (왜: 브라우저로 가면 누구나 봄) → 검사: `map.html`을 열어 REST 키 앞 6글자 검색 → 0건
- 지도 그림에는 `KAKAO_JS_KEY`(JavaScript 키)만 쓴다. 이 키는 `.env`에서 읽어 HTML을 만들 때 넣는다. (왜: JS 키는 브라우저로 가는 게 정상. 대신 카카오 콘솔의 **JavaScript SDK 도메인**에 등록한 주소에서만 켜짐) → 검사: `.env`에 두 키가 다른 값으로 있음
- 브라우저 쪽 장소 검색(`libraries=services`)은 쓰지 않는다. 검색은 파이썬이 한다. (왜: 오늘은 "검색은 파이썬, 그림은 브라우저" 구조 연습) → 검사: HTML에 `services` 없음
- `.env`를 만들거나 열어 보여 주지 않는다. 새 키 이름은 `.env.example`에만 추가하고 값은 사용자가 직접 넣는다. (왜: 대화에 키가 남으면 안 됨) → 검사: 대화에 키 값이 한 번도 안 나옴
- 요청 주소·헤더·`response.url`·`res.text` 를 출력하지 않는다. (왜: OpenWeather는 주소에, 카카오는 헤더에 키) → 검사: 키를 틀리게 하고 실행해 출력 전체 확인

## 좌표 규칙
- 카카오 응답의 **`x` = 경도, `y` = 위도**이고 **글자**다. 꺼낼 때 `float()`로 바꾸고 이름을 `위도`·`경도`로 붙인다. (왜: x·y를 뒤집으면 마커가 바다에 찍힘) → 검사: 서울 좌표가 (37.x, 127.x)
- 지도 SDK에는 `new kakao.maps.LatLng(위도, 경도)` 순서로 넣는다. 요청을 보낼 때는 `x=경도, y=위도`. (왜: 방향마다 순서가 반대) → 검사: 마커가 실제 장소 위에 있음
- 한국 밖 좌표(위도 33~39, 경도 124~132 밖)는 잘못된 값으로 보고 쓰지 않는다. (왜: 뒤바뀐 좌표·0 좌표 걸러내기) → 검사: 좌표 하나를 일부러 뒤집어 실행
- `road_address`(도로명) 칸은 비어 있을 수 있다(null). 없으면 지번 주소를 쓴다. (왜: 첫 결과에 도로명이 없을 때 멈추지 않게) → 검사: 산·공원 같은 곳으로 좌표→주소

## 지도 HTML 규칙
- `map.html`은 파이썬이 만들고, **`d8-map` 폴더에서 `python -m http.server 8000 --bind 127.0.0.1`** → `http://localhost:8000/map.html`로 연다. 더블클릭(file://)으로 열라고 안내하지 않는다. `--bind 127.0.0.1`을 절대 빼지 않는다. (왜: JS 키는 등록한 주소에서만 켜짐 / bind 없이 켜면 같은 와이파이의 누구나 이 폴더의 `.env`를 받아 갈 수 있음) → 검사: 안내 문장에 `--bind 127.0.0.1`
- SDK는 `https://dapi.kakao.com/v2/maps/sdk.js?appkey=JS키&autoload=false` + `kakao.maps.load(...)`. 지도 아래에 "지도가 회색이면: ① 카카오맵 사용 설정 ② 지금 주소(포트까지) 등록 ③ 서버 주소로 열기" 안내 한 줄을 **항상** 보여 준다. (왜: 도메인 미등록일 때는 SDK 파일이 정상으로 받아져 코드가 실패를 알아채지 못하고 회색 네모만 남음) → 검사: 안내 줄이 보임
- 장소 이름은 `textContent`로 넣고, 데이터는 `json.dumps`로 넣는다. (왜: 이름에 따옴표·태그가 있어도 화면이 안 깨지게) → 검사: 이름에 `"` 가 든 장소
- 마커가 여러 개면 `LatLngBounds`로 전부 보이게 맞춘다. 마커는 200개까지만. (왜: 너무 많으면 느려짐) → 검사: 마커가 다 화면 안에
- `map.html`은 `.gitignore`에 넣는다. (왜: 실행할 때마다 새로 만드는 결과물) → 검사: `git status`에 안 보임

## Streamlit 규칙 (미션 ⑤, 오후)
- 실행은 `streamlit run 파일.py`. 지도 HTML은 **`st.iframe(html글자, height=...)`** 로 넣는다. `st.components.v1.html`은 쓰지 않는다. (왜: Streamlit 새 버전에서 components.html은 없어지는 중이라 경고가 남) → 검사: 코드에 `components.v1` 없음
- 카카오 콘솔 JavaScript SDK 도메인에 `http://localhost:8501`을 등록했는지 실행 안내에 적는다. `localhost:8502`·Network URL(IP)·`127.0.0.1`로 열면 안 뜬다는 것도. (왜: 등록한 주소에서만 지도가 켜짐) → 검사: 안내 문장
- `.env`를 읽을 때 `load_dotenv(override=True)`, 그리고 `.env`를 고치면 **`Ctrl+C` 후 다시 `streamlit run`** 하라고 안내한다. 에러 결과는 캐시하지 않는다(캐시 함수 안에서 에러면 예외를 내고 밖에서 받기). (왜: 키를 고쳐도 옛 값·옛 에러가 10분간 남음) → 검사: 키를 틀렸다 고친 뒤 재시작해 봄
- 날씨 설명 같은 글자는 `st.metric`의 변화량 자리에 넣지 않는다(`st.caption`으로). (왜: 초록·빨강 화살표가 붙어 숫자 변화처럼 보임) → 검사: 화살표 없음
- `requirements.txt`에 `streamlit>=1.66`. (왜: `st.iframe`은 새 버전 기능) → 검사: `streamlit --version`
- API 함수에 `@st.cache_data(ttl=600)`. 표·숫자는 `st.dataframe`, `st.metric`. 에러는 `st.error("한국어 한 줄")`. (왜: 클릭마다 재실행) → 검사: 슬라이더를 여러 번 움직여 봄

## 판다스 규칙 (14시)
- 동네로 거를 때는 **시·도까지 붙인 이름**(`"서울특별시 강남구"`)으로 거른다. (왜: `"남구"`는 `"강남구"`에도 들어 있고, `"중구"`는 여러 도시에 있음) → 검사: 걸러진 주소 앞부분이 모두 같음
- CSV는 `utf-8-sig` → `cp949` 순서로 시도해 읽고, 어떤 인코딩으로 읽었는지 출력한다. (왜: 공공데이터는 둘 다 있음. 한쪽만 쓰면 UnicodeDecodeError) → 검사: 출력에 인코딩 이름
- 읽은 뒤 항상 **줄 수·칸 수·빈칸 개수**부터 보여 준다(`shape`, `isna().sum()`). (왜: 데이터를 보기 전에 분석하지 않기) → 검사: 출력 첫 줄들
- 숫자 칸은 `pd.to_numeric(..., errors="coerce")`로 바꾸고, "무료" 같은 글자는 먼저 0으로 바꾼다. (왜: 글자 숫자는 합계·평균이 안 됨) → 검사: 평균 요금이 숫자로 나옴
- 칸 이름은 **파일에 실제로 있는 이름**만 쓴다. 모르면 `df.columns`를 먼저 출력해 확인한다. 새 칸(예: `주소`)은 사용자가 "새로 만들어"라고 했을 때만 만든다. `데이터기준일자`는 남긴다(화면에 기준일 표시). (왜: AI가 칸 이름을 지어내기 쉬움) → 검사: KeyError 없음
- 빈 좌표를 카카오로 채울 때는 **최대 30줄**, 한 번 부를 때마다 `time.sleep(0.1)`, 키·설정·연결 에러(에러 문장이 `⛔`로 시작)가 나면 바로 멈춘다. (왜: 쿼터·예절, 틀린 키로 수천 번 부르지 않게) → 검사: 코드에 한도·sleep·멈춤
- 저장은 `encoding="utf-8-sig"`, `index=False`. 원본 CSV(`*_raw.csv`)는 `.gitignore`. (왜: 엑셀에서 한글이 안 깨지게, 큰 원본은 레포에 안 올림) → 검사: 엑셀로 열어 봄
- 개수·평균 같은 숫자는 **코드로 계산**하고, 하나는 사람이 엑셀 필터로 검산할 수 있게 어떤 조건으로 셌는지 적는다. (왜: AI 숫자는 검산한다) → 검사: 조건이 출력에 있음

## 공통 규칙 (D7과 같음)
- API 주소는 파일 맨 위 `API = {...}` 한 곳 + `# 🔌`, 요청 줄에 `# 🔌 API 호출`. `requests.get(..., timeout=10)`, 실패는 한국어 한 줄. 출력 맨 아래 출처. → 검사: Ctrl+F 🔌, 출처
- 새 패키지는 `requirements.txt`에 추가하고 설치 명령은 제안만. 커밋·푸시는 하지 말고 메시지만 제안, 커밋 전 `git status` 보여 주기. → 검사: import와 requirements.txt 짝

## 쓸 수 있는 API (10/22 문서 확인)
| 미션 | API | 주소 | 보내는 값 | 주요 칸 |
| --- | --- | --- | --- | --- |
| ① ④ ⑤ | 키워드로 장소 검색 | `https://dapi.kakao.com/v2/local/search/keyword.json` | `query`, (선택) `x`·`y`·`radius`(m, 최대 20000)·`sort=distance`, `category_group_code`, `size`(최대 15) | `documents[i].place_name`, `road_address_name`, `address_name`, `x`, `y`, `phone`, `category_name`, `place_url`, `distance` |
| ⑤ | 키워드 검색 + 카테고리 (오늘 데모 방식) | `https://dapi.kakao.com/v2/local/search/keyword.json` | `query`(예: 카페) + `category_group_code` + `x`, `y`, `radius`, `sort=distance` | 위와 같음 |
| (참고) | 카테고리로 장소 검색 (검색어 없이) | `https://dapi.kakao.com/v2/local/search/category.json` | `category_group_code`, `x`, `y`, `radius` | 위와 같음 |
| ② | 주소로 좌표 변환 | `https://dapi.kakao.com/v2/local/search/address.json` | `query` | `documents[0].x`, `y`, `address_name` |
| ② | 좌표로 주소 변환 | `https://dapi.kakao.com/v2/local/geo/coord2address.json` | `x`(경도), `y`(위도) | `documents[0].road_address.address_name`(없을 수 있음), `address.address_name` |
| ③ ⑤ | 카카오 지도 JavaScript SDK | `https://dapi.kakao.com/v2/maps/sdk.js?appkey=JS키&autoload=false` | (브라우저) | `kakao.maps.Map`, `LatLng(위도, 경도)`, `Marker`, `InfoWindow`, `LatLngBounds` |
| ⑥ | OpenWeather 현재 날씨 | D7 규칙 그대로 | `lat`, `lon`, `appid`, `units=metric`, `lang=kr` | `main.temp`, `weather[0].description` |

- 헤더는 모두 `Authorization: KakaoAK {REST API 키}`
- 카테고리 코드: `CE7` 카페 · `FD6` 음식점 · `CS2` 편의점 · `PM9` 약국 · `HP8` 병원 · `SW8` 지하철역 · `PK6` 주차장 · `MT1` 대형마트 · `BK9` 은행 · `AT4` 관광명소 · `CT1` 문화시설

### 에러 읽는 법
| 이럴 때 | 뜻 | 화면 안내 |
| --- | --- | --- |
| 401 | REST 키가 틀림 (JS 키를 넣은 경우가 많음) | "카카오 REST API 키가 틀렸어요" |
| 403 `disabled OPEN_MAP_AND_LOCAL service` | 카카오맵 사용 설정 OFF | "카카오맵 사용 설정을 켜 주세요" |
| `documents`가 빈 목록 | 그런 장소·주소 없음 | "'○○'을(를) 찾지 못했어요" |
| 지도 자리에 회색 네모 / 아무것도 없음 | JS 키·도메인·사용 설정·file:// 중 하나 | 지도 HTML의 안내 문장 |

- 브라우저 쪽 `services` 라이브러리, 구글 지도 API, 네이버 지도 API는 쓰지 않는다. 표에 없는 API는 먼저 이름·주소·키 필요 여부를 말하고 확인받는다. → 검사: 코드에 `services`, `googleapis`, `naver` 없음

## 실수에서 배운 규칙
<!-- AI 실수를 찾을 때마다 한 줄씩: - (10/23) (해라/하지 마라) ___ (왜: ___) → 검사: ___ -->
