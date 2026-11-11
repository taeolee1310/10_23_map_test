# 탕방 서비스 구조 (처음 온 사람용)

2026-11-08 기준. 이 문서 하나로 "데이터가 어디서 와서 어디로 가는지, 어느 파일이 무슨 일을 하는지"를 알 수 있게 쓴다. 세부 규칙은 저장소 `CLAUDE.md`, 사용법은 각 폴더 README에 있다.

## 1. 한 장 그림

```
[내 PC: 데이터 만들기]                          [Cloudflare: 백엔드]                 [Vercel: 프런트엔드]
 공공데이터·카카오·네이버                        Worker  tangbang-api                 사이트 tangbang.vercel.app
   │  (러스트 src/bin/, ego 브라우저)              ├ GET  /api/places  ◀──────────────── 화면이 목록을 받음
   ▼                                              ├ POST /api/report  ◀──────────────── 제보 창
 data/raw → collected → curated → merged          └ /admin/*  (관리 토큰)                  │
   │                                                    ▲   │                              ├ 카카오 지도 SDK(지도 그림·마커)
   ▼                                                    │   ▼                              ├ 브라우저 위치(내 주변, 저장 안 함)
 web/public/data/onsen.json ──(초안 올리기·공개)──▶ D1 DB  tangbang                       └ /api/favs (담아둔 곳 백업 쿠키)
   │       ▲                                         places(초안) snapshots(공개본)
   │       └ 클로드용 수집 프로그램(별도 저장소)       reports(제보) visits(방문자 수)
   └ 같은 파일이 사이트에도 들어감 → Worker가 안 될 때 대신 읽는 비상용
```

## 2. 세 갈래가 따로 움직인다

| 무엇을 바꾸나 | 어떻게 사용자에게 나가나 | 담당 |
|---|---|---|
| **화면 코드** (`web/src`) | GitHub `main`에 푸시 → Vercel이 자동 빌드·배포(1~2분) | 프런트엔드 |
| **목욕탕 데이터** (요금·좌표·정보) | 초안 올리기 → 차이 보기 → **공개** 버튼 → 사용자 화면은 1분 안에 새 데이터 | 백엔드(D1) |
| **Worker 코드** (`worker/src`) | `worker` 폴더에서 `npx wrangler deploy` (푸시로는 안 올라감) | 백엔드 |

데이터만 바뀌면 푸시가 필요 없다. 화면 코드만 바뀌면 공개 버튼이 필요 없다.

## 3. 사용자가 사이트를 열면

1. Vercel이 화면 파일을 준다.
2. 화면(`web/src/lib/api.ts` `fetchPlaces`)이 Worker `/api/places`에 목록을 달라고 한다. 6초 안에 못 받으면 사이트 안의 `onsen.json`(비상용, 마지막으로 커밋한 데이터)을 읽는다.
3. Worker(`worker/src/index.js` `getPlaces`)는 D1의 **공개본 한 벌**을 준다. 매번 DB를 뒤지지 않고 Cloudflare 캐시에 둔 것을 준다(공개하면 번호가 바뀌어 새 것을 읽음). 같은 요청에서 방문자 수를 센다(아래 5).
4. 화면이 목록·지도·숫자를 **한 목록**에서 만든다(`MainScreen.tsx`: `filtered` → `nearby` → `inside` → `view`). 지도 그림은 카카오 SDK가 그리고, 좌표는 우리 데이터다.

## 4. 화면 기능과 위치

