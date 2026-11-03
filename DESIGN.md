---
name: Vater
description: 리서치 노트처럼 읽히는 개인 투자 보조 앱. AI가 쓴 문장은 명조, 데이터에서 나온 숫자는 고딕.
colors:
  paper: "#ffffff"
  chrome: "#f6f6f4"
  hover: "#f1f1ee"
  selected: "#e9e9e5"
  selection: "#e6e1c8"
  rule-section: "#141414"
  line: "#e2e2de"
  rule: "#ecece8"
  control: "#c4c4bf"
  ink: "#141414"
  ink-2: "#474745"
  ink-3: "#5f5f5c"
  ink-hover: "#333331"
  on-ink: "#ffffff"
  up: "#c62a2f"
  down: "#1d57bf"
  caution: "#b7791f"
  caution-bg: "#fff4d8"
  caution-ink: "#6f4600"
  focus: "#141414"
typography:
  screen-title:
    fontFamily: "Pretendard, Malgun Gothic, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: "1.75rem"
    letterSpacing: "-0.01em"
  ai-lead:
    fontFamily: "Hahmlet, Noto Serif KR, Batang, serif"
    fontSize: "1.25rem"
    fontWeight: 500
    lineHeight: "1.875rem"
    letterSpacing: "-0.01em"
  section-title:
    fontFamily: "Pretendard, Malgun Gothic, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 700
    lineHeight: "1.5rem"
  ai-body:
    fontFamily: "Hahmlet, Noto Serif KR, Batang, serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: "1.5rem"
  body:
    fontFamily: "Pretendard, Malgun Gothic, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  numeric:
    fontFamily: "Pretendard, Malgun Gothic, system-ui, sans-serif"
    fontSize: "0.875rem"
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
    fontFamily: "Hahmlet, Noto Serif KR, Batang, serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: "1.75rem"
    letterSpacing: "-0.01em"
rounded:
  sm: "4px"
  round: "999px"
spacing:
  "0-5": "0.125rem"
  "1": "0.25rem"
  "1-5": "0.375rem"
  "2": "0.5rem"
  "2-5": "0.625rem"
  "3": "0.75rem"
  "4": "1rem"
  "5": "1.25rem"
  "6": "1.5rem"
  "8": "2rem"
  "10": "2.5rem"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 0.75rem"
    height: "2rem"
  button-primary-hover:
    backgroundColor: "{colors.ink-hover}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 0.75rem"
    height: "2rem"
  button-quiet:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "0 0.25rem"
    height: "2rem"
  button-disabled:
    backgroundColor: "{colors.chrome}"
    textColor: "{colors.ink-3}"
  tab-segment:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-2}"
    typography: "{typography.meta}"
    rounded: "{rounded.sm}"
    padding: "0 0.625rem"
    height: "1.625rem"
  tab-segment-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
  nav-item:
    textColor: "{colors.ink-2}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 0.625rem"
    height: "2.25rem"
  nav-item-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ink}"
  nav-item-current:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.ink}"
  market-chip:
    backgroundColor: "{colors.chrome}"
    textColor: "{colors.ink-2}"
    typography: "{typography.meta}"
    rounded: "{rounded.sm}"
    padding: "0 0.625rem"
    height: "1.625rem"
  banner-caution:
    backgroundColor: "{colors.caution-bg}"
    textColor: "{colors.caution-ink}"
    typography: "{typography.label}"
    padding: "0.25rem 0.75rem"
  banner-info:
    backgroundColor: "{colors.chrome}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    padding: "0.25rem 0.75rem"
  table-row:
    textColor: "{colors.ink}"
    typography: "{typography.numeric}"
    height: "2.5rem"
  table-row-hover:
    backgroundColor: "{colors.hover}"
  status-bar:
    backgroundColor: "{colors.chrome}"
    textColor: "{colors.ink-2}"
    typography: "{typography.meta}"
    height: "2rem"
  sidebar:
    backgroundColor: "{colors.chrome}"
    width: "13.5rem"
---

# Design System: Vater

이 문서가 디자인 시스템의 기준이다. 값의 원본은 `apps/desktop/src/design-system/tokens.css`이고, 위 머리말(frontmatter)은 그 값을 옮긴 것이다. 둘이 다르면 `tokens.css`가 맞고 이 문서를 고친다. 모든 컴포넌트는 `apps/desktop/gallery.html`(`npm run dev` 후 `/gallery.html`)에서 실제 상태로 볼 수 있다. 제품의 사실(사용자, 목적, 제약)은 `PRODUCT.md`에 있다.

## Overview

**Creative North Star: "리서치 노트"**

