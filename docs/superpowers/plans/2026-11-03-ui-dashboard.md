# ui/dashboard 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈을 사용자가 짜는 대시보드 탭 여러 장으로 바꾼다. 칸 수, 배치 틀, 칸 내용을 쉽게 고르고, 겹침이나 깨짐은 생기지 않는다. 나머지 페이지에는 새 디자인을 입힌다.

**Architecture:**
- `src/screens/home/`이 `src/dashboard/`로 바뀐다. 구성은 다음 다섯 덩어리다.
  1. **배치 엔진**(`dashboard/layout/`): 순수 함수다. 분할 나무, 틀 목록, 최소 크기, 맞는지 판정, 검증을 맡는다.
  2. **문서 저장**(`dashboard/store.ts`): `/ui/dashboards`를 읽고 쓰고, 검증하고, 기본 배치로 되돌린다.
  3. **칸 내용 목록**(`dashboard/panels/`): 내용 1가지 = 컴포넌트 + 최소 크기 + 옵션 정의다.
  4. **보기 화면**(`DashboardView`)
  5. **편집 화면**(`DashboardEditor`)
- 기존 로직 층(`api/`, `platform/`, `useResource`, SSE, 진행 추적)은 그대로 쓴다. 기존 홈의 영역들(`WatchlistSection` 등)은 칸 내용으로 옮겨 다시 쓴다.

**Tech Stack:** React 18, TypeScript strict, 새 디자인 시스템(`ui/design-system-dashboard`), MSW, Vitest + RTL, Playwright. **새 의존성 없음.** 끌기는 Pointer Events로 직접 만든다.

**Spec:** `docs/superpowers/specs/2026-11-03-dashboard-design.md` 전체. 기준 그림: `design-preview/대시보드-시안/1-*.png`(편집 화면의 단계 안내 ①②③은 `3-소프트카드-편집.png`). 상위: `2026-11-02-vater-mvp-design.md` 9장.

## 선행 조건
- `core/ui-dashboards`와 `ui/design-system-dashboard`가 main에 들어온 뒤 main에서 이 브랜치를 시작한다. 시작하면 `npm run gen:api`로 `schema.d.ts`를 갱신한다.

## 앞 브랜치에서 넘어온 것 (PR #20, #21 리뷰·결정)
- `/market/indices`: 장이 없는 시간(주말·휴장·장 시작 전, 한국 낮의 미국)에는 `closes`의 마지막 값과 `value`가 같은 날이다. 지수 칸은 "종가 + 오늘 값"을 이을 때 **마지막 종가와 value가 같으면 점을 하나만** 그린다(테스트 포함).
- 디자인 시스템
  - 옛 토큰 이름(paper, chrome, selected, rule-section, ink-hover, on-ink, `--font-serif`)은 별칭으로 남아 있다. Task 6에서 화면 CSS를 새 토큰으로 옮긴 뒤 **별칭을 지운다**. 디자인 시스템 파일이라 `ui/design-system-*` 규칙의 예외로 이 브랜치에서 하고, PR에 적는다.
  - `FeedStatus`의 속성 이름은 `state`이고 `idle`이 있다.
  - `Button variant="icon"`(칸 머리 `⋯`)을 쓴다.
  - 화면의 네이티브 `<select>`는 `Select`로, 밑줄 링크는 새 링크 스타일로 바꾼다.
  - "실시간" 상태 점은 먹 점이다(초록 아님).

