# 탕방 컬러 시스템 v3 (Figma 기준)

원천은 Figma `원티드 커리어캠프` 파일의 **탕방 디자인 시스템**(노드 `418:131`)입니다. 색 스케일·컴포넌트 상태·선(스트로크)·모서리·그림자를 이 파일 값으로 맞췄습니다.

- 정의 파일: `web/src/styles/tangbang-colors.css` (원천은 이 파일 하나)
- 화면 CSS는 Semantic·Component 토큰만 씁니다. Primitive(`--tb-*`)는 화면 CSS에서 직접 쓰지 않습니다.
- **Bath Teal은 '선택'과 '포인트'** 색입니다: 선택된 칩·스위치·목록 카드·지도 핀, 포커스 선, 시설 배지, 링크, 내 위치 점. **주요 버튼(CTA)만 Warm Terracotta**입니다.
- 다크 모드는 범위 밖입니다. Semantic 블록만 `[data-theme="dark"]`에서 다시 정의하면 확장됩니다.
- 눈으로 보는 미리보기: `docs/color-preview.html` (앱 밖 정적 파일, 서비스에는 배포되지 않음)

## 1. 3단계 구조

| 단계 | 접두어 | 예 |
|---|---|---|
| 1 Primitive | `--tb-` | `--tb-brand-bath-teal`, `--tb-teal-600`, `--tb-stone-200` |
| 2 Semantic | `--color-` | `--color-bg-page`, `--color-action-secondary`, `--color-border-focus` |
| 3 Component | `--button-` `--input-` `--search-` `--card-` `--nav-` `--tab-` `--chip-` `--badge-` `--modal-` `--toast-` `--bottom-nav-` | `--chip-bg-selected` |
| 모양 | `--radius-*` `--space-*` `--shadow-card` | 라운드 8/12/16/알약, 여백 4~24, 카드 그림자 |

Primitive 스케일은 Figma `Foundations / Color` 값 그대로입니다(cream·ivory·cocoa·teal·terracotta·sand·apricot). Figma의 `border-default #E4DCD3`, `border-subtle #EFE8DC`, `input-bg-disabled #F7F3EA`는 `stone-200/100/50`으로 이름을 붙였습니다.

## 2. Figma 컴포넌트 ↔ 토큰 ↔ 화면

| Figma | 핵심 값 | 화면 적용 |
|---|---|---|
| Button / Primary | 테라코타 `#A64B31`, hover `#7F3F27`, active `#8C3C24`, disabled `#E9C7B6`, 44px, 12px 라운드, 15/600 | `.btn` (자세히 보기·지도에서 길찾기) |
| Button / Secondary | Bath Teal `#527C77`, hover `#3E615D`, active `#2F5A56`, disabled `#C8D8D6` | 토큰 정의(화면에 아직 쓰는 곳 없음) |
| Button / Outline | 흰 바탕 + 1px `#E4DCD3`, hover `#F0EBD8`, active `#E4DCD3` | `.btn.ghost` (길찾기·내 위치로 거리 보기 등) |
| Input | 44px, 12px 라운드, 1px `#E4DCD3`, **포커스 Bath Teal**, 에러 `#D1433C`, 비활성 `#F7F3EA` | 검색창 `.search` |
| Filter Chip | 36px 알약, 14/500, 기본 `#FFFDF5`+1px 선, hover `#F3E8C9`, **선택 Bath Teal + 흰 글자**, 비활성 `#F7F3EA` | 머리말 빠른 버튼 `.qp`, 종류 선택 `.seg`, 지도 토글 `.tg` |
| Badge | 12/600, 4·12 여백. Facility 청록 옅은 면, Hours 테라코타 옅은 면, Open 살구 옅은 면, Outline 청록 선 | 종류 배지(청록), 가격 배지(테라코타), 요금 미확인(샌드) |
| Card | `#FFFDF5`, 1px `#E4DCD3`, 16px 라운드, 그림자 `0 4 12 / 0 1 2` (코코아 6%) | 목록 패널·지도·미리보기·상세 구역 |
| Toast | 옅은 면 + 색 원 아이콘, 12px 라운드 | 화면 알림(Info 모양) |
| Modal | `#FFFDF5`, 1px 선, 16px 라운드 | 토큰만 정의 |

선택된 목록 카드는 옅은 청록 면 + 청록 1px 선 + 왼쪽 4px 띠이고, 선택된 지도 핀은 청록 면입니다.

## 3. 접근성 검증 (WCAG 2.2 AA, 코드로 계산)

글자(4.5:1) · 아이콘·선택 표시(3:1)

