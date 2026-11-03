---
name: Vater
description: 사용자가 칸을 짜는 투자 대시보드. 밝은 회색 캔버스 위 흰 칸 카드, 강조색은 보라 하나, 빨강·파랑은 값의 방향에만.
colors:
  canvas: "#f0f2f5"
  card: "#ffffff"
  row-alt: "#f6f7f9"
  hover: "#eef0f4"
  selection: "#e3dafa"
  table-head: "#262d3b"
  on-table-head: "#eef1f6"
  line: "#e1e4ea"
  rule: "#eceef2"
  control: "#cfd3dc"
  control-strong: "#7f8698"
  ink: "#161c2a"
  ink-2: "#3b4456"
  ink-3: "#5a6275"
  on-ink: "#ffffff"
  accent: "#7a45d8"
  accent-strong: "#6232c4"
  accent-weak: "#f1ecfd"
  on-accent: "#ffffff"
  tag: "#7a8294"
  up: "#d02c2c"
  down: "#1d5cd2"
  caution: "#b8730b"
  caution-bg: "#fff4d8"
  caution-ink: "#6f4600"
  focus: "{colors.accent}"
typography:
  screen-title:
    fontFamily: "Pretendard, Malgun Gothic, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: "1.75rem"
    letterSpacing: "-0.01em"
  card-title:
    fontFamily: "Pretendard, Malgun Gothic, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: "1.5rem"
  card-description:
    fontFamily: "Pretendard, Malgun Gothic, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.125rem"
  kpi-value:
    fontFamily: "Pretendard, Malgun Gothic, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: "2.25rem"
    fontFeature: "tnum"
  ai-lead:
    fontFamily: "Pretendard, Malgun Gothic, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: "1.5rem"
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Pretendard, Malgun Gothic, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  numeric:
    fontFamily: "Pretendard, Malgun Gothic, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.25rem"
    fontFeature: "tnum"
  label:
    fontFamily: "Pretendard, Malgun Gothic, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: "1.125rem"
  meta:
    fontFamily: "Pretendard, Malgun Gothic, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1rem"
  wordmark:
    fontFamily: "Pretendard, Malgun Gothic, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: "1.75rem"
rounded:
  sm: "4px"
  control: "6px"
  md: "8px"
  pop: "10px"
  round: "999px"
spacing:
  "1": "0.25rem"
  "2": "0.5rem"
  "3": "0.75rem"
  "4": "1rem"
  "5": "1.25rem"
  "6": "1.5rem"
  card: "1rem"
  gap: "0.75rem"
components:
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.md}"
    padding: "1rem"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "2rem"
  button-primary-hover:
    backgroundColor: "{colors.accent-strong}"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "2rem"
  nav-item-current:
    backgroundColor: "{colors.accent-weak}"
    textColor: "{colors.accent-strong}"
  tab-current:
    textColor: "{colors.ink}"
  table-head:
    backgroundColor: "{colors.table-head}"
    textColor: "{colors.on-table-head}"
    typography: "{typography.meta}"
    height: "1.875rem"
  table-row:
    textColor: "{colors.ink}"
    typography: "{typography.numeric}"
    height: "2.375rem"
  table-row-alt:
    backgroundColor: "{colors.row-alt}"
  status-bar:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink-2}"
    typography: "{typography.meta}"
    height: "1.75rem"
---

# Design System: Vater

이 문서가 디자인 시스템의 기준이다. 값의 원본은 `apps/desktop/src/design-system/tokens.css`이고, 위 머리말(frontmatter)은 그 값을 옮긴 것이다. 둘이 다르면 `tokens.css`가 맞고 이 문서를 고친다. 모든 부품은 `apps/desktop/gallery.html`(`npm run dev` 후 `/gallery.html`)에서 실제 상태로 볼 수 있다. 제품의 사실(사용자, 목적, 제약)은 `PRODUCT.md`, 이번 개편의 근거는 `docs/superpowers/specs/2026-11-03-dashboard-design.md` 5장이다.

## Overview

**Creative North Star: "대시보드 라이트"**

홈은 사용자가 직접 짜는 대시보드다(칸 1~6개, 맨 위 숫자 줄). 화면은 밝은 회색 캔버스 위에 흰 칸 카드를 늘어놓은 모습이고, 칸마다 제목과 설명 한 줄을 머리에 둔다. Power BI 같은 업무용 대시보드의 질서(같은 크기의 카드, 짙은 머리줄의 표, 큰 숫자 카드)를 따르되, 국내 개인 투자자가 익숙한 관례(상승 빨강·하락 파랑, 원 표기)는 그대로 둔다.

