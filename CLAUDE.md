# 탕방 · 서울 목욕탕·사우나 지도 서비스 (React + Vite)

서울의 목욕탕·사우나·온천 464곳을 지도와 목록으로 보여 주고, 확인된 요금을 알려 주는 서비스. 화면은 React + Vite(`web/`), 데이터 정리는 판다스(파이썬 3개), 지도는 카카오 JavaScript SDK.
줄마다 (왜)와 → 검사가 있다. 규칙 한 줄 = 검사 한 줄.

## 환경
- 화면: Node, `web/`에서 `npm run dev`(주소 `http://localhost:5173`), `npm run build`(타입 검사 + 빌드). 설치 명령(`npm install` 등)은 제안만 하고 직접 돌리지 않는다.
- 데이터: Python 3.11, conda `myvenv`. 설치는 `pip install -r requirements.txt`(제안만).
- 터미널은 PowerShell(Windows). 시간은 KST. 서비스는 **서울 전용**이다.

## 구조
- `web/src/App.tsx` → `components/BathhouseIntro`(첫 화면) → `screens/MainScreen`(지도·목록·상세). 지도는 `components/KakaoMap`, 효과는 `components/GhostCursor`. 메인 화면 첫 안내(스포트라이트 온보딩 3단계)는 `components/Onboarding`이고, 첫 방문에만 열리며 '직접 확인한 곳만' 옆 '?' 사용법 버튼으로 다시 본다(인트로에는 넣지 않는다). 요금·가기 전 걱정 정보(수건·드라이기·세신 결제) 제보는 `components/PriceReport`(제보 창) → `web/api/report.js`(Vercel 서버 기능, 운영자 구글 시트에 Apps Script로 추가. 설정은 `docs/report-setup.md`). 제보는 화면에 바로 반영하지 않고 사람이 확인한 뒤 `data/curated/`에만 넣는다. 확인·반영 절차는 `/price-report`(`.claude/skills/price-report`).
- `web/src/styles/tangbang-colors.css`: 컬러 시스템. 색은 이 파일의 토큰만 쓴다. `web/src/styles/motion.css`: 움직임 곡선·길이.
- 화면이 읽는 데이터는 `web/public/data/onsen.json` 하나. 만드는 법과 자료 분류는 `data/README.md`.
  - `python onsen_merge.py` → `data/merged/onsen_merged.csv`
  - `python export_web_data.py` → `web/public/data/onsen.json`
- 수집은 ego-lite 브라우저로 한다. 새 수집 스크립트는 만들지 않는다. 새 자료는 `data/collected/`에 같은 칸으로 저장한다. **예외(사용자 허락, 2026-10-30)**: 네이버 홈 페이지 수집 `scripts/collect_home.py`·`scripts/find_naver_ids.py`(Scrapling)와 판정 `scripts/judge_facts.py`. 요청 제한을 피해 가는 방식(세션 새로 열기 등)은 쓰지 않고, 곳당 10초 간격·한 번에 150곳·연속 3회 실패 시 멈춤을 지킨다. 흐름은 `data/README.md`.
- 남아 있는 파이썬 연습 파일(`place.py`, `geo.py`, `make_map.py`, `factcheck.py`, `map.html`, `map_config.js`)은 React 화면과 무관하다.

## 두 개의 열쇠 규칙
- REST 키(`KAKAO_REST_API_KEY`)는 파이썬에서만 `os.getenv`로 읽는다. 헤더 `Authorization: KakaoAK 키`. (왜: REST 키는 금고 키) → 검사: `web/`에 REST 키 이름·값 없음
- **REST 키는 HTML·번들·화면 어디에도 넣지 않는다.** `vite.config.ts`의 `envPrefix: 'KAKAO_JS_'`를 바꾸지 않는다. (왜: 브라우저로 가면 누구나 봄) → 검사: `npm run build` 뒤 `dist`에서 REST 키 앞 6글자 검색 → 0건
- 지도에는 `KAKAO_JS_KEY`만 쓴다(`import.meta.env.KAKAO_JS_KEY`). (왜: JS 키는 브라우저로 가는 게 정상, 대신 카카오 콘솔에 등록한 주소에서만 켜짐) → 검사: `.env`에 두 키가 다른 값으로 있음
- 카카오 콘솔 JavaScript SDK 도메인에 `http://localhost:5173`(배포 주소 포함)을 등록한다. **`127.0.0.1`로 열면 지도가 안 뜬다.** 로컬 확인은 항상 `localhost:5173`. (왜: 등록한 주소에서만 켜짐) → 검사: 안내 문장
- `npm run dev`의 `--host 127.0.0.1`을 빼지 않는다. (왜: 빼면 같은 와이파이에서 프로젝트 파일을 받아 갈 수 있음) → 검사: `package.json`
- 브라우저 쪽 장소 검색(`libraries=services`)은 쓰지 않는다. → 검사: 코드에 `services` 없음
- `.env`를 열어 보여 주거나 값을 대화에 쓰지 않는다. 값은 사용자가 직접 넣는다. 새 키 이름은 `.env.example`에만 추가한다. (왜: 대화에 키가 남으면 안 됨) → 검사: 대화에 키 값이 안 나옴
- 요청 주소·헤더·`response.url`·`res.text`를 출력하지 않는다. (왜: 카카오는 헤더에 키) → 검사: 출력 전체 확인