Vater는 증권사 리서치 리포트처럼 읽힌다. 흰 종이에 먹으로 쓰고, 구역은 상자로 가두지 않고 위쪽의 굵은 먹선 한 줄과 여백으로 나눈다. 국내 개인 투자자가 이미 익숙한 문서의 문법(첫 장의 투자의견, 표로 정리된 숫자, 해설 문단)을 그대로 쓰되, 이 앱만의 사실 하나를 글꼴로 드러낸다. **AI가 쓴 문장은 명조(Hahmlet), 데이터에서 나온 숫자와 화면 글자는 고딕(Pretendard)**이다. 사용자는 설명을 읽지 않아도 "이건 AI의 해석이고, 저 숫자는 데이터"라는 것을 눈으로 구분한다(스펙 D9 "브리핑의 숫자는 LLM이 쓰지 않는다", 원칙 "숫자는 데이터에서 나온다").

크롬(사이드바, 상태 표시줄, 버튼)에는 색이 없다. 그래서 화면에서 색은 두 가지 뜻만 가진다. 빨강·파랑은 시세 방향, 황토는 주의(폴링, 끊김, 오프라인, 오류, 검토 필요)다. 앱은 대부분의 시간을 트레이에서 조용히 감시하다가 가끔 열리므로, 평소 화면은 차분하고 바뀐 것만 눈에 띈다. 밀도는 중간이며 읽기 여유를 둔다(행 40px, 본문 14px, AI 첫 문장 20px).

거부한 것: 회색 바탕 위 둥근 흰 카드(국내 금융 앱 표준, 시안 C), 짙은 색 크롬(시안 A의 초록), 다크 OLED와 초록 상승 색(ui-ux-pro-max 추천, 국내 관례와 충돌), 진하게 채운 매수·매도 모양 배지, 그림자·그라데이션·유리 효과.

**Key Characteristics:**
- 흰 종이와 먹. 구역은 위쪽 2px 먹선과 여백으로 나눈다. 카드 상자를 쓰지 않는다.
- AI 문장만 명조, 나머지는 모두 고딕. 숫자는 늘 고정폭(tnum)이고 오른쪽 정렬.
- 빨강·파랑은 시세 방향 전용, 늘 부호와 함께. 오류도 빨강이 아니라 황토.
- 결정은 5칸 "의견 눈금"의 위치로 보여 주고, 검토 필요는 눈금 밖.
- 라이트 테마 하나. 모든 색은 역할 이름의 토큰이라 다크 테마는 값만 더하면 된다.

## Colors

종이와 먹의 무채색 위에, 의미가 정해진 색 두 묶음(시세 방향, 주의)만 얹는다.

### Primary
- **먹 Ink** (`ink`): 글자, 주 버튼의 바탕, 구역 위 2px 먹선(`rule-section`), 포커스 링(`focus`), 세그먼트 탭의 선택 상태. 흰 종이 위 18.4:1.
- **먹 호버** (`ink-hover`): 주 버튼에 마우스를 올렸을 때만.

### Secondary
- **상승 빨강** (`up`): 상승한 변화량·등락률 숫자, 상승 미니 차트 선, 의견 눈금의 매수 쪽 칸. 흰 종이 위 5.57:1, 사이드바 현재 위치 바탕 위에서도 4.57:1.
- **하락 파랑** (`down`): 하락 숫자와 선, 의견 눈금의 매도 쪽 칸. 흰 종이 위 6.63:1.

### Tertiary
- **황토** (`caution`): 폴링 상태 점, 주의 배너의 위 선, 검토 필요 눈금 테두리. 글자에는 쓰지 않는다(흰 종이 위 3.64:1로 그래픽 기준 3:1만 넘는다).
- **황토 글자** (`caution-ink`): 끊김 상태 글자, 주의 배너 글자, "검토 필요". 배너 바탕(`caution-bg`) 위 7.52:1.
- **황토 바탕** (`caution-bg`): 주의 배너의 바탕.

### Neutral
- **종이** (`paper`): 본문 바탕. 앱 전체의 기본 면.
- **크롬** (`chrome`): 사이드바, 상태 표시줄, 시장 상태 칩, 안내 배너. 종이보다 한 단계 어둡다.
- **호버** (`hover`), **선택** (`selected`): 표 행과 메뉴의 호버, 사이드바의 현재 화면.
- **글자 선택** (`selection`): 마우스로 긁은 글자의 바탕. 브라우저 기본 파랑을 쓰지 않는다(파랑은 하락).
- **선 3단계**: 표 머리 아래선과 크롬 경계(`line`), 행 구분선(`rule`), 버튼 테두리(`control`).
- **보조 글자 2단계** (`ink-2`, `ink-3`): 9.31:1, 6.41:1. 가장 옅은 `ink-3`도 크롬·호버·선택 바탕 위에서 5.26:1 이상이다.