색은 네 묶음만 쓴다. **값의 방향**(빨강·파랑), **강조**(인디고-바이올렛 하나: 선택·주 버튼·활성 탭·링크·포커스), **주의**(황토: 폴링·끊김·오프라인·오류·검토 필요), 그리고 나머지 전부인 **중립**(남색 먹과 회색). 분류 표지(지수 이름 옆 네모, 메뉴 아이콘)도 중립이다. 그래서 화면에서 빨강·파랑이 보이면 언제나 "오르고 내림"이다.

앱은 대부분의 시간을 트레이에서 감시하다가 가끔 열린다. 열었을 때 한눈에 "지금 시장과 내 종목이 어떤가"를 보여 주는 것이 목표라, 밀도는 중간보다 조금 높다(표 행 38px, 본문 13~14px).

거부한 것: 어두운 터미널(시안 2, 이번에는 기록만), 둥근 큰 카드와 넓은 여백(시안 3), 카드 안의 카드, 색으로 칠한 분류 표지, 진하게 채운 매수·매도 배지, 유리·글로우 효과, 명조 글꼴(이전 "리서치 노트"의 AI 문장 글꼴).

**Key Characteristics:**
- 밝은 회색 캔버스(`canvas`) 위 흰 칸 카드(`card`): 모서리 8px, 아주 옅은 그림자, 안쪽 여백 16px.
- 카드 머리 = 제목(16px 반굵게) + 설명 한 줄(13px) + 오른쪽 `⋯` 메뉴.
- 표는 짙은 남색 머리줄과 옅은 교차 행. 숫자 열은 오른쪽 정렬, 고정폭 숫자.
- 강조색은 보라 하나. 빨강·파랑은 값의 방향에만, 늘 부호와 함께.
- Pretendard 하나. 굵기와 크기로 위계를 만든다.

## Colors

### Primary: 강조(인디고-바이올렛)
- **강조** (`accent` `#7a45d8`): 주 버튼 바탕, 활성 탭 밑줄, 링크 글자, 선택된 세그먼트·스위치, 포커스 링(`focus`는 `accent`의 별칭), 사이드바 새 소식 배지. 흰 카드 위 5.7:1이라 글자로도 쓴다.
- **강조 진하게** (`accent-strong`): 주 버튼 호버, 옅은 강조 바탕 위의 글자(사이드바 현재 화면, 선택된 목록 항목).
- **강조 옅게** (`accent-weak`): 선택 바탕(사이드바 현재 화면, 메뉴·목록의 선택 항목, "AI 해석" 꼬리표 바탕).
- 색상(hue)이 상승 빨강·하락 파랑과 40도 이상 떨어져 있다(`tokens.test.ts`가 계산). 파랑과 헷갈리지 않게 보라 쪽으로 옮겼다(시안 `#6a43d8` → `#7a45d8`).

### Secondary: 값의 방향(전용)
- **상승 빨강** (`up`): 상승한 변화량·등락률, 상승 선·영역, 수급의 순매수, 의견 눈금의 매수 쪽 칸.
- **하락 파랑** (`down`): 하락 숫자와 선, 수급의 순매도, 의견 눈금의 매도 쪽 칸.
- 이 두 토큰을 쓰는 CSS는 방향을 그리는 부품(`SignedNumber`, `Sparkline`, `DecisionScale`, `LineChart`, `DivergingBar`)뿐이다. 다른 파일이 쓰면 테스트가 실패한다.

### Tertiary: 주의(황토)
- **황토** (`caution`): 폴링 상태 점, 주의 배너의 위 선, 검토 필요 눈금 테두리. 그래픽 전용(흰 카드 위 3.6:1).
- **황토 글자** (`caution-ink`), **황토 바탕** (`caution-bg`): 끊김 글자, 주의 배너, 입력 오류 문구.

### Neutral
- **캔버스** (`canvas`): 본문 바탕. **카드** (`card`): 칸 카드, 사이드바, 상태 표시줄, 머리줄, 입력 칸.
- **교차 행** (`row-alt`): 표의 짝수 행, 막힌 버튼 바탕. **호버** (`hover`): 행·메뉴 항목 호버. **글자 선택** (`selection`).
- **표 머리줄** (`table-head` + `on-table-head`): 짙은 남색 바탕에 밝은 글자(채도 25% 이하의 중립).
- **선**: 칸막이와 경계(`line`), 행 구분(`rule`), 버튼·입력 테두리(`control`), 꺼진 스위치와 빈 상태 원(`control-strong`, 3:1 이상).
- **글자 3단계** (`ink`, `ink-2`, `ink-3`): 가장 옅은 `ink-3`도 캔버스·교차 행·호버·옅은 강조 바탕 위에서 4.5:1 이상.
- **분류 표지** (`tag`): 지수 이름 옆 네모, 메뉴 아이콘. 중립 회색이며 흰 카드 위 3:1 이상.