## Global Constraints
- 브랜치 `ui/dashboard`, 라벨 `area:ui`, 폴더 `apps/desktop/src/{dashboard,screens,app}`. 디자인 시스템 부품을 고쳐야 하면 `ui/design-system-*` 브랜치로 따로 낸다.
- **왼쪽 고정 메뉴**(홈·분석·감시·알림·브리핑·설정)와 라우트 9개는 그대로다. 홈 `#/home`에는 탭 순번을 쿼리로 붙인다(`#/home?tab=<id>`, 없으면 첫 탭).
- **탭:** 최대 8장, 이름 1~20자, 마지막 1장은 삭제 불가.
- **칸:** 1~6개, 맨 위 숫자 줄의 숫자는 최대 5개.
- **틀 목록(id 고정):** 1 `one` / 2 `cols-2`, `rows-2` / 3 `left-big-3`, `top-big-3`, `cols-3` / 4 `grid-2x2`, `left-big-4`, `top-big-4`, `cols-4` / 5 `top2-bottom3`, `left-big-5` / 6 `grid-2x3`, `grid-3x2`
- **내용 목록과 최소 크기(px, 1배율 CSS 픽셀):**

  | id | 최소 크기 |
  |---|---|
  | `watchlist` | 360×180 |
  | `index-chart` | 300×180 |
  | `briefing` | 300×180 |
  | `recent-alerts` | 280×160 |
  | `running-analyses` | 280×140 |
  | `analysis-result` | 360×240 |
  | `alert-history` | 360×220 |
  | `kpi` | 260×96 |
  | `simulation` | 고를 수 없음, "곧 추가" |

- **기본 대시보드**("기본"): 맨 위 숫자 줄 켬(코스피·코스닥·감시 종목 수·오늘 알림 수·진행 중인 분석 수), `grid-2x2`, 칸은 `index-chart`(코스피), `briefing`(국내), `watchlist`(전체), `recent-alerts`
- **오류·빈 상태 문구는 사이드카 `{message, hint}` 그대로**다. 칸마다 오류 경계를 둔다.
- 경계선은 키보드로 조절한다(←/→ 또는 ↑/↓로 5%씩). 끄는 중에는 비율 표시를 보인다.
- 숫자는 디자인 시스템 표기 함수만 쓰고, 빨강·파랑은 방향에만 쓴다.
- 면책: 브리핑·분석 결과 칸에 `Disclaimer`를 둔다.

## Review Focus
1. **저장 문서가 깨짐·옛 형식·모르는 내용 종류** → 앱은 열리고, 기본 배치 + 배너, 또는 그 칸만 안내. (Task 2)
2. **창을 1024×600으로 줄였을 때 6칸 배치** → 배치는 그대로, 영역 스크롤, 칸은 최소 크기 유지. (Task 4)
3. **편집 중 저장 실패(422·연결 끊김)** → 편집 화면 유지, 바꾼 것 그대로, 오류 문구. (Task 5)
4. **칸 하나의 내용이 예외를 던짐** → 그 칸만 오류와 [다시 시도], 다른 칸·탭은 그대로. (Task 3)
5. **같은 내용을 여러 칸에, SSE 시세가 몰려옴** → 같은 자료를 한 번만 불러오고(자료 훅 공유) 모든 칸이 갱신. (Task 3)

---

### Task 1: 배치 엔진
**Files:** Create `dashboard/layout/{types.ts, templates.ts, geometry.ts, validate.ts}` + 테스트

**Interfaces (Produces)**
- `type Node = { dir: 'row'|'col'; sizes: number[]; children: Node[] } | { panel: number }`
- `TEMPLATES: Record<TemplateId, {count: number; label: string; root: Node}>`, `templatesFor(count: number): TemplateId[]`
- `computeRects(root: Node, area: {w: number; h: number}, gap: number): Rect[]`(칸 번호 순서)
- `fits(root, area, mins: Size[], gap): {ok: true} | {ok: false; panel: number; need: Size; got: Size}`
- `resizeAt(root, path: number[], index: number, delta: number, area, mins, gap): Node`(인접 두 칸 비율 조절, 최소 크기에서 멈춤)
- `withCount(doc: DashboardDoc, count: number, template: TemplateId): DashboardDoc`(앞 번호 칸 내용 유지, 새 칸은 `{type: 'empty'}`)
- `validateDoc(raw: unknown, known: Set<string>): {doc: DashboardsDoc; problems: string[]}`(깨진 장은 버리고, 남는 장이 없으면 기본값)

- [ ] 테스트(실패 확인)
  - 틀마다 칸 수 = count, 칸 사각형의 넓이 합 = 영역 − 틈
  - `fits`: `cols-4`는 1024×600 영역(사이드바·탭·상태줄을 뺀 실제 영역, 상수로 고정)에서 `watchlist`가 들어가면 실패하고, 1280×800에서는 판정 결과를 기록
  - `resizeAt`가 최소 크기에서 멈춤, sizes 합 1 유지
  - `validateDoc`: sizes 합이 1이 아님 → 틀 기본 비율, 틀 id를 모름 → 그 장 버림, 모르는 내용 종류 → 그대로 두고 problems에 기록, 문서가 아님 → 기본 문서
