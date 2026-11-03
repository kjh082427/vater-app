# ui/design-system-dashboard 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 디자인 시스템을 "대시보드 라이트"(시안 1)로 바꾼다. 이를 위해 토큰과 `DESIGN.md`를 새로 쓰고, 기존 부품의 겉모습을 바꾸고, 대시보드에 필요한 새 부품과 차트를 더한다.

**Architecture:**
- `apps/desktop/src/design-system/` 안에서만 일한다. 색·크기는 모두 역할 토큰(`var(--color-*)` 등)으로 쓰고, 컴포넌트에 값을 직접 쓰지 않는다(`tokens.test.ts`가 검사).
- **기존 부품은 이름과 속성(API)을 바꾸지 않는다.** 화면 코드와 테스트 586개가 그대로 통과해야 한다.
- 새 부품은 같은 폴더 규칙(`Name.tsx` + `Name.module.css` + `Name.test.tsx`)을 따르고 `index.ts`로 내보낸다.

**Tech Stack:** React 18.3.1, TypeScript 6 strict, CSS Modules, Vitest + RTL, 직접 그린 SVG. **새 의존성 없음.**

**Spec:** `docs/superpowers/specs/2026-11-03-dashboard-design.md` 5장(시각 디자인), 7장(디자인 확인). 기준 그림: `design-preview/대시보드-시안/1-대시보드라이트.png`, `1-대시보드라이트-편집.png`, `1-대시보드라이트-1024x600.png`. 시안 HTML·CSS: `design-preview/대시보드-시안/src/1-dashboard-light.html`, `common.js`(값을 참고만 하고 코드를 옮기지는 않는다). 상위 관례: `2026-11-02-vater-mvp-design.md` 9-1.

## Global Constraints
- 브랜치 `ui/design-system-dashboard`, 라벨 `area:ui`, 폴더 `apps/desktop/src/design-system/`과 저장소 루트 `DESIGN.md`. 화면(`src/screens`, `src/app`)은 고치지 않는다.
- **색 규칙**
  - 상승 = 빨강, 하락 = 파랑. 이 두 색은 값의 방향에만 쓴다.
  - 강조색은 인디고-바이올렛 하나로, 선택·주 버튼·활성 탭·링크에만 쓴다.
  - 분류 표지(지수 이름 옆 네모 등)는 중립색이다.
  - 주의·오류는 황토(지금 규칙 유지)이고, 오류에 빨강을 쓰지 않는다.
- **글자 대비:** 본문 4.5:1, 큰 글자·아이콘 3:1이다. `tokens.test.ts`에 새 조합을 추가해 검사한다.
- **치수**
  - 바탕: 밝은 회색 캔버스(시안 `#f4f5f8` 근처)
  - 칸 카드: 흰색, 모서리 8px, 옅은 그림자, 안쪽 여백 16px
  - 카드 머리: 제목 16px/600 + 설명 13px
  - 숫자 카드 큰 숫자: 28px/700, tabular-nums
  - 표: 머리줄 짙은 남색 바탕 + 흰 글자, 행 교차 바탕, 숫자 열 오른쪽 정렬
  - 크기는 rem이다(지금 규칙).
- **글꼴:** Pretendard만 쓴다. Hahmlet(명조)은 `fonts.css`에서 빼고, 파일과 라이선스도 지운다(번들 크기가 줄어듦). `fonts.test.ts`도 맞춘다.
- **표기 함수**(`format/money.ts`)는 유지하고, 부호 없는 억 표기 `formatEok(won)`을 더한다(이전 리뷰의 빈틈).
- impeccable 검출기 0건이 목표다(의도된 예외는 README에 적음). 카드 안에 카드를 넣지 않는다.