예전 이름(`paper`, `chrome`, `selected`, `rule-section`, `ink-hover`, `--font-serif`)은 다른 브랜치의 화면 CSS가 쓰고 있어 **새 역할을 가리키는 별칭**으로 남겼다. 새 코드는 쓰지 않는다. `ui/dashboard`가 화면을 새 디자인으로 다시 입힐 때 지운다.

모든 글자·바탕 조합과 그래픽·바탕 조합의 대비를 `tokens.test.ts`가 실제 값으로 계산한다(글자 4.5:1, 큰 글자·아이콘·그래픽 3:1). 같은 테스트가 CSS의 `var(--*)`가 모두 정의되어 있는지, 정의만 하고 쓰지 않는 색 토큰이 없는지, 강조색의 색상 거리, 분류 표지의 채도도 본다.

### Named Rules
**The 방향 색 전용 Rule.** 빨강과 파랑은 값의 방향(시세, 수급 순매수·순매도, 의견 눈금의 채운 칸)에만 쓴다. 미국 종목도 상승은 빨강이다. 분류(코스피·코스닥 표지), 강조, 링크, 브랜드, 오류에 쓰지 않는다. 방향 색은 늘 부호(`+`, `−`)와 함께 간다. 0은 부호 없이 회색 `0`, `0.00%`.

**The 강조색 하나 Rule.** 보라 하나가 "지금 고른 것, 누를 것"을 말한다: 선택, 주 버튼, 활성 탭, 링크, 포커스. 두 번째 강조색을 만들지 않는다. 주 버튼은 한 화면(편집 화면이면 머리줄)에 하나다.

**The 카드 안 카드 금지 Rule.** 칸 카드 안에 또 그림자 진 카드를 넣지 않는다. 카드 안의 묶음은 1px `rule` 선, 교차 바탕, 여백으로 나눈다. `Section`을 `Section` 안에 넣으면(`headingLevel` 3·4) 안쪽은 카드가 아니라 제목만 있는 묶음이 된다.

**The 주의는 황토 Rule.** 오류, 끊김, 오프라인, 폴링, 검토 필요는 황토와 글자로 표시한다. 빨간 오류 표시는 만들지 않는다(빨강은 상승이다).

**The 역할 이름 Rule.** 부품 CSS는 `var(--color-*)`만 쓰고 색 값을 직접 쓰지 않는다(테스트가 막는다). 라이트 테마 하나만 낸다. 다크 테마는 `tokens.css`에 `[data-theme='dark']` 블록으로 같은 이름을 다시 정의해 더한다.

## Typography

**글꼴:** Pretendard 하나(맑은 고딕, system-ui 대체). 앱에 넣은 공식 서브셋 4굵기(400·500·600·700).

### Hierarchy
- **화면 제목** (`screen-title`, 700, 22/28px): 홈이 아닌 페이지 머리(h1).
- **카드 제목** (`card-title`, 600, 16/24px): 칸 카드·구역의 제목(h2).
- **카드 설명** (`card-description`, 400, 13/18px, `ink-3`): 제목 아래 한 줄. 넘치면 말줄임표.
- **숫자 카드 큰 숫자** (`kpi-value`, 700, 28/36px, tnum): `KpiTile`의 값. 단위("종목", "건")는 14px 반굵게로 숫자 뒤에.
- **AI 첫 문장** (`ai-lead`, 600, 16/24px, 먹): 브리핑 요약의 한 문장. 뒤에 "AI 해석" 꼬리표.
- **본문** (`body`, 400, 14/20px), **표·숫자** (`numeric`, 400, 13/20px, tnum).
- **버튼·입력 글자** (`label`, 500, 13px).
- **보조 정보** (`meta`, 400, 12/16px): 표 머리, 상태 표시줄, 축 눈금, 이름표. 12px보다 작게 쓰지 않는다.
- **워드마크** (`wordmark`, 700, 20px): 사이드바의 "Vater".

글자 크기는 모두 rem(기준 16px)이라 Windows 배율과 사용자 글자 크기 설정을 따른다. 한국어는 `word-break: keep-all`로 낱말 중간에서 줄을 바꾸지 않는다.

### Named Rules
**The 고정폭 숫자 Rule.** 숫자가 들어간 칸과 줄은 늘 `tabular-nums`(`.vt-num`)다. 숫자 열은 머리와 칸 모두 오른쪽 정렬이다. 숫자 꾸미기는 `format/money.ts`의 함수만 쓰고 화면에서 직접 만들지 않는다.

**The AI 꼬리표 Rule.** AI가 쓴 문장은 `AiText`로만 쓰고, 덩어리마다 "AI 해석"·"AI 요약" 꼬리표를 한 번 붙인다(옅은 강조 바탕의 작은 표지). 글꼴은 바꾸지 않는다. "AI의 말"은 꼬리표와 왼쪽 선이 알린다.

