# 탕방 데이터 수집 도구

내 컴퓨터(윈도우·맥)에 설치해서 쓰는 데스크톱 프로그램이다. '수집 시작'을 누르면 네이버 플레이스 페이지를 ego 브라우저로 받아 탕방 화면 데이터(`web/public/data/onsen.json`)까지 만든다. 서비스(Vercel)에는 올라가지 않는다(`.vercelignore`).

## 처음 한 번 (새 PC)

| 순서 | 윈도우 | 맥 |
| --- | --- | --- |
| 1. 프로젝트 받기 | `git clone` | `git clone` |
| 2. 데이터 도구(러스트) | `powershell -ExecutionPolicy Bypass -File scripts\setup.ps1` | `sh scripts/setup.sh` |
| 3. 프로그램 만들기 | `powershell -ExecutionPolicy Bypass -File scripts\build-app.ps1` | `sh scripts/build-app.sh` |
| 4. 설치 | 끝에 나온 `.exe`를 실행 | 끝에 나온 `.dmg`를 열어 응용 프로그램으로 끌어 넣기 |
| 5. 준비 | ego lite 설치, Claude Code 설치 후 터미널에서 `claude`로 로그인 | 같음 |

프로그램을 처음 열면 **프로젝트 폴더**를 한 번 고른다(이 폴더). 그다음부터는 기억한다.

## 화면

- **처음 열 때 안내**(8단계 스포트라이트, 서비스와 같은 `web/src/components/Onboarding`): 준비 상태 → 폴더 → 수집 방법 → 수집 시작 → 진행 단계 → 대시보드 지표 → 다음에 할 일 → 숫자 다시 읽기. 머리말 '어떻게 사용하는 거예요?'로 다시 본다. 저장 키 `tangbang-collector:onboarding:v1`(흐름을 바꾸면 v를 올린다).

- **수집**: 준비 상태(프로젝트 폴더·러스트·ego·Claude Code·.env 있는지만), '수집 시작', 6단계 진행, 실행 기록. '단계별로 실행'에서 한 단계만 다시 돌릴 수 있다.
  - **Claude와 함께**(기본): Claude Code(`claude -p`, 허용 도구는 `ego-browser nodejs`와 `Read`뿐)가 `scripts/ego_fetch.mjs`를 실행하고 멈춘 이유를 알려 준다.
  - **직접 실행**: Claude 없이 같은 스크립트를 바로 실행한다.
  - **다시 받기**(안 함 / 30일 지난 곳 / 7일 지난 곳, 기본 30일): 마지막 수집일이 기준보다 오래된 곳의 홈·후기·블로그 탭을 오래된 곳부터 다시 받아 새 내용으로 바꾼다(`collect_home`·`collect_reviews --refresh-days N`). 새 곳과 합쳐 한 번에 150곳.
  - **예상 시간**: 받을 페이지 × 곳당 초(이 PC 최근 기록, 없으면 14초) + 묶음 준비 + 정리. 받는 중에는 실제 속도로 다시 센다.
- **사진 고르기**: 업체 등록 사진 후보(`data/collected/naver_photo_candidates.jsonl`) 중 대표 사진을 카드에서 고른다. 고르는 즉시 **서비스의 실제 목록 카드 컴포넌트(`web/src/screens/MainScreen/PlaceList`)와 같은 180px 썸네일 주소**로 미리 보여 준다. 저장은 `data/curated/place_photos.csv`(사람이 확인한 값, 바꾸기 전 `.bak`을 남김). '사진 없이 두기'도 확인 기록으로 남는다(사진URL 비움, 종류 '사진 없음'). '화면 데이터에 반영'이 `export_web_data`를 돌린다.
- **시계**: 머리말에 지금 한국 시간. 예상 끝나는 시각, 수집 신선도, 다시 받기 기준 날짜를 모두 한국 시간으로 센다(PC 시간대가 달라도 같음). 판정(`judge_facts`)의 '최근 1년' 블로그 기준도 실행한 날 기준이다.
- **대시보드**: 핵심 지표(요금 확인·TOP 3·네이버 연결·홈 수집·30일 안 수집), 다음에 할 일, 단계별 확보 현황, 항목별 채움률, 수집 신선도, 구별 커버리지(정렬), 장소 목록(검색·구·상태 필터), 이 PC의 수집 기록. '숫자 다시 읽기'는 파일을 다시 읽어 숫자만 새로 센다(수집하지 않음).

## 지키는 것

- 곳당 10초 간격, 한 번에 150곳, 캡차·'보안 확인'이 보이거나 3번 연속 빈 페이지면 멈춤. 우회하지 않는다(`scripts/ego_fetch.mjs`가 지키고 앱은 넘기지 않는다).
- `.env`는 있는지만 보고 열지 않는다. 요청 주소·헤더를 출력하지 않는다.
- `data/curated/`(사람이 확인한 값)는 덮어쓰지 않는다.

## 개발

- `collector/`에서 `npm run app:dev`(창이 뜨고 화면은 바로 고쳐 볼 수 있음), `npm run build`(타입 검사).
- 색·움직임은 `web/src/styles/tangbang-colors.css`·`motion.css`를 그대로 가져온다. semantic·component 토큰만 쓴다.
- 백엔드: `src-tauri/src/main.rs`. 대시보드 계산: `src/metrics.ts`.