## Review Focus
1. **기존 화면 테스트 586개** → 겉모습만 바뀌고 모두 통과(속성·역할·문구 그대로). (Task 2)
2. **1024×600·배율 1.5에서 넘침**(긴 종목명, 큰 숫자, 칸 머리 버튼) → 말줄임·줄바꿈 규칙. (Task 2, 3)
3. **키보드만으로 Select·Menu·Dialog·SegmentedControl 조작**(열기·이동·선택·Esc·초점 복귀) → WAI-ARIA 패턴대로. (Task 3)
4. **차트 자료가 0개·1개·모두 같은 값·null 섞임** → 깨지지 않고 빈 상태 또는 평평한 선. (Task 4)
5. **방향이 아닌 곳의 빨강·파랑 사용** → 토큰 검사 테스트가 막는다(분류 표지, 강조색). (Task 1)

---

### Task 1: 토큰과 DESIGN.md
**Files:** `tokens.css`, `base.css`, `fonts.css`, `fonts/`(Hahmlet 삭제), `tokens.test.ts`, `fonts.test.ts`, `/DESIGN.md`
- [ ] 테스트(실패 확인)
  - 새 역할 토큰이 있다: `--color-canvas`, `--color-card`, `--color-card-shadow`, `--color-accent`, `--color-accent-weak`, `--color-on-accent`, `--color-table-head`, `--color-on-table-head`, `--color-row-alt`, `--color-tag`(중립 분류 표지)
  - 대비 조합: 본문/보조 글자 × canvas·card·row-alt, accent 글자 × card, on-accent × accent, on-table-head × table-head, up·down × card·row-alt
  - accent의 색상(hue)이 up·down과 40° 이상 떨어짐
  - Hahmlet `@font-face`가 없음
- [ ] 구현: 시안 1의 값을 토큰으로 옮긴다. 이름은 역할로 짓는다. 기존 토큰 이름을 지우면 쓰는 곳을 함께 바꾼다(이 폴더 안).
- [ ] `DESIGN.md` 다시 쓰기
  - 새 방향 설명
  - 색 역할과 Named Rules(방향 색 전용, 강조색 하나, 카드 안 카드 금지)
  - 타이포 위계, 숫자 표기, 레이아웃(칸 카드, 맨 위 숫자 줄)
  - 부품 목록과 Inputs 절(이전엔 비어 있었음)
- [ ] `npm test`·`npm run lint`·`npm run typecheck`, 커밋 `feat(design-system): 대시보드 라이트 토큰과 DESIGN.md`

### Task 2: 기존 부품 다시 입히기
**Files:** `components/*.module.css` 전부. 필요하면 `.tsx`의 클래스 구조만 바꾼다(속성은 그대로).
- 대상과 바꿀 것
  - AppShell: 캔버스 바탕
  - SidebarNav: 흰 사이드바, 활성 항목은 accent-weak 바탕 + accent 글자, 배지
  - Section: 카드 모양. 제목 16px, 설명 줄. 구역 위 굵은 먹선은 없앤다
  - DataTable: 짙은 머리줄, 교차 바탕, **행이 0개일 때 열 머리 어긋남 고침**
  - Tabs: 밑줄형, 활성 accent
  - Button: primary는 accent, secondary는 흰 바탕 + 테두리
  - Banner, StatusBar, StatusDot
  - FeedStatus: **`idle` 상태 추가** — 속성 값 하나 추가, 문구 "감시 안 함"
  - Sparkline, SignedNumber, DecisionScale, AiText(보라 "AI 해석" 표지), Disclaimer, MarketState
- [ ] 테스트(실패 확인)
  - `FeedStatus feed="idle"`의 문구
  - DataTable이 비어 있을 때 머리줄의 열 수 = columns 수, 빈 안내 행은 colSpan
- [ ] 구현 → 갤러리(`gallery/`)에서 부품별로 1280×800과 1024×600을 눈으로 확인
- [ ] 전체 `npm test`(기존 586개 포함) 통과, 커밋 `feat(design-system): 기존 부품을 대시보드 라이트로`