### 숫자 표기 (스펙 9-1)
| 무엇 | 함수 | 예 |
|---|---|---|
| 원화 금액 | `formatWon` | `71,400원` |
| 원화 변화량(표 안) | `formatWonChange` | `+1,200`, `−3,300`, `0` |
| 원화 변화량(문장 안) | `formatWonChange(v, { unit: true })` | `+1,200원` |
| 달러 금액 | `formatUsd` | `$227.48`, `−$1.87` |
| 달러 변화량 | `formatUsdChange` | `+$2.13`, `$0.00` |
| 등락률(입력은 퍼센트 값) | `formatPercent` | `+1.71%`, `0.00%` |
| 지수 | `formatNumber(v, 2)`, `formatSigned(v, 2)` | `2,583.27`, `+21.48` |
| 수급(입력은 원, 부호) | `formatEokChange` | 10억 이상 정수 `+3,124억`, 10억 미만 소수 1자리 `+0.4억`, 반올림해 0이어도 부호 `+0.0억`, 0은 `0.0억` |
| 억 금액(입력은 원, 부호 없음) | `formatEok` | `3,124억`, `0.4억`, 음수만 `−987억` |
| 값 없음 | 모든 함수 | `—` (화면 읽기 프로그램에는 "데이터 없음") |

음수 부호는 하이픈이 아니라 빼기 기호 `−`(U+2212)다. 고정폭 숫자에서 `+`와 너비가 같아 열이 흔들리지 않는다.

### 글꼴 파일 (오프라인)
실행 중 CDN을 쓰지 않는다. `apps/desktop/src/design-system/fonts/`에 woff2로 넣었고 SIL OFL 1.1이다(라이선스 파일 동봉). 다시 받는 명령은 `fonts/make-fonts.sh`.

| 파일 | 크기 | 내용 |
|---|---|---|
| `Pretendard-Regular.subset.woff2` | 267,096 B | Pretendard 1.3.9 공식 서브셋 400, 한글 2,780자 |
| `Pretendard-Medium.subset.woff2` | 268,324 B | 500 |
| `Pretendard-SemiBold.subset.woff2` | 268,752 B | 600 |
| `Pretendard-Bold.subset.woff2` | 270,784 B | 700 |
| 합계 | 1,074,956 B (약 1.03 MiB) | 예전의 명조 Hahmlet(398,648 B)을 빼서 약 27% 줄었다 |

## Layout

**창 틀** (`AppShell`): 왼쪽 사이드바 200px(`12.5rem`, 흰 바탕, 오른쪽 1px `line`) + 본문(캔버스) + 하단 상태 표시줄 28px(흰 바탕, 위 1px `line`). 오프라인 같은 배너는 본문 열의 맨 위에 붙는다. 본문 안쪽 여백은 16px.

**대시보드(홈).** 본문 머리줄(대시보드 탭 + [배치 편집], 52px, 흰 바탕) → 맨 위 숫자 줄(`KpiTile` 최대 5개, 같은 너비) → 칸 배치(칸 카드 1~6개, 칸 사이 12px). 칸 배치는 `ui/dashboard`의 분할 나무가 정한다. 디자인 시스템은 칸 하나(`Card`)와 그 안의 부품을 준다.

**최소 창 1024×600.** 너비는 64rem(1024px) 아래로 줄이지 않고 가로로 스크롤한다. 높이는 막지 않는다(1080p를 150%로 쓰면 최대화 창도 CSS 높이가 약 640px). 상태 표시줄은 늘 보이고 본문이 스크롤한다. 1024×600에서는 카드 머리의 설명이 말줄임표로 줄고, 표의 미니 차트 열 같은 부가 열은 화면이 숨긴다.

**넘침 규칙.** 긴 종목명·카드 제목·설명은 한 줄 말줄임표(`text-overflow: ellipsis`, 원문은 `title`이나 읽기 이름으로). 큰 숫자는 줄을 바꾸지 않고, 칸이 좁으면 숫자 카드의 미니 차트가 먼저 사라진다. 카드 머리의 행동 버튼은 줄어들지 않는다(`flex: none`).

**간격.** 4px 격자(`--space-*`), 모두 rem. 카드 안쪽 16px(`--space-card`), 칸 사이 12px(`--space-gap`).

## Elevation & Depth

깊이는 두 단계뿐이다.
- **칸 카드**: `--shadow-card`(1px·8px 번짐의 아주 옅은 남색 그림자). 캔버스와 카드의 밝기 차이가 주된 구분이고 그림자는 거든다.
- **떠 있는 것**(메뉴, 목록 상자, 대화 상자): `--shadow-pop`(더 진하고 넓은 그림자) + 1px `line` 테두리. 대화 상자 뒤는 `--color-scrim`으로 어둡게.

그라데이션은 차트의 영역 채우기(방향 색, 위에서 아래로 옅어짐)에만 쓴다. 글로우, 배경 흐림은 쓰지 않는다.