모든 글자·바탕 조합(27쌍)과 그래픽·바탕 조합(8쌍)의 대비를 `tokens.test.ts`가 실제 값으로 계산해 검사한다. 같은 테스트가 CSS가 쓰는 토큰이 모두 정의되어 있는지, 정의만 하고 쓰지 않는 색 토큰이 없는지도 본다. 시안 B 팔레트에 있던 옅은 상승·하락 바탕, 진한 상승·하락 글자, 황토 테두리는 쓰는 곳이 없어 넣지 않았다. 필요해지면 역할 이름으로 다시 더한다.

### Named Rules
**The 두 가지 뜻 Rule.** 빨강과 파랑은 시세 방향에만 쓴다. 미국 종목도 상승은 빨강이다. 오류, 끊김, 오프라인, 폴링, 검토 필요는 황토와 글자로 표시하고, 빨간 오류 표시는 만들지 않는다. 예외는 하나뿐이다: 의견 눈금의 채운 칸 하나는 국내 관례대로 매수 쪽 빨강, 매도 쪽 파랑이다. 결정 이름 글자는 먹이다.

**The 부호 Rule.** 방향 색은 늘 부호(`+`, `−`)와 함께 간다. 색만으로 상승·하락을 말하지 않는다. 0은 부호 없이 회색 `0`, `0.00%`이고, 반올림해서 0이 되어도 0이 아니면 부호와 색을 남긴다(`+0.00%`).

**The 역할 이름 Rule.** 컴포넌트 CSS는 `var(--color-*)`만 쓰고 색 값을 직접 쓰지 않는다(테스트가 막는다). 1차 버전은 라이트 테마만 낸다. 다크 테마는 `tokens.css`에 `[data-theme='dark']` 블록으로 같은 이름을 다시 정의해서 더한다. `paper`는 "바탕", `ink`는 "글자"라는 역할이므로 다크에서는 값만 뒤집힌다.

## Typography

**Display Font:** Pretendard (맑은 고딕, system-ui 대체)
**Body Font:** Pretendard (맑은 고딕, system-ui 대체)
**AI Voice Font:** Hahmlet (Noto Serif KR, 바탕 대체)

**Character:** Pretendard 하나가 화면 제목, 메뉴, 표, 숫자를 모두 맡고 굵기로 위계를 만든다. Hahmlet은 대비가 낮은 현대 한글 명조라 고딕 옆에서 튀지 않으면서도, 획 끝의 부리와 숫자 모양으로 "다른 목소리"임을 알린다.

### Hierarchy
- **화면 제목** (`screen-title`, 700, 22/28px): 화면마다 하나(h1). "홈", "감시·알림".
- **AI 첫 문장** (`ai-lead`, Hahmlet 500, 20/30px): 브리핑의 첫 문장, 분석 요약의 첫 줄. 화면에서 가장 큰 글자가 AI의 해석일 때도 숫자는 표에서 고딕으로 따로 보인다.
- **구역 제목** (`section-title`, 700, 15/24px): 먹선 아래 구역 머리(h2).
- **AI 본문** (`ai-body`, Hahmlet 400, 15/24px, 보조 글자색): 이어지는 해석 문장, 에이전트 보고서. 한 줄 최대 40rem(한글 약 40자).
- **본문·숫자** (`body`, `numeric`, 400, 14/20px): 표, 목록, 설명. 숫자는 고정폭(tnum).
- **버튼 글자** (`label`, 500, 13px).
- **보조 정보** (`meta`, 400, 12/16px): 구역 머리의 보조 정보, 표 머리, 상태 표시줄, 수신 상태. 12px보다 작게 쓰지 않는다.
- **워드마크** (`wordmark`, Hahmlet 600, 22px): 사이드바의 "Vater"만.

글자 크기는 모두 rem(기준 16px)이라 Windows 배율과 사용자 글자 크기 설정을 따른다. 한국어는 `word-break: keep-all`로 낱말 중간에서 줄을 바꾸지 않는다.

### Named Rules
**The 두 목소리 Rule.** 명조는 AI가 쓴 문장(그리고 워드마크)에만 쓴다. 화면이 쓰는 말, 버튼, 표, 데이터 숫자는 모두 고딕이다. AI 문장 안에 든 숫자는 명조로 남는다. 그 숫자는 데이터가 아니라 AI의 말이기 때문이다. AI 문장은 `AiText` 컴포넌트로만 쓰고, 덩어리마다 고딕 꼬리표("AI 해석", "AI 요약")를 한 번 붙인다.