## 좌표·지도 규칙
- 카카오 응답의 **`x` = 경도, `y` = 위도**이고 **글자**다. `float()`로 바꾸고 `위도`·`경도`로 이름 붙인다. 지도 SDK는 `new kakao.maps.LatLng(위도, 경도)` 순서. (왜: 뒤집으면 마커가 바다에 찍힘) → 검사: 서울 좌표가 (37.x, 127.x), 마커가 실제 장소 위에
- 한국 밖 좌표(위도 33~39, 경도 124~132 밖)는 쓰지 않는다. → 검사: 좌표 하나를 일부러 뒤집어 실행
- SDK 주소는 `KakaoMap.tsx` 맨 위 `API = {...}` 한 곳 + `# 🔌`. `autoload=false` + `kakao.maps.load(...)`. → 검사: Ctrl+F 🔌
- 지도가 안 뜨면 이유(사용 설정·등록 주소·키)를 한국어로 화면에 알려 준다. (왜: 회색 네모만 보이면 원인을 모름) → 검사: 키를 지우고 실행
- 장소 이름 같은 데이터는 `textContent`로 넣는다. 데이터를 `innerHTML`에 넣지 않는다. → 검사: 이름에 `"`·`<`가 든 장소
- 마커가 여러 개면 `LatLngBounds`로 전부 보이게 맞춘다. 마커는 200개까지만. 멀리서는 구별 묶음 마커. → 검사: 마커가 다 화면 안에

## 화면 규칙
- 목록·지도·숫자는 **필터한 하나의 목록**에서 만든다. (왜: 숫자와 지도가 다르면 신뢰를 잃음) → 검사: 필터 바꾸고 셋 비교
- 결과가 0개면 안내 문구를 보여 준다. → 검사: 필터를 극단으로
- 화면 맨 아래에 출처와 **데이터 기준일**. "실시간"이라고 쓰지 않는다. → 검사: 캡션
- 숫자는 코드로 계산한다. 화면 문구의 숫자는 변수에서 온다. 요금은 **확인된 것만 숫자로**, 추정은 "요금 미확인". → 검사: 문구 속 숫자 출처
- 색은 `tangbang-colors.css`의 semantic(`--color-*`)·component(`--button-*` 등) 토큰만 쓴다. primitive(`--tb-*`)는 화면 CSS에서 직접 쓰지 않는다. 기준 8색(`#FDF6D0` `#FFFDF5` `#342C25` `#57483B` `#527C77` `#A64B31` `#E8D9AE` `#E7A36E`)의 값은 바꾸지 않는다. 원천은 Figma `탕방 디자인 시스템`(파일 `ojmQos2N59L7GQE76L26J6`, 노드 `418:131`)이고, Bath Teal은 선택·포인트, Terracotta는 주요 버튼(CTA)에만 쓴다. 구조·명암비는 `docs/color-system.md`. 로고 캐릭터는 윤곽선 `--color-outline`, 물 `--color-water`, 김 `--color-steam`으로 칠하고, 인트로 그림 색(`--tb-cream-sun` `--tb-bottle-brown`)은 인트로에서만 쓴다. `--tb-character-blue`는 쓰지 않는다. 새 색 값을 직접 쓰지 않는다. → 검사: 새로 넣은 색이 토큰인지, 글자색은 4.5:1 이상인지
- **개발자가 확인하기 편하려고 만든 기능(설정 패널, `?preview`, 디버그 UI)은 사용자 화면에 넣지 않는다.** (왜: 서비스는 사용자에게 맞춰 만든다) → 검사: 화면에 보이는 컨트롤은 사용자 기능뿐
- 모션은 요청한 것만 넣는다. 마우스에 반응하는 효과는 사용자가 정한 것(고스트 커서)만. 모션 줄이기 설정(`prefers-reduced-motion`)을 지키고, 기기가 느리면 해상도를 자동으로 낮춘다. → 검사: 설정을 켜고 확인

