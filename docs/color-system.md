# 탕방 컬러 시스템 v2

따뜻하고 편안한 목욕탕의 분위기와 정보 탐색 서비스의 명확함을 함께 담은 라이트 모드 컬러 시스템입니다.
키워드: Warm · Calm · Clean · Cozy · Trustworthy · Nostalgic but Modern.

- 정의 파일: `web/src/styles/tangbang-colors.css` (이 파일 하나가 원천입니다)
- 화면 CSS는 Semantic·Component 토큰만 씁니다. Primitive(`--tb-*`)는 화면 CSS에서 직접 쓰지 않습니다.
- 기준 8색의 HEX는 바꾸지 않았습니다. 상태별(hover·active·disabled) 파생 색만 추가했습니다.
- 다크 모드는 이번 범위 밖입니다. Semantic 블록만 `[data-theme="dark"]`에서 다시 정의하면 확장됩니다.
- 눈으로 보는 팔레트·상태 미리보기: `docs/color-preview.html` (앱 밖 정적 파일이라 서비스에는 배포되지 않습니다).

## 1. 3단계 구조

| 단계 | 접두어 | 역할 | 예 |
|---|---|---|---|
| 1 Primitive | `--tb-` | 색 스케일. 실제 쓰는 단계만 | `--tb-cream-200`, `--tb-terracotta-500` |
| 2 Semantic | `--color-` | 의미. 컴포넌트는 여기에만 의존 | `--color-bg-page`, `--color-action-primary` |
| 3 Component | `--button-` `--input-` `--search-` `--card-` `--nav-` `--tab-` `--chip-` `--badge-` `--modal-` `--toast-` `--bottom-nav-` | 컴포넌트·상태별 색 | `--button-primary-bg-hover` |

## 2. Primitive 스케일 (★ = 기준값)

| 스케일 | 단계와 값 |
|---|---|
| cream | 100 `#FEFAE8` · **200 `#FDF6D0` ★ Warm Cream** · 300 `#F4E9B8` |
| ivory | **50 `#FFFDF5` ★ Clean Ivory** · 100 `#F9F4E3` |
| sand | 200 `#F1E7C6` · **300 `#E8D9AE` ★ Sand Beige** · 500 `#CDBB86` |
| apricot | 100 `#FAE6D3` · **300 `#E7A36E` ★ Apricot** |
| cocoa | 100 `#EDE6DA` · 300 `#C4B8A8` · 500 `#877767` · 600 `#6B5B4D` · **700 `#57483B` ★ Mocha Brown** · **900 `#342C25` ★ Deep Cocoa** |
| teal | 50 `#E5EFED` · 100 `#CFE2DF` · **500 `#527C77` ★ Bath Teal** · 600 `#446A66` · 700 `#385753` |
| terracotta | 50 `#F8E3DC` · **500 `#A64B31` ★ Warm Terracotta** · 600 `#8F3F28` · 700 `#7A3522` |
| 상태색 | green 50/500/700 · amber 50/500/800 · red 50/500/700 (정보 상태는 teal 사용) |

일러스트 전용 값(`--tb-cream-sun`, `--tb-bottle-brown`, `--tb-steam`, `--tb-water`, `--tb-character-blue`)은 인트로 그림·로고·캐릭터 원본에서 뽑은 것이라 UI 팔레트와 분리해 두었습니다. UI에는 쓰지 않습니다.

## 3. Semantic ← Primitive 매핑

| Semantic | Primitive | 용도 |
|---|---|---|
| `bg-page` / `bg-brand` | cream-200 | 페이지 배경·브랜드 면 |
| `bg-surface` | ivory-50 | 카드·콘텐츠 표면 |
| `bg-surface-muted` | ivory-100 | 카드 안쪽 면 |
| `bg-band` | sand-300 | 머리말·보조 구분 영역 |
| `bg-inverse` | cocoa-900 | 짙은 면(토스트) |
| `text-primary` | cocoa-900 | 제목·본문 |
| `text-secondary` | cocoa-700 | 보조 정보 |
| `text-muted` | cocoa-600 | 안내 글·자리표시 |
| `text-inverse` | ivory-50 | 짙은 면 위 글자 |
| `text-brand` | terracotta-500 | 강조 글자 |
| `text-link` | teal-600 | 링크·시설 정보 글자(teal-500은 크림 위 4.27:1이라 글자에 쓰지 않음) |
| `text-on-action` | white | 테라코타·청록 면 위 글자 |
| `border-default` | cocoa-500 | 입력창 등 인터랙티브 경계 |
| `border-subtle` | sand-300 | 장식용 구분선 (정보 전달 금지) |
| `border-strong` | cocoa-700 | 강한 경계 |
| `border-focus` | cocoa-900 | 포커스 링 |
| `action-primary` (hover/active/disabled) | terracotta-500 (600 / 700 / cocoa-100) | 주요 CTA |
| `action-secondary` (hover/active) | teal-500 (600 / 700) | 선택·보조 인터랙션 |
| `state-success/warning/error/info` × bg·text·border | green·amber·red·teal | 상태 |
| `accent-decor` / `accent-soft` | apricot-300 / apricot-100 | 장식·강조 |