**The 해설 단락 Rule.** 함렛 한글은 대비가 낮아 1배율 Windows에서 고딕과 거의 같아 보인다(비평에서 확인). 그래서 글꼴만 믿지 않는다: `AiText`는 늘 왼쪽 1px `control` 선과 12px 들여쓰기를 가진 블록이다. 리서치 리포트의 해설 단락처럼, 선과 꼬리표가 "AI의 말"을 표시하고 명조는 결을 더한다.

**The 고정폭 숫자 Rule.** 숫자가 들어간 칸과 줄은 늘 `tabular-nums`(`.vt-num`)다. 숫자 열은 머리와 칸 모두 오른쪽 정렬이다. 숫자 꾸미기는 `format/money.ts`의 함수만 쓰고 화면에서 직접 만들지 않는다.

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
| 수급(입력은 원) | `formatEokChange` | 10억 이상 정수 `+3,124억`, 10억 미만 소수 1자리 `+0.4억` `−3.2억`, 반올림해 0이어도 부호 `+0.0억`, 0은 `0.0억` |
| 값 없음 | 모든 함수 | `—` (화면 읽기 프로그램에는 "데이터 없음") |

음수 부호는 하이픈이 아니라 빼기 기호 `−`(U+2212)다. 고정폭 숫자에서 `+`와 너비가 같아 열이 흔들리지 않는다.

### 글꼴 파일 (오프라인)
실행 중 CDN을 쓰지 않는다. `apps/desktop/src/design-system/fonts/`에 woff2로 넣었고 둘 다 SIL OFL 1.1이다(라이선스 파일 동봉). 다시 만드는 명령은 `fonts/make-fonts.sh`.

| 파일 | 크기 | 내용 |
|---|---|---|
| `Pretendard-Regular.subset.woff2` | 267,096 B | Pretendard 1.3.9 공식 서브셋 400, 한글 2,780자 |
| `Pretendard-Medium.subset.woff2` | 268,324 B | 500 |
| `Pretendard-SemiBold.subset.woff2` | 268,752 B | 600 |
| `Pretendard-Bold.subset.woff2` | 270,784 B | 700 |
| `Hahmlet-400-700.subset.woff2` | 398,648 B | Hahmlet 가변(굵기 400~700), 한글 2,788자(원본 전체), tnum 유지 |
| 합계 | 1,473,604 B (약 1.41 MiB) | 원본: Pretendard 가변 woff2 2.06MB, Hahmlet 가변 TTF 3.56MB |

서브셋에 없는 드문 글자는 대체 글꼴(맑은 고딕, 바탕)로 넘어간다.

## Layout

**창 틀.** 왼쪽 사이드바 216px(`13.5rem`) + 본문 + 하단 상태 표시줄 32px(`2rem`)(`AppShell`). 오프라인 같은 배너는 본문 열의 맨 위에 붙는다. 본문 안쪽 여백은 위 20 · 오른쪽 24 · 아래 24 · 왼쪽 32px.

**최소 창 1024×700(설계 기준).** 너비는 64rem(1024px) 아래로 줄이지 않고 가로로 스크롤한다. 높이는 막지 않는다: 1920×1080 화면을 150%로 쓰면 최대화한 창도 CSS 높이가 약 640px이어서, 높이를 막으면 상태 표시줄이 화면 밖으로 밀려난다. 그래서 상태 표시줄은 늘 보이고 본문과 사이드바가 각자 스크롤한다. Windows 배율 125%·150%에서는 WebView2가 CSS 픽셀 전체를 키우므로 CSS 기준 크기는 그대로이고, 글자와 간격이 rem이라 함께 커진다. 견본을 1280×800, 1024×700, 1280×640, 배율 1.5로 찍어 확인했다(`docs/design/system/shots/`).

**구역 배치.** 본문은 구역(`Section`)을 세로로 쌓는다. 구역 사이는 24px 이상 띄우고, 구역 안의 요소 사이는 그보다 좁게 둔다. 두 열을 쓸 때는 3:2 비율(`minmax(0, 3fr) minmax(0, 2fr)`)이고, 본문 폭이 52rem 이하(1024 창)면 컨테이너 쿼리로 한 열이 된다.

**간격.** 4px 격자(`--space-*`), 모두 rem.

**한 왼쪽 끝.** 구역 먹선, 구역 제목, 표의 첫 열이 모두 같은 왼쪽 끝에서 시작한다. 표의 양 끝 칸에는 안쪽 여백이 없다. AI 문장만 그 끝에 1px 선을 두고 12px 들여 쓴다(해설 단락).

## Elevation & Depth