| 조합 | 명암비 | 결과 |
|---|---|---|
| Primary 버튼: 흰 글자 on `#A64B31` / hover / active | 5.72 / 7.95 / 7.54 | 통과 |
| Secondary 버튼·선택 칩: 흰 글자 on `#527C77` / hover / active | 4.66 / 6.83 / 7.73 | 통과 |
| 칩 글자 Mocha on Ivory / hover(크림) | 8.61 / 7.18 | 통과 |
| 아웃라인 버튼 글자 Cocoa on 흰색 / hover | 13.70 / 11.47 | 통과 |
| 링크·시설 글자 `teal-600` on Cream / Ivory | 6.27 / 6.71 | 통과 |
| 영업(가격) 배지 테라코타 on `#FCEDE7` | 5.01 | 통과 |
| 에러 글자·테두리 `#D1433C` on 흰색 | 4.59 | 통과 |
| 토스트 본문 Cocoa on 성공 면 | 12.03 | 통과 |
| 토스트 아이콘(흰 글자) 성공·에러·정보 | 4.31 / 4.59 / 4.28 | 통과(3:1) |
| 포커스 선·선택 칩 Bath Teal on Cream / 흰색 | 4.27 / 4.66 | 통과(3:1) |
| **시설 배지 글자 Figma `teal-500` on `#EBF1EF`** | **4.07** | **미달 → `teal-600`(5.98)로 대체** |
| **열림 배지 `apricot-700` on `#FDF2E8`** | **3.67** | **미달 → 토큰만 두고 화면에는 쓰지 않음** |
| **Figma `text-muted #8D7665` on 흰색 / 크림** | **4.28 / 3.92** | **미달 → 글자는 한 단계 짙은 `cocoa-400 #6B5B4D`(5.97)로 대체. 원래 값은 `--color-text-subtle`(큰 글자·장식 전용)** |
| **입력창·칩 기본 테두리 `#E4DCD3` on 흰색 / 크림** | **1.36 / 1.25** | **미달(3:1) → 아래 참고** |
| 비활성 글자 `#9B8E7F` on `#F7F3EA` | 2.89 | 비활성은 기준 제외 |

**테두리 미달에 대해:** Figma의 기본 선은 가늘고 연해서 입력창·칩 경계가 WCAG 1.4.11(3:1)에 못 미칩니다. 디자인대로 그대로 두었고, 입력창은 흰 면과 포커스(청록)·에러(빨강) 선으로, 칩은 면 색과 글자로 구분됩니다. 더 또렷하게 해야 한다면 `--input-border`·`--chip-border`를 `var(--color-border-contrast)`(cocoa-300, 크림 위 3.92)로 바꾸면 한 줄로 해결됩니다.

## 4. 이전(v2)에서 바뀐 부분

| v2 | v3 |
|---|---|
| 입력창·칩 테두리 cocoa-500(진한 갈색) | Figma 연한 선 `#E4DCD3` (1px) |
| 포커스 링 Deep Cocoa | Bath Teal |
| 선택 칩 안쪽 2px 테두리 | 없음(Figma 그대로, 굵은 글자만 유지) |
| 선택된 목록 카드 cocoa 선 | Bath Teal 선·띠 |
| 선택된 지도 핀 크림 | Bath Teal |
| 종류 배지 샌드 | 시설 배지 청록(Figma Facility) |
| 가격 배지 살구 | 테라코타 옅은 면(Figma Hours) |
| 검색창 50px·16px 라운드·큰 그림자 | 44px·12px 라운드·그림자 없음(Figma Input) |
| 빠른 버튼 반투명 | Figma Filter Chip 36px 알약 |
| 큰 카드 24px 라운드 | 16px 라운드 + Figma 카드 그림자 |
| 토스트 어두운 면 | Figma 옅은 면 + 색 원 아이콘 |
| 보조 버튼 테라코타 테두리 + 청록 글자 | Figma Outline(흰 면 + 연한 선 + Cocoa 글자), 높이 44px |

레이아웃 구조·글자 크기·기능은 건드리지 않았습니다. 버튼(44px)·칩(36px)·배지(4·12 여백)는 Figma 크기라 이전보다 조금 커졌습니다.

## 5. 남은 위험과 개선 필요

- **인트로는 그대로**: 인트로 그림 색(`--tb-bottle-brown` 등)·물줄기 색·고스트 커서 기본색은 이미지 원본에서 온 값이라 바꾸지 않았습니다.
- **지도 핀 색은 눈으로 못 봄**: 로컬에서는 카카오 도메인이 등록되지 않아 지도가 뜨지 않습니다. 운영 주소에서 선택된 핀(청록)을 확인해야 합니다.
- **Figma 컴포넌트 일부는 화면에 없음**: Secondary 버튼, Modal, Tab, Bottom Navigation, 성공·오류 토스트는 토큰만 있습니다.
- **Code Connect 미연결**: Figma 컴포넌트와 코드 컴포넌트를 잇는 매핑은 만들지 않았습니다.
- **데이터 URI 속 색**: 머리말 아래 물결(`%23FDF6D0`)과 선택 화살표(`%2357483B`)는 CSS 변수를 못 쓰는 위치라 HEX가 남아 있습니다(`brand-warm-cream`, `cocoa-500`과 같은 값).
- **검색창 지우기(×)** 는 브라우저 기본 색입니다.
- 스크린 리더·실기기는 확인하지 않았습니다.
