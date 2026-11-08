# 탕방 작업 맥북 이어가기

작성: 2026-11-07 · 윈도우 PC에서 하던 작업을 맥북에서 이어가기 위한 안내예요. 비밀 값(키·토큰)은 이 문서에 없어요.

## 1. 지금 상태 (2026-11-06 밤 기준)

| 구분 | 위치 | 상태 |
| --- | --- | --- |
| 서비스 저장소 | https://github.com/taeolee1310/10_23_map_test | 작업 브랜치 `codex/collector-local-skills`가 최신(`d70611a`). `main`은 `0f0e0ce`(Vercel이 배포하는 브랜치) |
| 수집 프로그램 저장소 | https://github.com/taeolee1310/tangbang-collector | `main` `997ab4e`, 커밋 안 한 변경 없음 |
| 사이트 | https://tangbang.vercel.app | `main` 배포 중. 데이터는 Cloudflare Worker에서 먼저 받고, 실패하면 `/data/onsen.json` 사용 |
| 데이터 API | https://tangbang-api.tangbang-api.workers.dev | Cloudflare Worker `tangbang-api` + D1 `tangbang`. 공개 중인 스냅샷 #2(422곳) |
| 설계서 | 탕방 데이터 서비스 전환 설계서 (Vercel 화면 + Cloudflare D1) | Cloudflare 하이브리드 설계서(Claude Docs) |

### 어제(11/06) 한 일

- **수집 프로그램 개선**: 같은 페이지를 작업마다 또 여는 문제 수정, 수집 순서 변경(홈 → 후기 → 블로그 → 사진 탭), '받을 페이지 수' 계산 수정, for claude 표시, 섹션·버튼마다 i 설명(3초 호버).
- **수집 결과 반영**: 블로그 154곳 읽고 판정 → 가기 전 알아 둘 것 8→18곳, 입장료 정한 곳 143→161곳.
- **Cloudflare DB 전환**: 화면은 Vercel 그대로, 데이터·제보는 D1 + Worker. 공개 버튼 방식(초안으로 올리고, 사람이 '공개'를 눌러야 사용자에게 보임). Vercel 빌드가 11/05부터 실패하던 원인(`.vercelignore`)도 고쳐 `main`에 배포.
- **예외 처리 보강 + '서비스 공개' 카드**: 휴대폰 번호·크기 검사, 동시 공개 방지, 원자적 공개, 오류 안내. 수집 프로그램에 공개·되돌리기 화면 추가.

## 2. 맥북에서 시작하기

### 2-1. 저장소 받기

```sh
git clone https://github.com/taeolee1310/10_23_map_test.git
cd 10_23_map_test
git checkout codex/collector-local-skills
cd ..
git clone https://github.com/taeolee1310/tangbang-collector.git
```

### 2-2. 깃에 없는 것 옮기기 (윈도우 PC → 맥북)

비밀 값은 에어드롭·USB·비밀번호 관리자로 옮기세요. 대화창에 붙여 넣지 마세요.