그림자를 쓰지 않는다. 깊이는 바탕의 한 단계 차이(종이 → 크롬)와 선으로만 나타낸다. 사이드바와 상태 표시줄은 크롬 바탕과 1px `line` 경계, 본문 구역은 위쪽 2px 먹선, 표 행은 1px `rule`이다. 그라데이션, 글로우, 유리(배경 흐림) 효과도 쓰지 않는다.

### Named Rules
**The 평면 Rule.** 쉬고 있는 요소에는 그림자가 없다. 나중에 메뉴나 대화 상자처럼 정말 떠 있는 것이 생기면 그것에만 그림자를 허락하고 이 문서에 그 값을 적는다.

## Shapes

모서리는 거의 직각이다. 버튼, 세그먼트 탭, 칩, 메뉴 항목만 4px(`rounded.sm`)이고, 상태 점만 원(`rounded.round`)이다. 구역, 표, 배너는 모서리가 없는 띠다. 선은 세 굵기만 쓴다: 구역 2px 먹선, 표·경계 1px, 포커스 링 2px.

## Components

컴포넌트는 `apps/desktop/src/design-system/index.ts`에서만 가져온다. 전역 스타일은 앱 진입점에서 한 번 `import './design-system/styles.css'`.

### Buttons
- **Shape:** 4px 모서리, 높이 32px(`md`) / 26px(`sm`).
- **Primary:** 먹 바탕 + 흰 글자. **한 화면에 하나**(예: "새 분석").
- **Secondary(기본):** 흰 바탕 + 1px `control` 테두리. 호버 때 테두리가 `ink-2`로 진해진다.
- **Quiet:** 밑줄 글자 버튼. 구역 머리의 작은 행동("종목 추가", "전체 보기"). 밑줄은 `control` 색, 호버 때 먹.
- **Hover / Focus:** 120ms 색 전환. 포커스는 2px 먹 테두리(offset 2px).
- **Disabled:** 크롬 바탕 + `ink-3` 글자, 누를 수 없음.
- **Busy:** 원래 모양을 두고 글자만 흐리게, 마우스는 진행 중 모양. `aria-busy`·`aria-disabled`로 누름만 막고 포커스는 그대로 둔다(키보드 사용자의 자리가 처음으로 돌아가지 않게). 글자를 "확인 중…"처럼 바꾼다. 가운데에서 도는 표시(스피너)는 쓰지 않는다.
- 기본 `type="button"`. 아이콘은 글자 앞의 장식이고, 아이콘만 있는 버튼은 만들지 않는다.

### Chips
- **MarketState 칩:** 크롬 바탕, 4px 모서리, 26px 높이. 상태 점 + 굵은 이름("국내 장중") + 다음 시각("15:30 마감"). 장중은 채운 먹 점, 마감·휴장은 빈 원. 상태 표시줄 안에서는 `variant="inline"`.

### Cards / Containers
- 카드는 없다. **`Section`**이 유일한 그릇이다: 위쪽 2px 먹선, 높이 36px 머리(제목 h2 + 보조 정보 + 오른쪽 끝 행동), 그 아래 본문. 바탕색도, 테두리 상자도, 그림자도 없다. 구역 머리의 행동은 조용한 버튼이나 세그먼트 탭이다.
- 구역 안의 구역(`headingLevel` 3·4)은 1px 먹선과 14px 반굵은 제목으로 한 단계 낮다.

### Inputs / Fields
- 아직 없다. 입력 칸은 `ui/screens`의 첫 실행 마법사·설정 화면을 만들 때 이 문서의 규칙(1px `control` 테두리, 4px 모서리, 32px 높이, 2px 먹 포커스 링, 오류는 황토 글자로 원인과 해결 방법)으로 더하고 이 절을 채운다.

### Navigation
- **SidebarNav:** 크롬 바탕, 216px. 위에 명조 워드마크 "Vater" + "투자 보조", 그 아래 "주 메뉴" 링크 5개(홈 · 분석 · 감시·알림 · 브리핑 · 설정), 아래쪽에 감시 상태와 연결 서버 자리. 항목은 높이 36px, 18px 선 아이콘 + 글자. 호버는 `hover` 바탕, 현재 화면은 `selected` 바탕 + 굵게 + `aria-current="page"`. 새 소식 배지는 화면에 "새 2", 읽을 때 "새 알림 2건".
- **Tabs:** WAI-ARIA 탭. `line`(본문 탭: 선택된 탭 아래 2px 먹선)과 `segment`(구역 머리의 작은 전환: 선택이 먹 바탕). ←→로 옮기며 바로 선택, Home·End. 탭 목록과 패널을 떨어진 자리에 둘 수 있다.
- **StatusBar:** 크롬 바탕, 32px, 12px 글자. 항목마다 상태 점 + 굵은 이름 + 설명, 항목 사이 1px 세로선, 마지막 항목은 오른쪽 끝(양 끝 여백 20px). 자리가 모자라면 설명을 말줄임표로 줄인다. 담는 것은 스펙 9-1대로 시장 상태, 한투 연결, AI 엔진(+ 마지막 수신 시각)이다. 알림 감시 상태와 일시 중지 버튼은 사이드바 아래쪽 한곳에만 둔다.