## Shapes

- 칸 카드 8px(`radius-md`), 떠 있는 메뉴·대화 상자 10px(`radius-pop`), 버튼·입력·세그먼트 6px(`radius-control`), 칩·꼬리표·표 머리 모서리 4px(`radius-sm`), 상태 점·스위치·배지는 원(`radius-round`).
- 선: 경계·행 1px, 포커스 링 2px(강조색, offset 2px), 활성 탭 밑줄 3px.

## Components

부품은 `apps/desktop/src/design-system/index.ts`에서만 가져온다. 전역 스타일은 앱 진입점에서 한 번 `import './design-system/styles.css'`. 기존 부품의 이름과 속성은 바꾸지 않았다(겉모습만 새로).

### 그릇
- **Card**: 칸 하나. 흰 바탕, 8px, 옅은 그림자, 안쪽 16px. 머리 = 제목(h2 16px 반굵게) + 설명 한 줄(13px `ink-3`, 말줄임) + 오른쪽 `actions`(보통 `⋯` `Menu`). `padded={false}`면 본문 여백 없이(표를 카드 끝까지).
- **Section**: 예전 구역. 이제 `Card`와 같은 모양이다(제목 + `meta`는 설명 줄 + `actions`). 안쪽 구역(`headingLevel` 3·4)은 카드가 아니라 위 1px `rule`과 14px 반굵은 제목만 있는 묶음이다(카드 안 카드 금지).
- **KpiTile**: 숫자 카드. 이름표(12px `ink-3`, 앞에 8px 중립 `tag` 네모) → 큰 숫자(28px) → 변화(12px, 보통 `PriceChange`) + 오른쪽 아래 미니 차트 자리(`chart`). 높이 고정, 좁으면 미니 차트가 먼저 숨는다.

### Buttons
- 높이 32px(`md`) / 26px(`sm`), 모서리 6px, 글자 13px 500.
- **Primary:** 강조 바탕 + 흰 글자, 호버 `accent-strong`. 한 화면에 하나.
- **Secondary(기본):** 흰 바탕 + 1px `control` 테두리 + `ink-2` 글자. 호버 때 테두리가 `ink-3`.
- **Quiet:** 강조색 글자의 링크 모양 버튼("브리핑 읽기 ›", "종목 추가"). 호버 때 밑줄.
- **Icon:** 아이콘만 있는 28px 버튼(칸 머리의 `⋯`, 대화 상자 닫기). 테두리 없이 `ink-3` 아이콘, 호버·열림 때 `hover` 바탕. 이름은 반드시 `aria-label`로 준다. 아이콘만 있는 버튼은 이것뿐이다.
- **Disabled:** 교차 행 바탕 + `ink-3` 글자. **Busy:** 모양을 두고 글자만 흐리게, `aria-busy`·`aria-disabled`로 포커스는 둔다.

### Inputs / Fields
- 공통: 높이 32px, 흰 바탕, 1px `control` 테두리, 6px 모서리, 13px 글자. 포커스는 테두리 강조색 + 2px 포커스 링. 이름표는 위에 12px 500 `ink-2`, 도움말은 아래 12px `ink-3`. 막힌 것은 교차 행 바탕.
- **TextField**: `label`, `hint`, `error`, `maxLength`(남은 글자 수 표시). 오류면 테두리와 문구가 황토(`caution`/`caution-ink`)이고 `aria-invalid` + `aria-describedby`로 문구를 연결한다. 빨강을 쓰지 않는다.
- **Select**: 네이티브 `<select>` 대신 WAI-ARIA listbox(콤보 버튼 + 목록 상자). 버튼에 이름표와 지금 값, 오른쪽 `⌄`. 열면 ↑↓로 옮기고 Home·End, Enter·Space로 고르고 Esc로 닫으며 초점은 버튼으로 돌아온다. **막힌 항목은 건너뛰고**, 이유(`reason`)는 항목 아래 작은 글자로 보이고 `aria-describedby`로 읽힌다.
- **SegmentedControl**: 라디오 그룹(`radiogroup`). 옅은 회색 홈 안에 버튼들, 선택은 흰 바탕 + 먹 글자 + 옅은 그림자. ←→(↑↓)로 옮기며 바로 고른다. 선택된 항목만 Tab 순서에 든다.
- **Toggle**: 스위치(`role="switch"`). 36×20px, 켜짐은 강조 바탕, 꺼짐은 `control-strong` 바탕. Space·Enter로 바꾼다. 이름표는 왼쪽.
- **ProgressBar**: 6px 높이 막대, 바탕 `rule`, 채움 강조색. `role="progressbar"` + `aria-valuenow`(0~100).

