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
```
- 공개 전 자동 검증: 필수 칸·서울 밖 좌표, 성인업소 키워드 이름, 확인 요금과 예시 요금이 함께 있음, 곳 수 10% 넘게 감소(`--force`로만 통과).
- 사람이 확인한 값(`data/curated/`)은 지금처럼 러스트 `export_web_data`가 합친 뒤 올린다(DB에 따로 두지 않음, 설계서의 `curated_overrides` 표는 쓰지 않기로 단순화).
- 제보는 `reports` 표에 쌓이기만 하고 화면에 바로 나가지 않는다. 확인한 뒤 `data/curated/`에 넣는다.

## 시험
```
node worker/test/run-local.mjs
```
Cloudflare 없이 Node 내장 SQLite로 같은 SQL을 돌린다(36개 확인: 공개·304·CORS·되돌리기·검증·제보 제한 등). 실제 D1의 한도·캐시는 흉내만 낸다.

## 구성
| 파일 | 내용 |
| --- | --- |
| `schema.sql` | 표 5개: places(초안) · snapshots(공개본) · meta · reports · publish_log |
| `src/index.js` | API. 공개용 `/api/places` `/api/report`, 관리용 `/admin/*`(Bearer 토큰) |
| `wrangler.toml` | 이름·D1 연결·허용 화면 주소(`ALLOWED_ORIGINS`). 비밀 값은 여기에 쓰지 않는다 |
| `setup.ps1` | 처음 한 번 설치·배포 |
| `../scripts/d1_publish.mjs` | 수집 PC의 관리 도구 |