## 인트로 에셋 규칙
- 인트로 에셋은 Figma `Bathhouse_Motion_v3 / 원본 질감 복원`(파일 `ojmQos2N59L7GQE76L26J6`, 노드 `381:2`)에서 받은 것만 쓴다. **임의로 합성하거나 새로 만든 에셋을 쓰지 않는다.** 압축·변환이 필요하면 픽셀이 같은지 확인하고 알린다. (왜: 사용자가 정한 원본 그림이 기준) → 검사: `web/src/assets/bathhouse/`의 파일이 Figma 에셋인지
- 레이어 순서를 지킨다: 창틀·스카이라인이 맨 앞, 구름·해는 그 뒤. 움직이는 레이어는 마스크로 쪼개지 말고 한 덩어리로 만들고 앞 레이어가 가린다. 모든 레이어는 같은 기준(1536×1024 무대)에 둔다. (왜: 쪼개면 창틀 양쪽이 다르게 움직이고 검은 선이 생김) → 검사: 움직이는 위치마다 확대해서 확인
- 물줄기(`stream-strip.png`)는 원본 일러스트에서 뽑은 질감 띠다. 원본이 바뀌면 다시 뽑는다.
- 예외: 수면을 떠다니는 오리(`duck-float-sheet.png`·`.json`, `BathhouseIntro/Duck.tsx`)는 Figma 에셋이 아니라 **사용자가 직접 지정해 준 스프라이트**다(2026-10-29). 오리는 장식이라 클릭을 막지 않고(`pointer-events: none`), 움직임 줄이기에서는 멈추며, 이동 구간은 수면(mask-water) 안으로만 둔다. 인트로에는 로고 캐릭터를 두지 않는다(배경음악은 첫 클릭·키 입력에 시작).
- 예외: CTA '목욕탕 찾아보기' 유리 버튼 그림(`web/src/assets/glass-button/glass-rim.webp`·`water-caustics.webp`, `BathhouseIntro/GlassWater.tsx`)도 Figma 에셋이 아니라 **사용자가 직접 지정한 에셋**이다(2026-10-31). 그림은 장식(`aria-hidden`)이고 글자·클릭·포커스는 바깥 `button`이 맡으며, 움직임 줄이기에서는 물결을 멈춘다.

## 판다스·데이터 규칙
- 데이터는 서울만 남긴다. 동네로 거를 때는 **시·도까지 붙인 이름**(`"서울특별시 강남구"`)으로 거른다. (왜: `"남구"`는 `"강남구"`에도 들어 있음) → 검사: 걸러진 주소 앞부분이 모두 같음
- 분류: `data/raw`(원본) · `collected`(수집) · `curated`(사람이 확인) · `merged`(합친 결과). **사람이 확인한 값은 `curated/`에만 두고** 스크립트가 덮어쓰지 않는다. → 검사: `data/README.md`
- CSV는 `utf-8-sig` → `cp949` 순서로 시도해 읽고, 읽은 인코딩을 출력한다. 저장은 `encoding="utf-8-sig"`, `index=False`. → 검사: 출력에 인코딩 이름
- 읽은 뒤 항상 줄 수·칸 수·빈칸 개수(`shape`, `isna().sum()`)부터 보여 준다. → 검사: 출력 첫 줄들
- 숫자 칸은 `pd.to_numeric(..., errors="coerce")`. "무료" 같은 글자는 먼저 0으로. → 검사: 평균 요금이 숫자로 나옴
- 칸 이름은 **파일에 실제로 있는 이름**만 쓴다. 모르면 `df.columns`를 먼저 출력한다. 새 칸은 사용자가 "새로 만들어"라고 했을 때만. `데이터기준일자`는 남긴다. → 검사: KeyError 없음
- 개수·평균은 **코드로 계산**하고 어떤 조건으로 셌는지 출력에 적는다. 엑셀 필터로 검산할 수 있게. → 검사: 조건이 출력에 있음
- 개인 이름·휴대폰 번호는 데이터에 넣지 않는다. 기관 대표번호는 둬도 된다. → 검사: 칸 목록
- 요금·영업 정보는 Claude가 직접 확인할 수 있는 것(네이버 플레이스 가격표, 공식 홈페이지, 공공데이터)으로만 확인한다. 전화 확인은 제안하거나 넘기지 않는다. 확정 못 하면 "확인 못 함"과 근거 출처를 보고한다. → 검사: 확인 못 한 곳은 "요금 미확인"
- 빈 좌표를 카카오 API로 채울 때는 **최대 30줄**, 호출마다 `time.sleep(0.1)`, `⛔`로 시작하는 에러가 나면 바로 멈춘다. → 검사: 코드에 한도·sleep·멈춤
- 삭제는 사용자가 말했을 때만, 지우기 전에 대상을 확인한다. 한 번 지우면 되돌릴 수 없는 파일(깃에 없는 원본)은 먼저 알린다. → 검사: 삭제 전 `git ls-files`