| 기능 | 어떻게 동작하나 | 코드 |
|---|---|---|
| 필터(지역·확인된 곳·담아둔 곳·검색) | 브라우저 안에서 거름. 기본은 '확인된 곳'만 | `lib/onsen.ts` `filterPlaces` |
| **추천순** | 정보 점수(확인 요금 3, 최근 1년 확인 1, 수건·드라이기·세신·사진·영업시간·가기 전 알아 둘 것 각 1 = 최대 10점). 내 위치를 알면 `점수 ÷ (1 + 거리km/2)`. 같으면 가까운 순 → 이름순. 인기·광고·별점은 안 씀 | `lib/onsen.ts` `infoScore` `recommendScore` `sortPlaces` |
| 가까운 순 | 내 위치와 직선거리 | 같은 파일 `sortPlaces` |
| 이름순 | 내 위치를 알면 **반경 3km 안만** 가나다순(`NEAR_KM`), 모르면 구 → 이름 | `lib/onsen.ts`, `MainScreen.tsx` `nearOnly` |
| 내 주변 목욕탕 | 브라우저 위치 기능(허락 필요, HTTPS에서만). 위치는 서버로 안 보냄 | `MainScreen.tsx` `locate` `goNear` |
| **담아둔 곳** | 브라우저 저장(localStorage `onsen_fav`) + 서버 쿠키 백업(`/api/favs`, 400일). 사파리가 7일 뒤 브라우저 저장을 지워도 쿠키에서 되살림. **접속 주소(IP)와 무관.** 다른 기기로는 안 옮겨짐(로그인 없음) | `MainScreen.tsx` `favs`, `web/api/favs.js` |
| 제보(요금·수건·드라이기·세신) | 제보 창(그 목욕탕의 정보 카드 모양: 확인된 칸은 채워져 있고 모르는 칸은 점선 빈칸, 누르면 그 자리에서 채우고 채울 때마다 탕에 물이 차오름. 확인된 값은 `PlaceFacts` `reportKnown`이 넘김. 보내는 내용은 예전 폼과 같음) → Worker `/api/report`가 검사(값 범위·연락처 가림·기기당 하루 5건·주소당 하루 15건) → D1 `reports`. **화면에 바로 안 나감** | `components/PriceReport`, `worker/src/index.js` `postReport` |
| **제보함**(운영자용, 내 PC 전용. 서비스에 올리지 않음) | `cargo run --release --bin report_desk` → `http://127.0.0.1:8765`. 새 제보(상태 new)가 들어온 업체만 묶어 칩(새 정보·인상 가능성·확인값과 다름·충돌·이미 반영됨·반려 추천·시험)과 함께 보여 주고, 제보 값과 지금 화면 값을 나란히 놓는다. 칸 옆에 수집해 둔 네이버 근거(`data/collected/naver_home_facts.csv`)를 보여 주고, 사람이 `맞음`·`다름`을 고른 칸만 `data/curated/`(`onsen_prices.csv`·`place_facts.json`)에 적고 제보 상태·검토 메모를 바꾼다. 반려·확인 못 함은 상태만 바꾼다. 판정은 확인 창 없이 처리하고 직전 한 번을 '되돌리기'로 돌린다. 시험·반려 추천·이미 반영됨은 '한 번에 정리'로 처리한다. 허위·의심 기준 숫자는 `data/report_rules.json`(입장료 3천 원 미만·4만 원 이상 허위, 3만 원 이상·확인값의 절반/두 배 의심). '화면에 내보내기'(`export_web_data` → `ingest` → `diff`)로 차이를 본 뒤 '공개'를 눌러야 사용자 화면에 나간다. 제보 읽기·상태·공개는 `d1_publish.mjs --json`을 부르고 토큰은 다루지 않는다. `--demo`는 가짜 제보로 화면만 보는 모드(아무것도 안 바뀜). 요구사항 `docs/prd-report-triage.md` | `src/bin/report_desk.rs`, `src/reportdesk.rs`(규칙·시험), `src/report_desk.html` |
| 데이터 기준일·출처 | 화면 맨 아래. "실시간"이라고 쓰지 않음 | `MainScreen.tsx` 아래쪽 |
| **매거진** (`/magazine`, `/magazine/<글 번호>`) | 목욕 이야기 읽을거리(지도 없음). 글 주소는 서버가 매기는 글 번호라 제목을 고쳐도 링크가 안 깨진다(첫 글만 예전 영문 주소도 열림). 웹(821px 이상)은 본문을 CSS 다단으로 흘려 두 쪽씩 넘기는 책, 모바일은 세로 스크롤. 공개된 글이 있을 때만 메인 상단 '매거진' 버튼·상세의 '이 목욕탕 이야기'·안내 마지막 단계(키 v4)가 나온다 | `screens/Magazine/Magazine.tsx`, `lib/stories.ts`, `App.tsx`(주소 나누기), `web/vercel.json`(새로고침해도 열리게) |
| **매거진 작성** (`/magazine/write`) | 운영자 전용. 어디에도 링크하지 않고 편집 토큰을 넣어야 열림(검색 제외). 제목·카테고리·글쓴이·요약·대표 사진 주소·본문·나온 목욕탕을 쓰고 임시 저장 → 공개 → 내리기. 오른쪽에 모바일 미리보기. 대표 사진은 '사진 고르기', 본문 사진은 '본문에 사진 넣기'(커서 자리에 `![](주소)` 한 줄)로 올린다. 브라우저가 가로 1600px JPEG로 줄여(위치 정보 제거) 올린다. 주소를 붙여 넣는 방식도 그대로 된다 | `screens/Magazine/Editor.tsx`, `lib/photos.ts`(줄이기·올리기) → Worker `/api/editor/stories`·`/api/editor/photos` |

## 5. 백엔드(Cloudflare) 표와 할 일

D1 표(`worker/schema.sql`):

