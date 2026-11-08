# AGENTS.md · 탕방 프로젝트 입구

다른 AI가 이 프로젝트를 이어받을 때 **이 파일부터** 읽는다. 여기에는 지도와 핵심 규칙만 적었다. 자세한 내용은 아래 링크한 문서에서 필요한 것만 연다.

## 한 줄 소개
탕방(Tangbang): 서울의 목욕탕·사우나·온천을 지도와 목록으로 보여 주고, 확인된 요금만 숫자로 알려 주는 웹 서비스. **서울 전용**.
- 배포: https://tangbang.vercel.app (`main` 푸시 시 Vercel 자동 배포)
- 사용자: 이태오(프로덕트디자이너 인턴). 답은 한국어로 간결하게, 시간은 KST.

## 더 읽을 곳 (필요할 때만)
| 알고 싶은 것 | 문서 |
|---|---|
| **전체 흐름·기능별 코드 위치(먼저 읽기)** | `docs/architecture.md` |
| 모든 작업 규칙(원본) | `CLAUDE.md` |
| 데이터 API·DB(Cloudflare Worker + D1) | `worker/README.md` |
| 서비스 구조, 인트로 레이어, 알려진 함정, 남은 일 | `README.md` |
| 데이터 파일별 설명·출처·만드는 순서 | `data/README.md` |
| 컬러 토큰 구조·명암비 | `docs/color-system.md` |
| 제보 확인·반영 절차(D1 reports) | `.claude/skills/price-report/SKILL.md` (예전 구글 시트 설정은 `docs/report-setup.md`) |
| 최근 작업 기록·다음 할 일 | 노션 'AI 공통 작업 노트' 허브 → 04 프로젝트 > 탕방 프로젝트 일지 |

곳 수·요금 확인 수 같은 숫자는 문서마다 시점이 다르다. 최신 값은 `web/public/data/onsen.json`(`baseDate`, `places`)에서 직접 센다.

## 폴더 지도
```
web/                     React 18 + Vite + TypeScript 화면
  src/App.tsx            인트로 → 메인 전환
  src/components/
    BathhouseIntro/      첫 화면(Figma 에셋 + 캔버스 물줄기·수증기·오리·배경음)
    KakaoMap/            지도·핀·구별 묶음 마커 (SDK 주소는 맨 위 API 한 곳)
    Onboarding/          첫 방문 스포트라이트 안내 5단계(키 v3)
    PriceReport/         요금·시설 정보 제보 창
    GhostCursor/ OnsenLogo/ MilkLoader/ GlideSelect/ ElasticSlider/ PriceIcon/
  src/screens/MainScreen/  목록·미리보기·상세
  src/lib/onsen.ts       타입·필터·정렬(추천순 점수 infoScore·recommendScore)
  src/lib/api.ts         데이터 받기: Worker /api/places → 실패하면 public/data/onsen.json
  src/styles/            tangbang-colors.css(색 토큰), motion.css
  api/favs.js            담아둔 곳 백업 쿠키 (Vercel 서버 기능)
  api/report.js          예전 제보 → 구글 시트 (지금은 예비, 제보는 Worker로 감)
  public/data/onsen.json 화면 데이터 원본 파일(초안으로 올려 공개, Worker가 안 될 때 비상용)
worker/   Cloudflare Worker + D1: 공개 데이터·제보·방문자 수 API. 배포는 npx wrangler deploy (푸시로 안 올라감)
scripts/d1_publish.mjs   운영 도구: 초안 올리기·공개·되돌리기·제보·방문자 수(stats)
data/  raw(원본, 깃에 없음) · collected(수집) · curated(사람이 확인) · merged(합친 결과)
src/bin/  데이터 도구(러스트): onsen_merge, export_web_data 등. cargo run --release --bin <이름> (새 PC는 scripts/setup.ps1 · setup.sh 먼저)
(수집 도구 앱)  별도 저장소 taeolee1310/tangbang-collector(비공개)로 옮김, 2026-11-05. 이 폴더를 '프로젝트 폴더'로 골라 씀. 앱이 기대는 이름·경로는 CLAUDE.md '탕방 데이터 수집 도구' 항목
scripts/naver_page_text.js  ego 브라우저로 네이버 페이지 글자 뽑기 (헤드리스 수집 안 함)
place geo make_map factcheck(src/bin) map.html   수업 연습 도구, 화면과 무관
```

## 데이터 흐름
`data/collected/*` + `data/curated/*` → `cargo run --release --bin onsen_merge` → `data/merged/onsen_merged.csv` → `cargo run --release --bin export_web_data` → `web/public/data/onsen.json` → `d1_publish.mjs ingest`(초안) → `publish`(공개, 사용자 화면에 1분 안에 반영)

## 실행
`web/`에서 `npm run dev` → **`http://localhost:5173`** 으로 연다(`127.0.0.1`이면 지도 안 뜸). `npm run build`는 타입 검사 + 빌드. 설치 명령은 제안만 한다.

## 꼭 지킬 규칙 (상세는 CLAUDE.md)
1. **키**: REST 키는 파이썬에서만. 화면에는 `KAKAO_JS_KEY`만. `.env` 값을 열거나 대화에 쓰지 않는다. `vite.config.ts`의 `envPrefix`, `package.json`의 `--host 127.0.0.1`을 바꾸지 않는다.
2. **좌표**: 카카오 `x`=경도, `y`=위도(글자). `LatLng(위도, 경도)` 순서.
3. **데이터**: 서울만. `curated/`는 사람이 확인한 값이라 스크립트가 덮어쓰지 않는다. 요금은 확인된 것만 숫자로, 나머지는 "요금 미확인". 전화 확인은 제안하지 않는다.
4. **색**: `tangbang-colors.css`의 semantic·component 토큰만. 새 색 값을 직접 쓰지 않는다.
5. **에셋**: 인트로는 Figma 원본(파일 `ojmQos2N59L7GQE76L26J6`, 노드 `381:2`) 에셋만. 임의로 만들거나 합성하지 않는다(오리 스프라이트만 예외).
6. **화면**: 개발자용 설정·미리보기·디버그 UI를 사용자 화면에 넣지 않는다. 모션은 요청한 것만, `prefers-reduced-motion` 지키기.
7. **작업 방식**: 점검·검토 요청엔 제안만, 수정 요청이 있을 때 고친다. 커밋·푸시·삭제는 사용자가 말할 때만.
8. **함정**: CSS에서 `url("${src}")`처럼 따옴표를 꼭 붙인다(빠지면 운영에서만 아이콘이 사라짐).