## 공통 규칙
- 새 패키지는 `requirements.txt`(파이썬) 또는 `web/package.json`(화면)에 추가하고 설치는 제안만. import와 파일이 짝이어야 한다.
- 커밋·푸시·머지는 사용자가 요청할 때만 한다. 하기 전에 `git status`를 보여 주고, 이번 작업과 관계없는 변경은 포함하지 않는다. 커밋 메시지는 한국어로 변경 이유를 쓴다.
- 조 작업: Issue 하나 = 브랜치 하나 = PR 하나. 남의 담당 파일은 고치지 않고, main에서 직접 작업하지 않는다. 각자 `.env`에 각자 키, 키를 Slack·Issue·PR에 붙이지 않는다.

## 쓸 수 있는 API
| 용도 | 주소 | 비고 |
| --- | --- | --- |
| 지도 JS SDK | `https://dapi.kakao.com/v2/maps/sdk.js?appkey=JS키&autoload=false` | 브라우저. `Map`, `LatLng(위도, 경도)`, `Marker`, `CustomOverlay`, `LatLngBounds` |
| 키워드 장소 검색 · 카테고리 검색 · 주소→좌표 · 좌표→주소 | `https://dapi.kakao.com/v2/local/...` | 파이썬에서만, REST 키. 카테고리 코드 `PK6` 주차장 등 |

- 표에 없는 API, 브라우저 `services` 라이브러리, 구글·네이버 지도 API는 쓰지 않는다. 필요하면 이름·주소·키 필요 여부를 먼저 말하고 확인받는다. → 검사: 코드에 `services`, `googleapis`, `naver` 없음

### 에러 읽는 법
| 이럴 때 | 뜻 | 화면 안내 |
| --- | --- | --- |
| 지도 자리에 회색 네모 | JS 키·도메인·사용 설정 중 하나 | 지도 영역의 안내 문장 |
| 403 `disabled OPEN_MAP_AND_LOCAL service` | 카카오맵 사용 설정 OFF | "카카오맵 사용 설정을 켜 주세요" |
| 401 | REST 키가 틀림 (JS 키를 넣은 경우가 많음) | "카카오 REST API 키가 틀렸어요" |
| `documents`가 빈 목록 | 그런 장소·주소 없음 | "'○○'을(를) 찾지 못했어요" |

## 실수에서 배운 규칙
- (10/28) 서울 전용으로 바꿀 때 코드·화면의 전국용 요소(시·도 필터, 문구, 지도 시작 위치)도 함께 정리한다. (왜: 데이터만 줄이면 화면에 전국 흔적이 남음) → 검사: `grep "전국\|sido"`
- (10/28) 사용자가 정한 에셋·구조와 다른 걸 임의로 만들지 않는다. 막히면 만들기 전에 묻는다. (왜: 엉뚱한 에셋이 나와 사용자가 놀람) → 검사: 새로 만든 에셋이 없는지
- (10/28) 사용자 화면에 개발자용 설정·미리보기를 넣지 않는다. (왜: 서비스는 사용자 기준) → 검사: 화면 컨트롤
- (10/28) 깃에 올린 적 없는 파일(`.gitignore`된 원본)은 지우면 복구할 수 없다. "되돌릴 수 있다"고 말하기 전에 `git ls-files`로 확인한다. (왜: 행안부 원본 CSV를 지우고 복구 가능하다고 잘못 안내함) → 검사: 삭제 전 추적 여부