### 떠 있는 것
- **Menu**: `⋯` 같은 트리거 버튼(`aria-haspopup="menu"`)에서 여는 메뉴. ↑↓·Home·End로 옮기고 Enter로 고른다. Esc나 밖을 누르면 닫히고 초점은 트리거로. 막힌 항목은 건너뛰고 이유를 보인다.
- **Dialog**: 모달(`role="dialog"`, `aria-modal`). 가운데 480px, 10px 모서리, 진한 그림자, 뒤는 scrim. 열리면 첫 입력에 초점, Tab은 안에서만 돈다. Esc나 닫기 버튼으로 닫고 초점은 연 버튼으로 돌아간다. 아래 `footer`에 [취소] [확인].

### Navigation
- **SidebarNav**: 흰 바탕, 200px. 위에 워드마크 "Vater" + "투자 보조", 그 아래 "주 메뉴" 링크 5개, 아래쪽에 감시 상태와 연결 서버 자리. 항목은 높이 38px, 18px 선 아이콘(`tag` 회색) + 글자 14px 500. 현재 화면은 `accent-weak` 바탕 + `accent-strong` 글자 + 강조색 아이콘 + `aria-current="page"`. 새 소식 배지는 강조색 원 + 흰 숫자.
- **Tabs**: WAI-ARIA 탭. `line`(본문 탭: 선택된 탭 아래 3px 강조색 밑줄, 글자는 먹 굵게)과 `segment`(작은 전환: `SegmentedControl`과 같은 모양). ←→로 옮기며 바로 선택, Home·End.
- **StatusBar**: 흰 바탕, 28px, 12px 글자. 항목마다 상태 점 + 굵은 이름 + 설명, 항목 사이 1px 세로선, 마지막 항목은 오른쪽 끝. 담는 것은 스펙 9-1대로 시장 상태, 한투 연결, AI 엔진, 마지막 수신 시각.

### 표 (DataTable)
- 머리줄 30px: `table-head` 바탕 + `on-table-head` 12px 반굵게, 위 양 끝 모서리 4px. 행 38px, 짝수 행 `row-alt`, 아래 1px `rule`. 숫자 열은 오른쪽 정렬 + 고정폭.
- 행 동작이 있으면 행 하나만 Tab 순서에 들어가고 ↑↓·Home·End로 옮기며 Enter·Space·클릭으로 연다. 호버는 `hover` 바탕, 포커스는 2px 강조 테두리.
- 빈 표: 머리줄은 열 수 그대로 두고, 그 아래 한 행(`colSpan` = 열 수)에 다음에 할 일을 알려 준다. 빈 표는 열을 고르게 나눈다(`table-layout: fixed`).
- `truncate` 열(보통 종목명)은 남는 너비를 차지하고 넘치면 한 줄 말줄임표, 글자면 `title`로 전체를 보인다.

### 차트
직접 그린 SVG다(라이브러리 없음). 축 눈금 12px `ink-3`, 격자 1px `rule`.
- **LineChart**: 선(1.8px) + 영역(방향 색, 위 16% → 아래 0%), `baseline`(전일 종가)은 점선 + 오른쪽 회색 값 표지, 마지막 값은 방향 색 바탕의 흰 글자 표지와 점. y축 눈금 3개(오른쪽, 1·2·5 단위의 보기 좋은 값, 값 표지와 겹치면 숨김), x축 라벨은 처음·가운데·끝. 마우스를 올리면 점선 세로선과 그 자리의 값(장식, 읽기는 요약 문장이 맡음). 부모 크기를 따른다(`ResizeObserver`, `height`를 주면 그 높이). 값 0개면 "자료 없음", 1개면 점 하나, 모두 같으면 평평한 선, `null`은 선을 끊는다. `role="img"`와 처음·끝 값을 담은 요약 문장.
- **DivergingBar**: 가운데 0 기준선(1px `control-strong`), 양수는 오른쪽 `up`, 음수는 왼쪽 `down`, 값 라벨은 같은 방향 색(`SignedNumber`처럼 부호와 함께). 0은 막대 없이 회색 `0`. 수급(외국인·기관·개인)에 쓴다.
- **Sparkline**: 1.5px 선 하나와 끝점. 색은 옆에 놓인 숫자와 같은 자료여야 한다(`direction`). 없으면 먹.

### 상태 (FeedStatus, StatusDot, Banner, MarketState)
- **FeedStatus:** 실시간(채운 먹 점) / 폴링 · 30초(황토 점) / 끊김 · 재연결 중(굵은 황토 원 + 황토 굵은 글자) / 장 마감(빈 원) / **감시 안 함**(`idle`, 빈 원 + `ink-3` 글자). 점은 장식이고 글자가 상태를 말한다.
- **Banner:** 본문 위 띠. 위쪽 2px 선 + 바탕. `caution`(황토)과 `info`(흰 바탕 + `control` 선). 제목 한 줄 + 원인 + 해결 버튼. 둘 다 `role="status"`.
- **MarketState:** 칩(교차 행 바탕, 4px) 또는 상태 표시줄 안 `inline`. 장중은 채운 점, 마감·휴장은 빈 원.