## 4. 주요 컴포넌트 적용

| 컴포넌트 | 기본 | hover | active/선택 | focus | disabled |
|---|---|---|---|---|---|
| Button(주요) | 테라코타 + 흰 글자 | terracotta-600 | terracotta-700 | cocoa-900 링 2px(띄움) | cocoa-100 + cocoa-600 글자 |
| Button(ghost) | 투명 + 청록 글자 | sand-200 면 | — | 동일 | — |
| Search Bar | ivory 면 + cocoa-900 글자, 돋보기 teal-600 | — | — | cocoa-900 테두리 + 22% 번짐 | — |
| Input(select) | ivory + cocoa-500 테두리 | cocoa-700 | — | cocoa-900 | cocoa-100 면 |
| Card | ivory 면 + sand 테두리 | ivory-100 | 선택 시 teal-50 면 + cocoa-700 테두리·왼쪽 굵은 띠 | cocoa-900 링 | — |
| Navigation(머리말) | sand-300 면 + cocoa-900 글자 | — | — | — | — |
| Filter Chip·토글 | ivory/cocoa-500 테두리 | sand-200 | **Bath Teal 면 + 흰 글자 + 2px 안쪽 테두리 + 굵은 글자** | cocoa-900 링 | cocoa-100 |
| Badge | 종류 sand-200 · 요금 apricot-100 · 시설 teal-50 | — | — | — | — |
| Toast | cocoa-900 면 + ivory 글자 | — | — | — | — |
| Tab / Modal / Bottom Navigation | 토큰만 정의(화면에 아직 없음) | | 선택은 색 + 굵은 밑줄/윗줄 | | |

## 5. 기존 색에서 바뀐 부분

| 예전(노을·이미지 추출) | 지금 |
|---|---|
| 노을 주황 `#FDBE91` 머리말·버튼·선택 | 머리말 Sand, 버튼 Terracotta, 선택 Bath Teal |
| 노을 분홍 `#EDB59E` 강조·내 위치 | Apricot(장식), 내 위치 점은 Bath Teal |
| 짙은 갈색 `#533E32` 글자 | Deep Cocoa `#342C25` |
| 보조 글자 `#7A6964` | Mocha Brown `#57483B` |
| 카드 `#FFFFFF` | Clean Ivory `#FFFDF5` |
| 나무색 `#A47658` 핀·경계 | 핀 Terracotta, 경계 cocoa-500 |
| 장식 구분선 `#DAB3A0` | sand-300 |
| 포커스 링 주황 | Deep Cocoa |
| 사라진 토큰 | `--color-bg` `--color-surface` `--color-surface-warm` `--color-accent(-secondary)` `--color-text-on-accent` `--color-border-soft` `--color-beam-*` `--tb-peach/amber/rose/wood/stone-*` |

바뀐 파일: `web/src/styles/tangbang-colors.css`(전면 재작성), `web/src/screens/MainScreen/MainScreen.css`(역할 변수 재정의 + 하드코딩 색 25곳 토큰화), `MainScreen.tsx`(토큰 1곳), `web/src/index.css`(토큰 1곳), `README.md`, `CLAUDE.md`. 레이아웃·간격·글자·기능은 건드리지 않았습니다.

## 6. 접근성 검증 (WCAG 2.2 AA, 코드로 계산)