### 표 (DataTable)
- 머리 28px(12px `ink-3`, 아래 1px `line`), 행 40px(아래 1px `rule`). 숫자 열은 오른쪽 정렬 + 고정폭.
- 행 동작이 있으면 행 하나만 Tab 순서에 들어가고 ↑↓·Home·End로 옮기며 Enter·Space·클릭으로 연다. 호버·포커스 행은 `hover` 바탕, 포커스는 2px 먹 테두리.
- 빈 표는 한 줄로 다음에 할 일을 알려 준다("아직 규칙이 없습니다. 감시 종목에서 규칙 추가를 누르세요.").

### 의견 눈금 (DecisionScale) — 대표 컴포넌트
- 결정 6가지(사이드카 `Buy`…`Sell`, `REVIEW`)를 5칸 눈금 위의 위치로 보여 준다. 왼쪽 매도(1) → 오른쪽 매수(5). 빈 칸은 속이 빈 1px `ink-3` 테두리(대비 6.4:1), 한 칸만 채운다: 매수 쪽 `up`, 매도 쪽 `down`, 보유 먹. 결정 이름은 굵은 12px 먹 글자로 눈금 오른쪽(빨간 "매수" 글자가 주문 버튼처럼 읽히지 않게).
- **검토 필요**는 눈금 밖이다: 다섯 칸을 모두 비우고 황토 1px 테두리, 이름은 `caution-ink`.
- `role="img"`와 "AI 의견 비중확대: 매도부터 매수까지 5단계 중 4단계" 같은 이름을 준다.
- 큰 크기(`lg`)는 분석 결과 머리에 쓰고, 눈금 양 끝에 "매도", "매수"를 적는다.
- 진하게 채운 버튼 모양으로 만들지 않는다. 주문 버튼처럼 읽히면 안 된다.

### 상태 (FeedStatus, Banner)
- **FeedStatus:** 실시간(채운 먹 점) / 폴링 · 30초(황토 점) / 끊김 · 재연결 중(굵은 황토 원 + 황토 굵은 글자) / 장 마감(빈 원). 점은 장식이고 글자가 상태를 말한다.
- **Banner:** 본문 위 띠. 위쪽 2px 선 + 바탕. `caution`(오프라인, 끊김, 키 오류: 황토)과 `info`(크롬). 제목 한 줄 + 원인 + 해결 버튼("지금 다시 확인", "설정 열기"). 둘 다 `role="status"`(정중히 읽음)다. 배너는 상태가 이어지는 동안 떠 있고 "마지막 수신 14:32:05"처럼 내용이 바뀌므로, `alert`로 하면 바뀔 때마다 읽던 것을 끊는다.

### 미니 차트 (Sparkline)
- 1.5px 선 하나와 끝점(반지름 2) 하나. 축, 눈금, 채우기, 그라데이션은 없다. 값 범위에 맞춰 위아래로 늘린다. 기본 84×22px, rem으로 그린다.
- **색은 옆에 놓인 숫자와 같은 자료여야 한다.** 지수 표라면 그날 전일 대비 방향을 `direction`으로 넘긴다. `direction`이 없으면 처음·끝 비교로 색을 지어내지 않고 먹(보합 색)으로 그린다. 30일 동안 내렸어도 그날은 올랐을 수 있어서, 선과 옆 숫자가 다른 말을 하게 되기 때문이다. `direction`을 주면 이름에 "상승/하락/보합"을 덧붙여 읽어 준다.

### AI 문장 (AiText)
- `lead`(20/30, 500, 먹)와 `body`(15/24, 400, `ink-2`, 최대 40rem). 늘 블록이고 왼쪽 1px `control` 선 + 12px 들여쓰기. `data-voice="ai"`로 표시한다. 꼬리표("AI 해석", "AI 요약")는 고딕 12px `ink-3`로 문장 뒤에. 여러 줄 요약은 `as="div"` 안에 목록을 넣고 꼬리표를 한 번.

### 면책 문구 (Disclaimer)
- 스펙 문구 그대로, 12px `ink-3`. 결과 화면마다 "투자 판단 보조용이며 투자 권유가 아닙니다.", 분석 결과에는 "모델과 실행에 따라 결론이 달라질 수 있습니다."를 덧붙인다. 문구를 바꾸지 않는다.

