# 탕방 데이터 API (Cloudflare Worker + D1)

화면은 Vercel 그대로 두고, **데이터(공개 스냅샷)와 제보만 Cloudflare**가 맡는다. 설계서: "탕방 데이터 서비스 전환 설계서"(Claude Docs, 2026-11-06).

## 처음 한 번 (운영자)
```
powershell -ExecutionPolicy Bypass -File worker\setup.ps1
```
wrangler 설치 → Cloudflare 로그인(브라우저, 처음 한 번) → D1 `tangbang` 만들기 → 표 만들기 → 비밀 값(관리 토큰·제보 해시용) 넣기 → 배포 → 지금 `onsen.json` 올리고 공개 → 곳 수 확인 → `web/src/lib/api.ts`의 `API_BASE`에 Worker 주소 적기. 그 뒤 화면 변경을 커밋·푸시하면 Vercel 화면이 Worker를 읽는다.

## 평소 (수집이 끝난 뒤)
```
node --env-file=.env scripts/d1_publish.mjs ingest     # 초안 올리기(사용자 화면은 그대로)
node --env-file=.env scripts/d1_publish.mjs diff       # 무엇이 바뀌는지
node --env-file=.env scripts/d1_publish.mjs publish    # 공개(1분 안에 사용자 화면에 반영)
node --env-file=.env scripts/d1_publish.mjs rollback   # 잘못 공개했으면 직전 것으로
node --env-file=.env scripts/d1_publish.mjs reports    # 새 제보 보기
node --env-file=.env scripts/d1_publish.mjs stats 14   # 날짜별 방문자 수(DAU)·제보 수
```
- 매거진: 글은 `stories` 표. 공개 글은 `GET /api/stories`·`/api/stories/<주소>`, 작성은 서비스의 숨은 화면 `/magazine/write`가 `/api/editor/stories`(GET 목록·POST 저장)를 편집 토큰(`EDITOR_TOKEN`)으로 부른다. 편집 토큰은 글만 다루고 목욕탕 데이터 공개(`ADMIN_TOKEN`)는 못 한다. 처음 한 번 `node worker/setup-editor.mjs`가 토큰을 만들어 `.env`(`TANGBANG_EDITOR_TOKEN`)와 Worker 비밀 값에 넣는다(값은 출력 안 함).
- 핵심 행동: 화면(`web/src/lib/track.ts`)이 8가지 이름(`EVENTS`)만 `POST /api/event`로 보내고 `events` 표에 사람별 횟수로 쌓인다. `stats`가 행동별 사람 수·횟수를 보여 준다. 이름을 늘리려면 Worker `EVENTS`와 `track.ts`를 같이 고친다.
- 방문자 수: `/api/places`를 서비스 화면(허용 주소, localhost 제외)에서 부를 때마다 `visits` 표에 (접속 주소+브라우저+한국 날짜) 해시 하나로 센다. 원래 주소는 저장하지 않고 90일 뒤 지운다. 세기에 실패해도 목록 응답은 막지 않는다.
- 공개 전 자동 검증: 필수 칸·서울 밖 좌표, 성인업소 키워드 이름, 휴대폰 번호 모양(tel 칸·주소·이름·URL 제외), 확인 요금과 예시 요금이 함께 있음, 스냅샷 1.5MB 초과(D1 한 행 한도 2MB), 곳 수 10% 넘게 감소(`--force`로만 통과).
- 공개는 한 묶음(트랜잭션)이라 중간에 실패하면 전부 취소된다. `--expect`(수집 프로그램이 자동으로 넣음)로 화면이 본 공개본과 다르면 409로 막는다(다른 PC가 먼저 공개한 경우).
- 오류는 `--json`이면 `{code, message, fix}`로 나와 수집 프로그램 '서비스 공개' 카드가 그대로 보여 준다(접속 불가·토큰 어긋남·무료 한도·오래된 상태·검사 실패 등).
- D1은 LIKE/GLOB 패턴을 50바이트까지만 받는다(Node SQLite는 제한이 없어 시험이 못 잡으므로 `run-local.mjs`가 소스의 패턴 길이를 따로 검사한다).
- 사람이 확인한 값(`data/curated/`)은 지금처럼 러스트 `export_web_data`가 합친 뒤 올린다(DB에 따로 두지 않음, 설계서의 `curated_overrides` 표는 쓰지 않기로 단순화).
- 제보는 `reports` 표에 쌓이기만 하고 화면에 바로 나가지 않는다. 확인한 뒤 `data/curated/`에 넣는다.

## 시험
```
node worker/test/run-local.mjs
```
Cloudflare 없이 Node 내장 SQLite로 같은 SQL을 돌린다(73개 확인: 공개·304·CORS·되돌리기·검증·제보 제한·방문자 수·행동 기록·매거진 작성 권한·검사 등). 실제 D1의 한도·캐시는 흉내만 낸다.

## 구성
| 파일 | 내용 |
| --- | --- |
| `schema.sql` | 표 8개: places(초안) · snapshots(공개본) · meta · reports · visits(방문자 수) · events(핵심 행동) · stories(매거진) · publish_log |
| `src/index.js` | API. 공개용 `/api/places` `/api/report`, 관리용 `/admin/*`(Bearer 토큰) |
| `wrangler.toml` | 이름·D1 연결·허용 화면 주소(`ALLOWED_ORIGINS`). 비밀 값은 여기에 쓰지 않는다 |
| `setup.ps1` | 처음 한 번 설치·배포 |
| `../scripts/d1_publish.mjs` | 수집 PC의 관리 도구 |