### Task 3: 새 부품
**Files:** `components/{Card,KpiTile,Select,Menu,Toggle,SegmentedControl,Dialog,TextField,ProgressBar}.tsx` (+ css, test), `index.ts`

**Interfaces (Produces)**
- `Card({title, description?, actions?, children, padded=true, 'aria-label'?})`: 칸 카드. `actions`는 머리 오른쪽(예: `⋯` Menu).
- `KpiTile({label, value: ReactNode, change?: ReactNode, chart?: ReactNode, tag?: 'neutral'})`
- `Select<T extends string>({label, value, options: {value: T, label: string, disabled?: boolean, reason?: string}[], onChange})`: 네이티브 `<select>` 대신 listbox 패턴. 막힌 항목은 이유를 `aria-describedby`로.
- `Menu({trigger: ReactElement, items: {id, label, onSelect, disabled?, reason?}[]})`
- `Toggle({label, checked, onChange, disabled?})`(switch 역할)
- `SegmentedControl<T>({label, value, options, onChange})`(radiogroup)
- `Dialog({open, title, children, onClose, footer?})`(초점 가둠, Esc, 닫힐 때 여는 버튼으로 초점 복귀)
- `TextField({label, value, onChange, error?, hint?, maxLength?, type?})`
- `ProgressBar({value: 0–100, label})`

- [ ] 테스트(실패 확인): 부품마다 역할·이름, 키보드 동작
  - Select: ↑↓/Home/End/Enter/Esc, 막힌 항목은 건너뜀
  - Menu: 화살표, Esc로 닫고 트리거로 초점 복귀
  - Dialog: Tab이 안에서 돎, Esc
  - SegmentedControl: 화살표로 선택
  - Toggle: Space
  - TextField: error면 `aria-invalid`와 메시지 연결
- [ ] 구현 → 갤러리에 추가 → `npm test`, 커밋 `feat(design-system): 대시보드용 새 부품`

### Task 4: 차트
**Files:** `components/LineChart.tsx`, `components/DivergingBar.tsx` (+ css, test)

**Interfaces (Produces)**
- `LineChart({values: (number|null)[], labels?: string[], baseline?: number, direction: 'up'|'down'|'flat', format: (n: number) => string, height?: number, 'aria-label': string})`
  - 영역 + 선(방향 색), `baseline`은 점선과 오른쪽 값 표지
  - 마지막 값 표지(방향 색 바탕), y축 눈금 3개, x축 라벨은 처음·가운데·끝
  - 크기는 `ResizeObserver`로 부모 너비를 따른다
  - 접근성: `role="img"`와 요약 문장(처음·끝 값)
- `DivergingBar({rows: {label: string, value: number}[], format: (n: number) => string, 'aria-label': string})`: 0 기준선, 양수는 up 색 오른쪽, 음수는 down 색 왼쪽, 값 라벨은 같은 방향 색
- [ ] 테스트(실패 확인)
  - LineChart: 값 0개면 "자료 없음", 1개면 점 하나, 모두 같으면 평평한 선(0으로 나누기 없음), null은 끊긴 선, 마지막 값 표지의 글자 = format(마지막 값)
  - DivergingBar: 음수 막대가 기준선 왼쪽, 0은 막대 없이 0 표시, 모두 0이어도 오류 없음
- [ ] 구현 → 갤러리 → 커밋 `feat(design-system): 선 차트와 양방향 막대`

### Task 5: 갤러리 캡처와 마무리
- [ ] 갤러리 전체 캡처(1280×800, 1024×600, 배율 1.5) → `docs/design/system/shots/`. impeccable 검출기(`IMPECCABLE_BROWSER`=Playwright Chromium)로 0건 확인
- [ ] 디자인 시스템 README 갱신, `fonts.test.ts` 속도 문제(node_modules까지 훑음)를 검사 범위를 `src/`로 좁혀 고친다
- [ ] 전체 검사(`npm test`, lint, typecheck, build), 커밋 `docs(design-system): 대시보드 라이트 갤러리와 README`