### 부호 숫자 (SignedNumber, PriceChange)
- 부호(`+`, `−`), 고정폭, 오른쪽 정렬. `tone="direction"`(기본)은 상승 빨강·하락 파랑·보합 회색으로 값의 방향과 수급에만. `tone="neutral"`은 부호만 두고 먹 글자(목표가 괴리율처럼 방향이 아닌 값).

### 의견 눈금 (DecisionScale)
- 결정 6가지를 5칸 눈금 위의 위치로 보여 준다. 빈 칸은 1px `ink-3` 테두리, 한 칸만 채운다: 매수 쪽 `up`, 매도 쪽 `down`, 보유 먹. 결정 이름은 굵은 12px 먹 글자. 검토 필요는 눈금 밖(다섯 칸을 비우고 황토 테두리). 진하게 채운 버튼 모양으로 만들지 않는다(주문 버튼처럼 읽히면 안 된다).

### AI 문장 (AiText)
- `lead`(16/24, 600, 먹)와 `body`(14/22, 400, `ink-2`, 최대 40rem). 왼쪽 2px `accent-weak` 선 + 12px 들여쓰기, `data-voice="ai"`. 꼬리표("AI 해석")는 `accent-weak` 바탕 + `accent-strong` 11~12px 반굵은 글자의 작은 표지.

### 면책 문구 (Disclaimer)
- 스펙 문구 그대로, 12px `ink-3`. 문구를 바꾸지 않는다.

### 움직임
- 상태가 바뀔 때만 120~180ms(`--duration-fast`, `--duration-base`, `--ease-out`)로 색·그림자가 바뀐다. 들어오는 연출, 로딩 애니메이션은 없다. "움직임 줄이기" 설정에서는 0ms.

## Do's and Don'ts

### Do:
- **Do** 칸은 `Card`(또는 `Section`) 하나로 만들고, 안은 선·교차 바탕·여백으로 나눈다.
- **Do** 숫자는 `format/money.ts`로 꾸미고 `.vt-num`(tnum)으로 오른쪽 정렬한다. 음수는 `−`(U+2212).
- **Do** 선택·주 버튼·활성 탭·링크·포커스에만 강조색을 쓴다.
- **Do** 분류 표지(지수 이름 옆 네모, 메뉴 아이콘)는 중립 `tag`로 둔다.
- **Do** 오류·끊김·오프라인·폴링·검토 필요는 황토와 글자로, 원인과 해결 버튼을 함께 보여 준다.
- **Do** 막힌 선택지(배치 틀, 칸 내용, 목록 항목)는 숨기지 말고 막고, 이유를 보인다.
- **Do** 새 색이 필요하면 역할 이름으로 `tokens.css`에 더하고, 대비 조합을 `tokens.test.ts`에 추가한다.
- **Do** 1280×800, 1024×600, 배율 1.5에서 `gallery.html`을 찍어 보고 나서 합친다.

### Don't:
- **Don't** 빨강·파랑을 방향 말고 다른 뜻(분류, 오류, 강조, 링크, 브랜드)으로 쓰지 않는다.
- **Don't** 카드 안에 카드를 넣지 않는다.
- **Don't** 두 번째 강조색이나 색으로 칠한 분류 표지를 만들지 않는다.
- **Don't** 결정 배지를 진하게 채운 버튼처럼 만들거나 "매수하기" 같은 행동 유도를 두지 않는다. Vater는 주문 기능이 없다.
- **Don't** 부품 CSS에 색 값을 직접 쓰지 않는다(`var(--color-*)`만).
- **Don't** 실행 중 CDN에서 글꼴·아이콘·스타일을 받지 않는다.
- **Don't** 12px보다 작은 글자(꼬리표의 11px 예외는 README), 회색만으로 된 본문을 쓰지 않는다.

## 결정 기록

근거 문서: 설계 스펙(`docs/superpowers/specs/2026-11-02-vater-mvp-design.md`), 대시보드 개편 스펙(`docs/superpowers/specs/2026-11-03-dashboard-design.md`), `PRODUCT.md`.