### 움직임
- 상태가 바뀔 때만 120~180ms(`--duration-fast`, `--duration-base`, `--ease-out`)로 색이 바뀐다. 들어오는 연출, 로딩 애니메이션은 없다. "움직임 줄이기" 설정에서는 0ms.

## Do's and Don'ts

### Do:
- **Do** 구역을 위쪽 2px 먹선(`rule-section`)과 여백으로 나눈다.
- **Do** AI가 쓴 문장은 `AiText`(Hahmlet)로, 그 밖의 모든 글자와 데이터 숫자는 Pretendard로 쓴다.
- **Do** 숫자는 `format/money.ts`로 꾸미고 `.vt-num`(tnum)으로 오른쪽 정렬한다. 음수는 `−`(U+2212).
- **Do** 상승·하락에는 늘 부호를 붙이고, 0은 회색 `0`, `0.00%`로 둔다.
- **Do** 오류·끊김·오프라인·폴링·검토 필요는 황토(`caution*`)와 글자로, 원인과 해결 버튼을 함께 보여 준다.
- **Do** 주 버튼은 한 화면에 하나만 둔다.
- **Do** 새 색이 필요하면 역할 이름으로 `tokens.css`에 더하고, 글자 4.5:1·그래픽 3:1 대비를 `tokens.test.ts`에 추가한다.
- **Do** 최소 창 1024×700과 배율 1.5에서 `gallery.html#shell`을 찍어 보고 나서 합친다.

### Don't:
- **Don't** 빨강·파랑을 시세 방향 말고 다른 뜻(오류, 강조, 링크, 브랜드)으로 쓰지 않는다.
- **Don't** 회색 바탕 위 둥근 흰 카드, 카드 안의 카드를 쓰지 않는다.
- **Don't** 그림자, 그라데이션, 글로우, 배경 흐림을 쓰지 않는다.
- **Don't** 결정 배지를 진하게 채운 버튼처럼 만들거나 "매수하기" 같은 행동 유도를 두지 않는다. Vater는 주문 기능이 없다.
- **Don't** 데이터 숫자를 명조로 쓰거나, AI 문장을 고딕으로 섞지 않는다.
- **Don't** 컴포넌트 CSS에 색 값을 직접 쓰지 않는다(`var(--color-*)`만).
- **Don't** 실행 중 CDN에서 글꼴·아이콘·스타일을 받지 않는다.
- **Don't** 12px보다 작은 글자, 회색만으로 된 본문을 쓰지 않는다.

## 결정 기록

이 디자인 시스템을 만들며 정한 것과 그 이유. 근거 문서는 설계 스펙(`docs/superpowers/specs/2026-11-02-vater-mvp-design.md`), `PRODUCT.md`, 시안 비교(`docs/design/directions/README.md`)다.