| 표 | 내용 | 누가 쓰나 |
|---|---|---|
| `places` | 초안(올렸지만 아직 공개 안 한 데이터) | 관리 도구 `ingest` |
| `snapshots` | 공개본 전체 JSON(최근 30개, 되돌리기용) | `publish` / `rollback` |
| `meta` | 지금 공개 중인 공개본 번호 등 | Worker |
| `reports` | 사용자 제보(상태: new·reviewed·applied·rejected) | 사이트 → 운영자가 확인 |
| `visits` | 하루 방문자 수. 사람마다 (접속 주소+브라우저+날짜) 해시 하나, 원래 주소 저장 안 함, 90일 뒤 지움. 서비스 화면에서 온 요청만 셈 | Worker `countVisit` |
| `events` | 핵심 행동 횟수 10가지(내 주변·정렬 3종·자세히 보기·담아두기·제보 창 열기·제보 완료·매거진 열기·글 끝까지 읽기). 이름만 저장(어떤 목욕탕인지·위치·입력한 글은 저장 안 함), 사람은 visits와 같은 해시, 같은 사람 같은 행동은 하루 200번까지만, 90일 뒤 지움. 브라우저의 '추적 안 함'이 켜져 있으면 안 보냄 | 화면 `lib/track.ts` → Worker `/api/event` |
| `stories` | 매거진 글(임시 저장·공개·내림). 본문은 글자만(빈 줄=문단, `---`=장 나누기, `## `=소제목·장 제목, `> `=인용, `![설명](https://…)`=사진), HTML·script 거절. 장은 사진과 글을 묶는 단위다. 장 나누기 바로 다음 사진이 '장 여는 사진'이고(`ArticleBody`), 책에서는 왼쪽 쪽 전체가 그 사진·오른쪽 쪽이 글이다. 글이 한 쪽에 다 안 들어가는 장(낮은 화면)은 사진을 줄여 같은 쪽에 글을 잇고, 사진이 오른쪽 쪽에 걸리면 앞에 빈 쪽을 둔다(`Book` `count`). 책장은 세로 띠 4개가 휘며 넘어가고(`Strips`·`flipFrames`), 쪽 어디서나(링크·버튼 위 제외) 끌어도 넘어가며(여백은 누르기만 해도 넘어감, 반 넘게 끌거나 빠르게 밀면 넘어가고 아니면 돌아옴, 마우스를 올리면 장 끝이 살짝 들림, `grabProps`·`scrub`), 책 아래 장 이름을 누르면 그 장으로 간다. 모바일은 사진이 화면 양끝까지, 맨 위에 읽은 만큼 차는 선, 사진·장 번호·장 제목이 들어올 때 한 번 떠오른다(`Scroll`). 목록은 가장 최근 글 한 편을 크게 보여 준다. 모바일(820px 이하)에서 홈(지도 화면) ↔ 매거진 이동은 하단 네비게이션 바(`components/BottomNav`, 탭은 `TABS`에 한 줄씩 더한다)가 맡는다: 지도 화면에서는 공개된 글이 있을 때만 보이고, 매거진의 위쪽 메뉴는 모바일에서 숨긴다. 독자 화면은 글자 선택·복사·오른쪽 버튼 메뉴·그림 끌어 저장을 막는다(`mag--lock`, 작성 화면 제외. 화면 캡처·개발자 도구는 못 막음). 작성 화면 장 목록이 장별 사진·글자·쪽 수를 보여 주고(`lib/stories.ts` `chaptersOf`, `Book` `onLayout`), 웹 미리보기 무대는 독자 화면에서 책이 가장 클 때(1120×800)와 같다. 작성 화면 본문은 독자 화면 모양 그대로 쓰는 편집기(`screens/Magazine/RichBody.tsx`, 도구 막대: 사진·장 나누기·장 제목·인용·본문)이고 저장은 같은 글자 형식이다. '글자로 고치기'로 글자 형식을 직접 고칠 수 있다. 글쓰기 기준은 `/magazine-write` 스킬 | 작성 화면 → `/api/editor/stories`(편집 토큰 `EDITOR_TOKEN`), 공개 글은 `/api/stories` |
| `publish_log` | 공개·되돌리기 기록 | Worker |
| R2 `tangbang-photos` (binding `tangbang_photos`) | 매거진 사진. JPEG·PNG·WebP만(앞부분 바이트로 확인), 5MB 이하, 키는 `UUID.확장자`(사용자 파일 이름 안 씀). 읽기 `GET /api/photos/<키>`는 토큰 없이 공개(1년 캐시). 목록 API는 없고, 공개 전 글의 사진도 주소를 알면 열린다(주소가 추측하기 어려운 UUID라서 허용) | 작성 화면 → `POST /api/editor/photos`(편집 토큰, 틀린 횟수 제한은 글 저장과 같음) |