| # | 결정 | 이유 |
|---|---|---|
| 1 | 시각 방향은 **"대시보드 라이트"**(시안 1): 회색 캔버스 + 흰 칸 카드 | 사용자가 Power BI처럼 칸을 짜는 홈을 원했고(2026-11-03), 시안 1·2·3 중 리드가 골랐다. 이전 "리서치 노트"(흰 종이 + 먹선)는 칸을 나눠 놓는 화면에서 칸의 경계가 약했다. |
| 2 | **Pretendard 하나**, 명조 Hahmlet 삭제 | 스펙 5장. 칸이 좁아 명조 문장이 1배율에서 고딕과 거의 구별되지 않았고(이전 비평), "AI의 말"은 꼬리표와 선으로 충분하다. 번들이 399KB 줄었다. |
| 3 | **강조색은 보라 하나**(`#7a45d8`), 빨강·파랑과 색상 40도 이상 | 파랑과 가까운 남보라(시안 `#6a43d8`, 하락 파랑과 37도)는 선택 표시가 "하락"으로 읽힐 수 있다. 테스트가 거리를 잰다. |
| 4 | **빨강·파랑은 값의 방향 전용**(시세, 수급, 의견 눈금), 늘 부호와 함께 | 국내 관례이자 사용자가 정한 고정 규칙(스펙 9-1). 시안의 코스피 빨강·코스닥 파랑 표지는 중립 `tag`로 바꿨다. |
| 5 | 오류·끊김·오프라인·폴링·검토 필요는 **황토**, 빨간 오류는 쓰지 않음 | 빨강이 상승을 뜻하므로 오류에 쓰면 뜻이 겹친다. 입력 오류도 황토다. |
| 6 | 표 머리줄은 **짙은 남색**, 행은 교차 바탕 | 칸이 여러 개인 화면에서 표의 시작이 한눈에 보인다(시안 1). 남색은 채도가 낮아 방향 색과 겹치지 않는다. |
| 7 | 예전 토큰 이름은 **별칭으로 남김** | `ui/screens`의 화면 CSS가 70여 곳에서 쓴다. 지우면 그 화면이 말없이 색을 잃는다. `ui/dashboard`에서 화면을 다시 입힐 때 지운다. |
| 8 | 기존 부품은 **이름·속성 유지, 겉모습만 새로** | 스펙 5장. 화면 테스트가 그대로 산다. `Section`도 카드 모양이 되어 화면이 손대지 않아도 새 디자인을 입는다. |
| 9 | Select·Menu는 **네이티브 대신 WAI-ARIA 패턴** | 막힌 항목에 이유를 붙여야 하고(스펙 2장 "막힌 내용은 이유와 함께"), 네이티브 `<select>`는 항목 안에 설명을 둘 수 없다. |
| 10 | 차트는 **직접 그린 SVG**, 라이브러리 없음 | 스펙 5장. 필요한 것은 선·영역·막대 둘뿐이고 의존성을 늘리지 않는다. |
| 11 | 최소 창 **1024×600**, 크기는 rem, 높이는 막지 않음 | 1024×600 시안에서 칸 4개가 들어간다. 1080p 150%에서도 상태 표시줄이 보인다. |
| 12 | 숫자 표기: 원화 `71,400원`, 표 안 변화량 `+1,200`, 달러 `$227.48`, 등락률 `+1.71%`, 음수 `−`, 값 없음 `—`, 억 `formatEok`/`formatEokChange` | 스펙 9-1과 이전 결정 그대로. 부호 없는 억 금액이 필요해 `formatEok`를 더했다. |
| 13 | 반올림해 0이 되어도 0이 아니면 부호와 색을 남긴다(`+0.00%`) | 색과 부호가 서로 다른 말을 하지 않게 한다. |
| 14 | 표의 행 동작은 행 자체에 포커스(roving tabindex) | 표의 의미를 지키면서 키보드로 행을 고르고 연다. |
| 15 | 의견 눈금: 채운 칸 하나만 방향 색, 결정 이름은 먹 | 빨간 굵은 "매수"가 주문 버튼처럼 읽히지 않게(PRODUCT.md). |
| 16 | busy 버튼은 disabled가 아니라 aria-disabled, 배너는 `role="status"` | 키보드 사용자의 자리를 지키고, 바뀌는 배너가 읽기를 끊지 않게. |
| 17 | Sparkline은 `direction`이 없으면 먹 | 30일 선의 처음·끝 비교 색이 옆 전일 대비 숫자의 색과 다를 수 있다. |
| 18 | 상태 표시줄은 시장·한투 연결·AI 엔진, 감시 상태는 사이드바 아래쪽 한곳 | 같은 상태가 여러 곳에서 서로 다른 말을 하지 않게. 살아 있음 표시는 초록을 들이지 않고 채운 먹 점(색 묶음을 넷으로 유지). |

## 확인한 방법

- `npm test`: 숫자 표기, 토큰 대비·색상 거리·채도·방향 색 사용처, 글꼴 파일·용량·라이선스·외부 URL 없음, 부품별 접근성(이름, 역할, 키보드).
- `npm run lint`(ESLint + jsx-a11y strict + Prettier), `npm run typecheck`, `npm run build`.
- 견본(`gallery.html`)을 1280×800, 1024×600, 배율 1.5에서 찍었다: `docs/design/system/shots/`. 의도한 예외는 `apps/desktop/src/design-system/README.md`.
