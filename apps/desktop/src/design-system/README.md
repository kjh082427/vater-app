# 디자인 시스템 (`apps/desktop/src/design-system`)

Vater 화면이 쓰는 색·글꼴·부품·숫자 표기를 모은 곳이다. 방향은 **"대시보드 라이트"**(밝은 회색 캔버스 위 흰 칸 카드, 강조색은 보라 하나, 빨강·파랑은 값의 방향에만)이고, 규칙과 결정의 근거는 저장소 루트 [`DESIGN.md`](../../../../DESIGN.md)가 기준이다. 이 문서는 폴더 안내, 확인 방법, 의도한 예외만 적는다.

## 쓰는 법

- 화면(`src/screens`, `src/app`)은 부품을 `design-system/index.ts`에서만 가져온다.
- 전역 스타일은 앱 진입점에서 한 번: `import './design-system/styles.css'`(글꼴 → 토큰 → 기본값 순서).
- 색과 크기는 `var(--color-*)`, `var(--space-*)` 같은 역할 토큰만 쓴다. 값의 원본은 `tokens.css`.
- 숫자는 `format/money.ts`의 함수로만 꾸민다(`formatWon`, `formatPercent`, `formatEokChange`, `formatEok` 등).

## 폴더

| 경로                  | 내용                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokens.css`          | 색·글자·간격·크기·그림자 토큰. 예전 이름(`paper`, `chrome`, `selected`, `rule-section`, `ink-hover`, `on-ink`, `--font-serif`)은 새 역할의 별칭 |
| `fonts.css`, `fonts/` | Pretendard 4굵기(앱에 포함, OFL). 다시 받는 법은 `fonts/make-fonts.sh`                                                                          |
| `base.css`            | 바탕(캔버스), 글자, 포커스 링(강조색), 글자 선택, 스크롤바, `.vt-num`                                                                           |
| `components/`         | 부품. `Name.tsx` + `Name.module.css` + `Name.test.tsx`                                                                                          |
| `internal/`           | 부품끼리만 쓰는 도움 함수(`cx`, 떠 있는 목록 자리 `usePopoverPosition`)                                                                         |
| `format/`             | 숫자 표기                                                                                                                                       |
| `gallery/`            | 견본(`gallery.html`). 화면 코드가 아니다                                                                                                        |

### 부품

- 그릇: `Card`, `Section`, `KpiTile`, `AppShell`
- 탐색과 상태: `SidebarNav`, `Tabs`, `StatusBar`, `StatusDot`, `FeedStatus`(`idle` 포함), `MarketState`, `Banner`
- 입력과 떠 있는 것: `Button`(`primary`·`secondary`·`quiet`·`icon`), `Select`, `Menu`, `SegmentedControl`, `Toggle`, `TextField`, `ProgressBar`, `Dialog`
- 자료: `DataTable`(`truncate` 열), `SignedNumber`·`PriceChange`, `Sparkline`, `LineChart`, `DivergingBar`, `DecisionScale`
- 글: `AiText`, `Disclaimer`, `VisuallyHidden`, `Icon`

## 확인하는 법

```sh
cd apps/desktop
npm test            # 부품 접근성·키보드, 토큰 대비·색상 거리·방향 색 사용처, 글꼴, 숫자 표기
npm run lint        # ESLint(jsx-a11y strict) + Prettier
npm run typecheck
npm run build
npm run dev         # http://localhost:5173/gallery.html
```

견본 보기는 넷이다: `gallery.html`(부품 목록), `#dashboard`(숫자 줄 + 칸 카드 4개), `#shell`, `#shell-offline`(창 틀).

캡처는 `docs/design/system/shots/`에 있다. 1280×800, 1024×600, 배율 1.5(`@1.5x`)와 Select·Menu·Dialog를 연 상태(`open-*`). 이 브랜치는 Playwright를 의존성에 넣지 않았으므로, 다른 작업 폴더에 설치된 `@playwright/test`와 `~/.cache/ms-playwright`의 Chromium으로 찍었다.