공개 전 자동 검사: 필수 칸, 서울 밖 좌표, 성인업소 이름, 휴대폰 번호 모양, 확인 요금과 예시 요금 동시 존재, 크기 1.5MB, 곳 수 10% 넘게 감소. 공개는 한 묶음이라 중간에 실패하면 전부 취소된다.

무료 한도(Workers 하루 10만 요청, D1 하루 읽기 500만·쓰기 10만 행)는 방문자 300명이면 1~3% 수준이다. 넘으면 한국 시간 오전 9시에 풀리고, 그동안 화면은 비상용 파일로 뜬다.

## 6. 운영자가 쓰는 명령 (프로젝트 폴더에서)

```
node --env-file=.env scripts/d1_publish.mjs status      # 공개본·초안·새 제보·오늘/어제 방문자
node --env-file=.env scripts/d1_publish.mjs stats 14    # 날짜별 방문자 수(DAU)·제보 수 + 핵심 행동별 사람 수·횟수
node --env-file=.env scripts/d1_publish.mjs ingest      # 초안 올리기
node --env-file=.env scripts/d1_publish.mjs diff        # 무엇이 바뀌나
node --env-file=.env scripts/d1_publish.mjs publish     # 공개
node --env-file=.env scripts/d1_publish.mjs rollback    # 직전 공개본으로
node --env-file=.env scripts/d1_publish.mjs reports     # 새 제보 (확인·반영 절차는 /price-report)
cargo run --release --bin report_desk                   # 제보함: 새 제보를 화면으로 보고 근거 확인 → 반영·반려 → 공개 (http://127.0.0.1:8765, 내 PC 전용)
```
클로드용 수집 프로그램의 '서비스 공개' 카드가 같은 명령을 버튼으로 부른다.

## 7. 데이터가 만들어지는 길 (내 PC)

`data/README.md`에 자세히 있다. 요약: 공공데이터(인허가·온천) + 카카오 좌표 → 네이버 플레이스·후기·블로그를 ego 브라우저로 저장 → 러스트 `judge_facts`가 요금·수건·드라이기·세신·가기 전 알아 둘 것을 판정 → 사람이 확인한 값(`data/curated/`)이 항상 이김 → `onsen_merge` → `export_web_data` → `web/public/data/onsen.json` → 초안 올리기·공개. 이 흐름을 버튼 하나로 돌리는 것이 클로드용 수집 프로그램(별도 저장소 `tangbang-collector`)이다.

## 8. 점검·시험

| 무엇 | 명령 |
|---|---|
| Worker 전체(공개·되돌리기·검사·제보·방문자 수·행동 기록·매거진·사진 올리기, 116개) | `node worker/test/run-local.mjs` |
| 추천순·담아둔 곳 백업 | `web`에서 `npm run check` |
| 화면 타입 검사·빌드 | `web`에서 `npm run build` |

## 9. 아직 없는 것 (알고 있는 한계)

- 로그인이 없어 담아둔 곳을 다른 기기로 옮길 수 없다.
- 매거진 사진은 올린 뒤 글에서 빼거나 글을 지워도 R2에 남는다(사진을 지우는 기능과 안 쓰는 사진 정리는 아직 없음). 공유할 때 글마다 다른 미리보기(제목·사진)는 아직 안 나온다(화면이 한 페이지 앱이라 서버에서 글별 미리보기 정보를 만들어야 함).
- 매거진 글꼴(Noto Serif KR·EB Garamond)은 서비스의 다른 화면에는 없는 글꼴이다(시안 기준, 바꾸려면 `Magazine.css` 맨 위 두 변수).
- 매거진, 점수·배지 같은 참여 기능은 아직 없다.
- 비상용 `onsen.json`은 커밋할 때만 바뀐다. 공개 버튼으로 바꾼 최신 데이터와 다를 수 있다(Worker가 멈췄을 때만 쓰임).
- 방문자 수는 같은 사람이 와이파이↔데이터를 바꾸면 2명으로 셀 수 있다(어림값).
- 어느 화면에 얼마나 머물렀는지(체류 시간)와 방문 경로는 안 센다. 페이지 조회·접속 국가·기기·로딩 속도는 **Cloudflare Web Analytics**(무료, 쿠키 없음)를 대시보드에서 켜고 `web/index.html`에 안내받은 스크립트 한 줄을 넣으면 볼 수 있다(아직 안 켬).
- `/api/event`는 서비스 화면 주소(Origin)만 세지만, 헤더를 흉내 내는 호출까지 막지는 못한다. 쓰기 한도(하루 10만)를 일부러 태우는 반복 호출은 아직 막는 장치가 없다.