| # | 결정 | 이유 |
|---|---|---|
| 1 | 시각 방향은 **B "리서치 노트"**: 흰 종이 + 먹, 카드 상자 대신 2px 먹선 | 사람이 시안 A·B·C 중 골랐다. 주요 화면(분석 결과, 에이전트 보고서, 브리핑)이 긴 글을 읽는 화면이라 읽기에 맞춘 방향이 가장 큰 차이를 낸다. 크롬에 색이 없어 빨강·파랑의 뜻이 하나로 남는다. |
| 2 | **AI 문장만 명조(Hahmlet)**, 숫자를 포함한 나머지는 Pretendard 고정폭 숫자 | 스펙 D9과 원칙 "숫자는 데이터에서 나온다"를 설명 없이 눈으로 보이게 한다. |
| 3 | 결정 배지는 **5칸 의견 눈금**, 검토 필요는 눈금 밖 | 색 배지만으로는 매수와 비중확대가 거의 같아 보인다. 위치로 단계를 보여 주고, 판단 보류를 정직하게 따로 둔다. 진하게 채운 모양을 피해 주문 버튼처럼 보이지 않게 한다. |
| 4 | **빨강·파랑은 시세 방향 전용**(상승 빨강, 하락 파랑, 미국 종목도 같음), 늘 부호와 함께 | 국내 관례이자 사용자가 정한 고정 규칙(스펙 9-1). 색각 이상 사용자를 위해 색만으로 구분하지 않는다. |
| 5 | 오류·끊김·오프라인·폴링·검토 필요는 **황토**, 빨간 오류는 쓰지 않음 | 빨강이 상승을 뜻하므로 오류에 쓰면 뜻이 겹친다. |
| 6 | 1차 버전은 **라이트 테마만**, 색은 역할 이름의 토큰 | 다크 테마 제공 여부는 스펙에 없다. 컴포넌트를 고치지 않고 나중에 값만 더할 수 있게 했고, 테스트가 컴포넌트 CSS의 색 값을 막는다. |
| 7 | **최소 창 1024×700**(설계 기준), 배율 125%·150%에서 깨지지 않음, 크기는 rem | 1024 창에서 사이드바 216px를 빼도 본문 808px로 표 5열이 들어간다. 너비는 그 아래로 줄이지 않고 스크롤한다. 높이는 막지 않는다(1080p를 150%로 쓰면 최대화 창도 CSS 높이가 약 640px). Tauri 창 최소 크기는 `shell/tauri`에서 너비 1024, 높이는 600 정도로 두기를 권한다. |
| 8 | 글꼴은 **앱에 포함한 woff2**: Pretendard는 공식 서브셋 4굵기, Hahmlet은 직접 서브셋한 가변(400~700) | 오프라인 동작. Pretendard는 OFL 예약 글꼴 이름이 있어 직접 서브셋하면 이름을 바꿔야 하므로 저작자가 배포한 서브셋을 그대로 쓴다. Hahmlet은 예약 이름이 없어 3.56MB TTF를 399KB로 줄였다. |
| 9 | 숫자 표기: 원화 `71,400원`, 표 안 변화량 `+1,200`(원 없이), 달러 `$227.48`, 등락률 `+1.71%`, 음수는 `−`(U+2212), 값 없음은 `—` | 스펙 9-1. 표 안에서는 열 머리가 단위를 말하므로 변화량에 "원"을 빼 열이 좁아진다. 빼기 기호는 고정폭에서 `+`와 너비가 같다. |
| 10 | 반올림해 0이 되어도 0이 아니면 부호와 색을 남긴다(`+0.00%`) | 색과 부호가 서로 다른 말을 하지 않게 한다. 정확히 0일 때만 회색 `0.00%`. |
| 11 | 표의 행 동작은 행 자체에 포커스(roving tabindex) | 표의 행·칸 의미를 지키면서 키보드로 행을 고르고 열 수 있게 한다. 행이 많아도 Tab 한 번으로 표를 지난다. |
| 12 | AI 문장은 명조 + **왼쪽 1px 선과 들여쓰기**(해설 단락) | 비평에서 함렛 한글이 1배율에서 고딕과 거의 같아 보인다는 것이 확인되었다. 시안 B의 장치를 지키면서, 글꼴에만 기대지 않고 배치로도 "AI의 말"을 표시한다. |
| 13 | 의견 눈금: 빈 칸은 1px `ink-3` 테두리, **결정 이름은 먹**, 방향 색은 채운 칸 하나에만 | 빈 칸이 1.30:1로 눈금이 안 읽혔고, 빨간 굵은 "매수"가 HTS 주문 버튼을 떠올리게 했다(PRODUCT.md: 주문처럼 읽히는 행동 유도 금지). 시안의 빨강·파랑 칸은 국내 관례로 남겼다. |
| 14 | 상태 표시줄은 시장·한투 연결·AI 엔진, **감시 상태는 사이드바 아래쪽 한곳** | 스펙 9-1의 상태 표시줄 항목을 따르고, 같은 상태를 세 곳에 두어 서로 다른 말을 하는 일을 막는다. |
| 15 | busy 버튼은 disabled가 아니라 aria-disabled | disabled는 포커스를 빼앗아 키보드 사용자가 처음으로 돌아간다. |

## 확인한 방법

- `npm test`: 숫자 표기(표 형태, 기대 문자열 그대로), 토큰 대비, 글꼴 파일·용량·라이선스·외부 URL 없음, 컴포넌트별 접근성(이름, 역할, 키보드).
- `npm run lint`(ESLint + jsx-a11y strict + Prettier), `npm run typecheck`, `npm run build`.
- Windows Chrome(headless)으로 `gallery.html`과 `#shell`을 1280×800, 1024×700, 배율 1.5에서 찍었다: `docs/design/system/shots/`.
- impeccable `critique`(디자인 검토와 검출기를 서로 다른 하위 에이전트로): 27/40(고치기 전). P1 2건(AI 문장 구분, 창 높이)과 P2 3건(오프라인 틀, 의견 눈금, busy)을 고쳤다. 검출기 `detect`는 소스 54파일과 렌더링(1024×700) 모두 지적 0.
- impeccable `audit`: 접근성 3, 성능 4, 테마 3(라이트만, 토큰 완비), 반응형 3(데스크톱 전용, 최소 너비 1024), 구현 일관성 4.
- taste-skill `lint --app`: FAIL 0(남은 WARN은 빠진 값 표시 `—`). `inspect --app`: 남은 FAIL은 768px에서 가로 스크롤(최소 너비 1024는 의도), WARN은 구역 2px 먹선(시안 B의 장치).