impeccable 검출기(`impeccable detect`, `IMPECCABLE_BROWSER`에 Playwright Chromium)를 소스 폴더와 네 견본 화면(1280×800, 1024×600)에 돌려 **지적 0건**이다(2026-11-03). 처음에 나온 지적 23건은 색 견본의 테두리 상자가 구역 카드 안에 들어간 "카드 안 카드"였고, 견본을 상자 없는 네모 + 글자로 바꿔 고쳤다.

`ui/screens`의 `src`에 이 디자인 시스템을 바꿔 끼운 복사본(작업 폴더 밖)에서 테스트 688개 중 687개 통과(화면 테스트 345개는 모두 통과), `tsc`·ESLint도 통과했다. 실패 1개는 복사본 위치 때문에 사이드카 OpenAPI 스냅샷 파일을 못 찾은 것이다. 견본 자료(`mock.html`)로 홈·감시·알림·브리핑·분석·설정 화면도 찍어 보았다. 부품 이름·속성은 그대로이고 더한 것만 있다.

## 의도한 예외

| 무엇                                                                         | 왜 그대로 두나                                                                                                                                                                       |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 검출기 참고 알림 `em-dash-overuse`(목록 화면에 `—` 32개)                     | 실패로 세지 않는 참고 알림이다. 대부분 값 없음 표시 `—`(스펙 9-1, `MISSING`)와 그것을 보여 주는 숫자 표기 견본이고, 나머지는 알림 문장 견본(`삼성전자 현재가 71,400 — 목표가 …`)이다 |
| 칸 카드와 숫자 카드의 그림자                                                 | 이번 방향의 핵심 장치(스펙 5장 "아주 옅은 그림자"). 떠 있는 것(메뉴, 목록, 대화 상자)만 더 진한 `--shadow-pop`                                                                       |
| `LineChart` 영역의 그라데이션                                                | 방향 색이 위 16% → 아래 0%로 옅어지는 채움 하나뿐이다. 다른 곳에는 그라데이션이 없다                                                                                                 |
| 견본 목록 화면의 구역(카드) 안 묶음                                          | `Section` 안의 `Section`(3·4단계)은 카드가 아니라 선과 제목만이라 카드 안 카드가 아니다. 견본의 색 네모도 상자가 아니다                                                              |
| 막힌 글자(버튼·세그먼트·목록 항목)의 낮은 대비                               | WCAG 1.4.3은 비활성 요소를 예외로 둔다. 막힌 이유는 따로 글자로 보이고 읽힌다                                                                                                        |
| 숫자 카드의 큰 숫자가 28px보다 작아질 때                                     | 칸이 좁으면(컨테이너 11.5rem 이하) 24px, 아주 좁으면(9rem 이하) 20px로 줄이고 미니 차트를 숨긴다. 1280 창에 숫자 카드 5개면 24px이다. 그래도 넘치면 말줄임표                         |
| `Select` 항목은 초점을 받지 않는다(`jsx-a11y/interactive-supports-focus` 끔) | APG 접히는 listbox 패턴: 초점은 목록 상자에 있고 활성 항목은 `aria-activedescendant`로 가리킨다                                                                                      |
| 아이콘만 있는 버튼                                                           | `Button variant="icon"` + `aria-label`만 허용한다(칸 머리의 `⋯`, 대화 상자 닫기)                                                                                                     |
| 예전 토큰 별칭                                                               | 다른 브랜치의 화면 CSS가 쓰는 동안만 둔다. 새 코드는 쓰지 않는다. `ui/dashboard`가 화면을 다시 입힐 때 지운다                                                                        |

## 남은 일

- 예전 토큰 별칭과 `--font-serif` 지우기(`ui/dashboard`에서 화면을 새 디자인으로 다시 입힌 뒤).
- 다크 테마(시안 2): `tokens.css`에 `[data-theme='dark']` 블록 추가.
- 장중 분봉 차트(지수 칸의 "오늘" 보기)는 `LineChart`에 시간 축 라벨만 주면 되지만 자료(사이드카)가 아직 없다.