| 조합 | 명암비 | 기준 | 결과 |
|---|---|---|---|
| Cream + Deep Cocoa | 12.57 | 4.5 | 통과 |
| Cream + Mocha Brown | 8.04 | 4.5 | 통과 |
| Terracotta + White | 5.72 | 4.5 | 통과 |
| Teal + White | 4.66 | 4.5 | 통과 (여유 작음) |
| Ivory + Mocha Brown | 8.61 | 4.5 | 통과 |
| Ivory + Deep Cocoa | 13.45 | 4.5 | 통과 |
| Sand(머리말) + Deep Cocoa / Mocha | 9.76 / 6.25 | 4.5 | 통과 |
| Cream·Ivory + text-muted(cocoa-600) | 5.97 / 6.39 | 4.5 | 통과 |
| Cream·Ivory + text-link(teal-600) | 5.51 / 5.89 | 4.5 | 통과 |
| Cream + Terracotta 글자 | 5.25 | 4.5 | 통과 |
| CTA hover / active (terracotta-600 / 700 + 흰 글자) | 7.22 / 8.90 | 4.5 | 통과 |
| 상태 글자(성공·경고·오류·정보) | 6.83 / 7.02 / 7.27 / 5.87 | 4.5 | 통과 |
| 입력창 경계(cocoa-500) on Cream / Ivory | 3.96 / 4.24 | 3.0 | 통과 |
| 포커스 링(cocoa-900) on Cream / Sand | 12.57 / 9.76 | 3.0 | 통과 |
| 청록 아이콘·스위치 on Ivory / Cream | 4.57 / 4.27 | 3.0 | 통과 |
| 상태 테두리(성공·경고·오류) on Ivory | 4.62 / 3.66 / 5.85 | 3.0 | 통과 |
| **Teal-500 글자 on Cream** | **4.27** | 4.5 | **미달 → 글자는 `text-link`(teal-600)** |
| **Apricot on Ivory** | **2.09** | 3.0 | **미달 → 장식 전용, 글자·경계·아이콘에 쓰지 않음** |
| **Sand 구분선 on Cream** | **1.29** | 3.0 | **미달 → `border-subtle`은 장식 전용, 정보 전달 금지** |
| **포커스 링(cocoa-900)이 CTA(terracotta)에 바로 맞닿을 때** | **2.40** | 3.0 | **미달 → 링은 항상 2px 띄워서(outline-offset) 페이지 배경 위에 놓임** |

계산은 WCAG 상대 휘도 공식으로 했습니다. 실제 화면은 Chrome에서 메인·목록 선택·상세(데스크톱 1280px, 폰 390px)를 찍어 눈으로 확인했습니다.

## 7. 남은 위험과 개선 필요

- **인트로는 그대로**: 인트로 그림과 잇는 색(`--tb-bottle-brown`, `--tb-cream-sun`), `waterfall.ts`의 물줄기 색, 고스트 커서 기본색은 그림 원본에서 온 값이라 바꾸지 않았습니다. 바꾸면 그림 가장자리와 어긋날 수 있습니다. 인트로를 새 팔레트로 맞출지는 별도 결정이 필요합니다.
- **지도는 눈으로 못 봄**: 로컬에서는 카카오 도메인이 등록되지 않아 지도가 뜨지 않아, 핀 색(테라코타 면 + cocoa-900 윤곽 + 크림 욕조)은 지도 위에서 확인하지 못했습니다.
- **선택 상태의 색 외 단서**: 필터 칩·토글은 굵은 글자 + 안쪽 테두리를 더했고, 목록 선택 항목은 왼쪽 굵은 띠가 있습니다. 칩에 체크 아이콘을 넣는 것은 레이아웃이 바뀌어 하지 않았습니다.
- **아직 화면에 없는 컴포넌트**: Tab·Modal·Bottom Navigation·상태 색은 토큰만 정의했고 쓰는 화면이 없어 실제 모습은 확인하지 못했습니다.
- **데이터 URI 안의 색**: 머리말 아래 물결(`%23FDF6D0`)과 선택 화살표(`%2357483B`)는 CSS 변수를 못 쓰는 위치라 HEX가 남아 있습니다. cream-200·cocoa-700과 같은 값입니다. 이 두 토큰을 바꾸면 함께 고쳐야 합니다.
- **기본 컨트롤 색**: 검색창의 지우기(×) 버튼은 브라우저 기본 색이라 토큰이 닿지 않습니다.
- **스크린 리더·실기기 확인은 하지 않았습니다.**