- [ ] 구현, `npm test`, 커밋 `feat(dashboard): 배치 엔진(틀·크기·검증)`

### Task 2: 문서 저장과 홈 탭
**Files:** `dashboard/store.ts`, `dashboard/defaults.ts`, `dashboard/HomeTabs.tsx`, `app/router.ts`(`?tab=`), MSW `/ui/dashboards` / 테스트

**Interfaces (Produces):** `useDashboards(): {doc, status, save(doc): Promise<void>, error}`, `DEFAULT_DOC`

- [ ] 테스트(실패 확인)
  - 처음(빈 문서) → "기본" 탭 1장
  - 깨진 문서 → 기본 + 정보 배너 "저장된 화면 배치를 읽지 못해 기본 배치로 열었습니다."
  - 탭 추가 → 이름 "새 화면 N"
  - 이름 바꾸기: 21자 거절, 빈 이름 거절
  - 삭제는 확인 대화상자를 거치고, 마지막 1장은 삭제 버튼 비활성
  - 9번째 추가는 비활성 + 이유
  - 왼쪽·오른쪽 옮기기
  - 탭 조작마다 PUT 1번, 실패하면 이전 상태로 돌리고 오류 표시
  - `#/home?tab=<id>`, 없는 id면 첫 탭
- [ ] 구현, 커밋 `feat(dashboard): 대시보드 문서 저장과 홈 탭`

### Task 3: 칸 내용과 보기 화면
**Files:** `dashboard/panels/{registry.ts, WatchlistPanel, IndexChartPanel, BriefingPanel, RecentAlertsPanel, RunningAnalysesPanel, AnalysisResultPanel, AlertHistoryPanel, KpiPanel, KpiStrip, metrics.ts}.tsx`, `dashboard/DashboardView.tsx`, `dashboard/PanelFrame.tsx`(Card + 오류 경계 + `⋯` 메뉴) / 테스트. 기존 `screens/home/*`의 영역을 옮겨 다시 쓰고, 옛 홈은 지운다.

**Interfaces (Produces)**
- `PANELS: Record<PanelType, {label, description, min: Size, options?: OptionDef[], Component: (p: {options; size}) => JSX.Element}>`
- `METRICS: Record<MetricId, {label, use(): MetricValue}>`
  - 숫자 id: `kospi`, `kosdaq`, `spx`, `comp`, `watch-count`, `alerts-today`, `analyses-running`, `foreign-net`
  - `kpi` 칸과 맨 위 숫자 줄이 함께 쓴다

- [ ] 테스트(실패 확인)
  - 내용마다 정상·빈 상태·오류(`message`·`hint` 그대로)
  - 지수 칸: `/market/indices` 값, 방향 색, 전일 종가 점선, null이면 "—"와 "데이터 없음"
  - 브리핑 칸: 수급 DivergingBar(억, 순매수 빨강), 면책
  - 감시 종목 칸: SSE `quote`로 갱신, 행 클릭이면 `#/symbols/KR/005930`
  - 한 칸이 예외를 던져도 다른 칸이 그려지고, [다시 시도]로 다시 그려짐
  - 같은 내용 두 칸이면 `/watchlist/quotes` 요청 1번
  - 모르는 내용 종류면 "이 버전에서 지원하지 않는 내용입니다"
  - 숫자 줄 5개
- [ ] 구현, 커밋 `feat(dashboard): 칸 내용과 대시보드 보기`

### Task 4: 배치 그리기와 경계선
**Files:** `dashboard/SplitLayout.tsx`, `dashboard/Divider.tsx` / 테스트
- [ ] 테스트(실패 확인)
  - 칸이 `computeRects` 위치에 그려짐
  - 경계선: 포인터로 끌면 비율이 바뀌고 최소 크기에서 멈춤, 키보드 ←/→ 5%, `role="separator"`와 `aria-valuenow`
  - 영역이 최소 합보다 작으면 스크롤 컨테이너가 되고 칸 크기는 최소 크기