| 옮길 것 | 윈도우 PC 위치 | 맥북 위치 |
| --- | --- | --- |
| `.env` (키·토큰) | `10_23_map_test\.env` | `10_23_map_test/.env` |
| 개인 규칙 | `%USERPROFILE%\.claude\CLAUDE.md`, `%USERPROFILE%\.claude\service-playbook.md` | `~/.claude/` |
| 공통 규칙 | `%USERPROFILE%\.codex\AGENTS.md` | `~/.codex/AGENTS.md` |
| Claude 메모리(선택) | `%USERPROFILE%\.claude\projects\C--Users-user-Desktop-AX----10-23-10-23-map-test\memory\` | `~/.claude/projects/<맥 경로에 맞는 폴더>/memory/` (폴더 이름은 프로젝트 경로로 만들어져서 달라요. 안 맞으면 Claude에게 이 문서를 읽혀 주세요) |

`.env`에 있어야 하는 이름(값은 적지 않아요): `KAKAO_REST_API_KEY`, `KAKAO_JS_KEY`, `DATA_GO_KR_API_KEY`, `TANGBANG_API`, `TANGBANG_ADMIN_TOKEN`

깃에 올라가지 않은 폴더(필요하면 직접 복사하거나 깃에 올려야 해요):

- `tangbang-codex-ops/` (for codex 프로그램)
- `web/src/components/GlassTileCard/`, `web/demos/`
- `web/src/styles/tangbang-colors.css`의 커밋 안 한 변경(29줄)
- 옛 `collector/` 폴더, `_workspace/`, `.agents/`, `skills-lock.json`
- 수집해 둔 원본 페이지: `data/collected/naver_pages/`와 후기·블로그 기록 파일(후기 문장이 있어 깃에 올리지 않아요), `data/raw/`

### 2-3. 환경 준비

```sh
cd 10_23_map_test
sh scripts/setup.sh              # 러스트 설치와 빌드
cd web && npm install && cd ..   # 화면
cd worker && npm install && cd ..
```

- Node는 22 이상이 필요해요(Worker 로컬 시험이 `node:sqlite`를 써요). 윈도우에서는 24였어요.
- Cloudflare는 이미 만들어져 있어요. 새로 만들지 말고 로그인만 하세요.

```sh
cd worker && npx wrangler login
```

### 2-4. 잘 되는지 확인

```sh
node --env-file=.env scripts/d1_publish.mjs status     # 공개 중인 스냅샷(#2)과 초안이 보이면 성공
node worker/test/run-local.mjs                         # 로컬 시험 46개
cd web && npm run dev                                  # http://localhost:5173 (카카오 지도는 localhost만 켜져요)
```

### 2-5. Claude Code로 이어가기

서비스 저장소 폴더에서 `claude`를 실행하고 이렇게 말하세요.

> docs/mac-handoff.md, worker/README.md, 저장소 CLAUDE.md를 읽고 이어서 해 줘.

## 3. 맥북에서 되는 것 / 안 되는 것

### 맥에서도 되도록 만들어진 것

- 수집 프로그램은 Tauri(러스트 + 웹 화면)라서 윈도우·맥 모두 빌드할 수 있는 구조예요. 윈도우에만 필요한 부분(검은 창 숨기기, 프로세스 끄기)은 따로 분기해 뒀어요.
- 맥용 설치·빌드 스크립트: `scripts/setup.sh`(서비스 저장소), `scripts/build-app.sh`(수집 프로그램 저장소).
- 11/05 GitHub Actions로 맥 `.dmg`도 만들어졌지만 Releases 초안(v0.1.0)에만 있고 게시하지 않았어요.
- Cloudflare 공개 도구(`scripts/d1_publish.mjs`), Worker, 웹 화면은 맥에서도 그대로 써요.

### 맥에서 확인된 적이 없는 것

수집 프로그램을 맥에서 한 번도 돌려 본 적이 없어요. 저장소 CLAUDE.md의 '맥 점검 목록' 순서로 확인하세요.

- `sh scripts/build-app.sh`가 `.app`·`.dmg`를 만드는지
- 앱을 아이콘으로 열었을 때 cargo·node·claude·ego를 찾는지 (ego의 맥 설치 경로는 추정)
- '멈추기'가 하위 프로세스(ego·node·claude)까지 끊는지 (맥은 본체만 끊어 남을 수 있어요)
- 폴더 고르기, 사진 미리보기, 파일 저장이 되는지
- 서명이 없어 처음 열 때 "확인되지 않은 개발자" 경고가 나요(오른쪽 클릭 → 열기)

### 윈도우에서만 되는 것

- `worker/setup.ps1` (Cloudflare 처음 설치 스크립트). 이미 배포돼 있어서 맥에는 필요 없어요. 필요하면 맥용을 만들 수 있어요.
- 지금 PC에 설치된 수집 프로그램 `.exe`.
- Releases의 `.dmg`는 11/05 판이라 '서비스 공개' 카드·i 설명·for claude가 없어요. 새로 빌드해야 해요.

## 4. 이어서 할 만한 일

1. **사이트 확인**: tangbang.vercel.app을 열어 지도·목록이 뜨는지(사람이 봐야 해요). Worker가 안 되면 자동으로 예전 파일을 읽어요.
2. **제보 확인 절차**: `/price-report` 스킬이 아직 구글 시트를 봐요. D1의 `reports`를 보도록 바꿔야 해요(`node --env-file=.env scripts/d1_publish.mjs reports`).
3. **'실시간' 표기 규칙**: 서비스 규칙 "화면에 '실시간'이라고 쓰지 않는다"를 "N분 전 갱신"으로 바꿀지 정하기.
4. **main 합치기**: `d70611a`(수집 순서)와 `fbd575f`(DB 예외 처리)는 브랜치에만 있어요. 사이트 화면과는 무관해서 급하지 않아요.
5. **수집 순서 실제 시험**: 바뀐 순서로 실제 수집을 돌려 보지 않았어요.
6. **공개 카드 실제 클릭**: 화면에서 변경을 공개·되돌리기 해 보지 않았어요(토큰 맞추기 버튼, 오프라인 화면도 미확인).

## 5. 평소 쓰는 명령

수집이 끝난 뒤 사용자에게 공개하기 (서비스 저장소 폴더에서):

```sh
node --env-file=.env scripts/d1_publish.mjs ingest    # 초안 올리기(사용자 화면은 그대로)
node --env-file=.env scripts/d1_publish.mjs diff      # 무엇이 바뀌는지
node --env-file=.env scripts/d1_publish.mjs publish   # 공개(1분 안에 반영)
node --env-file=.env scripts/d1_publish.mjs rollback  # 잘못 공개했으면 직전 것으로
```

데이터 만들기 (러스트):

```sh
cargo run --release --bin onsen_merge
cargo run --release --bin export_web_data
```

## 6. 꼭 지킬 규칙 (저장소 CLAUDE.md와 개인 규칙 요약)

- `.env`·키·토큰은 열어 보거나 대화에 쓰지 않아요. 있는지·글자 수만 확인해요.
- 커밋·푸시는 요청할 때만 해요. 이번 작업과 관계없는 변경은 넣지 않아요.
- 점검·검토를 부탁하면 제안만 하고, 고치라고 할 때 고쳐요.
- 서비스는 서울 전용이고, 성인업소는 무조건 빼요. 사람이 확인한 값(`data/curated/`)은 스크립트가 덮어쓰지 않아요.
- 답변은 한국어로 간결하게, 시간은 한국 시간(KST)이에요.
- 용어: 수집용 데스크톱 프로그램은 '클로드용 수집 프로그램', 소스 저장소는 '수집 프로그램 저장소'(tangbang-collector), 지도 웹사이트 쪽은 '서비스 저장소'(10_23_map_test), Codex용은 'for codex 프로그램'.

## 7. 주요 파일 위치

| 무엇 | 어디 |
| --- | --- |
| Cloudflare Worker·D1 | `worker/` (`README.md`에 사용법, `schema.sql`, `src/index.js`, `test/run-local.mjs`) |
| 공개 도구 | `scripts/d1_publish.mjs` |
| 화면이 데이터를 받는 곳 | `web/src/lib/api.ts` (`API_BASE`) |
| 수집 스크립트 | `scripts/ego_fetch.mjs`, 러스트 도구 `src/bin/` |
| 수집 프로그램 소스 | tangbang-collector 저장소 (`src/` 화면, `src-tauri/src/main.rs` 백엔드, `src/infoText.ts` i 설명 문구) |
| 화면이 읽는 데이터 | `web/public/data/onsen.json` |