- [ ] 구현, 커밋 `feat(dashboard): 칸 배치와 경계선 조절`

### Task 5: 배치 편집 화면
**Files:** `dashboard/DashboardEditor.tsx`, `dashboard/editor/{CountPicker, TemplatePicker, ContentPicker, KpiStripSettings}.tsx` / 테스트

**흐름(스펙 5장 편집 화면)**
- 위 줄: "배치 편집 · 탭 이름", [취소], [저장]
- 오른쪽 창
  - ① 몇 칸으로 나눌까요(1–6)
  - ② 어떤 모양으로 놓을까요(틀 그림. 맞지 않는 틀은 자물쇠와 "창이 작아 들어가지 않음: 칸 너비 약 Npx < 감시 종목 최소 360px")
  - ③ 맨 위 숫자 줄(켜기, 숫자 고르기 최대 5개)
  - 아래에 "기본 배치로 되돌리기"
- 캔버스: 칸 번호, 내용 이름, [내용 바꾸기 ▾](2열 목록, 막힌 내용은 이유, 시뮬레이션은 "곧 추가"), 경계선 손잡이

- [ ] 테스트(실패 확인)
  - **성공 기준 1 흐름:** [배치 편집] → 3 → `left-big-3` → 칸마다 내용 → [저장] → PUT 본문 확인 → 보기 화면
  - 빈칸이 있으면 [저장] 비활성 + 이유
  - 칸 수 4→2면 앞 두 칸 내용 유지
  - 막힌 틀·막힌 내용은 고를 수 없고 이유가 보임
  - [취소]·Esc: 바꾼 것이 있으면 확인 대화상자, 없으면 바로 닫힘
  - 저장 422·끊김 → 편집 유지 + 오류
  - "기본 배치로 되돌리기"
  - 키보드만으로 전체 흐름
- [ ] 구현, 커밋 `feat(dashboard): 배치 편집 화면`

### Task 6: 나머지 페이지에 새 디자인 입히기
**Files:** `screens/{analysis,alerts,briefing,settings,welcome,common}/*`, `app/*`(사이드바·상태 표시줄·배너) / 기존 테스트
- 페이지 구조와 흐름은 그대로 둔다. 구역은 Card로 바꾸고, 입력은 새 TextField·Select·Toggle·SegmentedControl, 진행률은 ProgressBar로 바꾼다. 브리핑 상세의 수급은 DivergingBar다.
- 이전 디자인 검토의 P2 문구(개발자 용어 "폴링·프리셋·토큰·깊은/빠른 모델·확정 일봉")를 쉬운 말로 고친다. 예: 폴링 → "30초마다 확인", 프리셋 → "AI 사용 방식"
- [ ] 기존 화면 테스트를 새 문구에 맞게 갱신. 갱신은 문구 변경만이고 검사 대상은 그대로다. 전체 통과
- [ ] 커밋 `feat(ui): 분석·감시·알림·브리핑·설정·마법사에 새 디자인`

### Task 7: 흐름 테스트, 캡처, 마무리
**Files:** `e2e/dashboard.spec.ts`, `e2e/shots.spec.ts`, `apps/desktop/README.md`
- [ ] Playwright(실제 개발 모드 사이드카)
  - 탭 추가 → 3칸 `left-big-3` → 내용 고르기 → 저장 → 새로 고침 뒤 그대로(사이드카 DB)
  - 경계선 끌기 뒤 저장 → 새로 고침 뒤 비율 유지
  - 1024×600에서 `cols-4`가 막힘
  - 기존 흐름 테스트 5개 통과
- [ ] 캡처: 홈(기본·6칸)·편집·각 페이지 × 1280×800·1024×600·배율 1.5 → `docs/design/screens/shots/`, `design-preview/화면/`도 갱신
- [ ] impeccable 검출기 0건(의도된 예외는 README), critique 1회 → P1 고침
- [ ] README와 "남은 일", 커밋 `test(dashboard): 흐름 테스트·캡처와 마무리`
