# Vater 데스크톱 UI (`apps/desktop`)

React 18 + TypeScript 화면입니다. Tauri 셸(`src-tauri`, `shell/tauri` 브랜치)이 WebView2로 띄우고, 사이드카(`sidecar/`)와 HTTP·SSE로 이야기합니다. 설계 근거는 [스펙 9장](../../docs/superpowers/specs/2026-11-02-vater-mvp-design.md), 디자인 규칙은 저장소 루트 [`DESIGN.md`](../../DESIGN.md)입니다.

## 폴더

| 폴더                 | 하는 일                                                                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/design-system/` | 색·글꼴·부품·숫자 표기(`format/money.ts`). `ui/design-system` 브랜치가 맡는다                                                                                                                                                                                            |
| `src/api/`           | 사이드카 계약: OpenAPI에서 만든 타입(`schema.d.ts`, `npm run gen:api`), 토큰을 붙이는 클라이언트(오류 `{code, message, hint}` → `ApiError`, 재시작 뒤 새 포트로 한 번 더), SSE 허브(`?token=`, 끊기면 다시 연결), `useResource`(SSE가 다시 열리면 다시 불러오기)         |
| `src/platform/`      | 셸 어댑터(스펙 9-3): Tauri(`get_sidecar_info`, `sidecar-state`, `navigate`, `get/set_autostart`) / 브라우저(`VITE_SIDECAR_URL`, `VITE_SIDECAR_TOKEN`)                                                                                                                    |
| `src/app/`           | 해시 라우터(알림 클릭 경로와 같음), 앱 틀(사이드바, 상태 표시줄, 오프라인·연결 끊김 배너, 마법사로 보내기)                                                                                                                                                               |
| `src/dashboard/`     | 홈 대시보드: 배치 엔진(`layout/`, 순수 함수), 문서 저장(`store.ts`, `/ui/dashboards`), 칸 내용(`panels/`), 같이 쓰는 자료(`shared.ts`), 보기·편집 화면(`DashboardView`, `DashboardEditor`, `editor/`)                                                                    |
| `src/screens/`       | 화면: `alerts`(감시·알림), `analysis`, `briefing`, `settings`, `welcome`(첫 실행 마법사), `holdings`(v2: 보유 종목 탭, 증권사 연결, 업로드 창, 내 보유 카드·주가 그래프, 직접 입력·CSV, 분석 창의 보유 종목 고르기), `common`(입력 칸, 종목 검색과 분류 탐색, 시각 표기) |
| `src/mocks/`         | 사이드카 흉내(MSW 처리기와 예시 자료). 테스트와 견본 화면 `mock.html`이 함께 쓴다                                                                                                                                                                                        |
| `e2e/`               | 흐름 테스트(Playwright, 실제 개발 모드 사이드카)                                                                                                                                                                                                                         |

## 실행

```bash
npm ci
npm run dev                 # http://localhost:5173
```

- **견본 자료로 보기**: `http://localhost:5173/mock.html#/home` (사이드카 없이 MSW 처리기). 쿼리로 상황을 고른다: `?empty=1`, `?offline=1`, `?stream=down`, `?nokey=1`, `?running=1`, `?six=1`(6칸 탭), `?broken=1`(깨진 대시보드 문서), `?brokers=1`(흉내 증권사 서버: 키움·메리츠를 연결하면 보유 종목이 들어오고 시세·일봉·자산 추이 예시가 있다)
- **실제 사이드카와**: 사이드카를 `VATER_DEV=1`로 띄우고(`sidecar/README.md`), 출력된 포트와 토큰을 넘긴다. 개발 모드 사이드카는 `http://localhost:5173` 출처만 CORS로 허용한다.
  ```bash
  VITE_SIDECAR_URL=http://127.0.0.1:<포트> VITE_SIDECAR_TOKEN=<토큰> npm run dev
  ```
- 디자인 시스템 견본: `http://localhost:5173/gallery.html`

## 검사

```bash
npm test            # Vitest + Testing Library + MSW (화면별 정상·빈 상태·오류, SSE, 사이드카 재시작)
npm run lint        # ESLint(jsx-a11y strict) + Prettier
npm run typecheck
npm run build
npm run e2e         # 흐름 테스트: 아래
npm run e2e:holdings # v2 보유 흐름(견본 자료, 사이드카 없이): 아래
```

### 흐름 테스트 (`npm run e2e`)

`e2e/stack.ts`가 실제 사이드카와 Vite 개발 서버를 띄운다. 사이드카는 임시 데이터 폴더, `VATER_DEV=1`, `VATER_BACKGROUND_JOBS=0`, `VATER_SECRET_BACKEND=envfile`(임시 env 파일)로 돌고, 종목은 `e2e/seed.py`가 미리 심는다. 실제 한투·LLM 키는 쓰지 않는다(가짜 키만).

- 필요한 것: `uv`(사이드카 실행), Chromium(`npx playwright install chromium`, 사용자 캐시 `~/.cache/ms-playwright`)
- 확인하는 것: CORS(`http://localhost:5173`), 진짜 `EventSource`와 `?token=`, 이름 있는 SSE 이벤트(`alerts.state`), 실제 오류 본문(422 `ALERT_RULE_INVALID`·`SETTING_INVALID`, 한투 연결 테스트 실패), 쓰기 전용 키
- 흐름: 마법사(키 없음 → 가짜 키 저장 → 연결 테스트 실패 메시지 → 다음으로 못 감), 감시 종목·규칙 만들기 → 다시 불러와도 남음·이력 빈 상태, SSE로 감시 일시 중지가 화면에 반영, 브리핑 목록 빈 상태, 설정 저장·검증 오류·클라우드 키
- 마법사 연결 테스트는 가짜 키로 한국투자증권 토큰 API를 한 번 부른다(인터넷이 없으면 "연결할 수 없습니다" 문구로 같은 검사가 통과한다)
- 대시보드(`e2e/dashboard.spec.ts`): 탭 추가 → 3칸 틀 → 내용 → 저장 → 새로 고침 뒤 그대로, 경계선 끌기 뒤 비율 유지, 1024×600에서 가로 4열 막힘. 키를 넣지 않고 기본 탭은 바꾸지 않는다(flows보다 먼저 돌아도 됨)
- 화면 캡처: `VATER_SHOTS=1 npm run e2e -- shots` → `docs/design/screens/shots/`(로컬 `design-preview/화면/`에도 복사)
- CI에는 아직 넣지 않았다(Ubuntu 러너에 uv·사이드카 의존성과 Chromium이 필요)

### v0.2.1 화면 (스펙 21장)

- 분석 이력 지우기: 목록은 `POST /analyses/delete`(여러 건), 상세는 `DELETE /analyses/{id}`. 확인 창을 거치고 대기·진행 중은 막는다. SSE `analysis.deleted`가 오면 목록과 대시보드 칸에서 빼고, 지워진 분석의 주소·칸은 "지워진 분석입니다"를 보인다.
- 왼쪽 메뉴 "보유 종목"(`#/holdings`): 증권사 연결과 보유 내역 올리기는 여기서 한다. [보유 종목 직접 추가](직접 입력·CSV)는 이 탭과 감시·알림 두 곳에 있다(API가 없는 증권사 수량 등록용). 감시·알림의 첫 동작은 [종목 검색으로 추가]이고, 감시 종목은 보유 중/보유하지 않음 두 묶음으로 나누며 보유 종목에는 "보유"와 증권사 색 점 칩을 붙인다(화면 전용, AI로 보내지 않는다). 등락은 감시 중인 종목만 시세가 있어 그 종목만 보인다(`/portfolio/summary`에 전일 대비가 없다).
- 분석 창의 "보유 종목에서 고르기"는 `screens/holdings/HeldSymbolChoices.tsx` 하나가 맡고, 고른 종목의 market·code·name만 넘긴다. `src/privacy.test.ts`가 분석 화면의 보유 모듈 가져오기를 이 부품 하나로 제한한다.
- 보유 내역 직접 입력 뒤 감시 중이 아닌 종목이면 "감시 종목에도 추가할까요?"를 묻는다.
- 브리핑 상세: `interpret_error`의 이유(분석 화면 20장과 같은 문구)와 [AI 해석 다시 만들기](`POST /briefings/{id}/interpret`). 진행·결과는 SSE `briefing.status`.

### v2 보유 흐름 (`npm run e2e:holdings`)

`playwright.holdings.config.ts`가 Vite만 띄우고(포트 5174) `mock.html?brokers=1`을 연다. 이 흐름은 사이드카 없이 도는 견본이라 흉내 증권사는 `src/mocks/holdings.ts`의 `fakeBroker`다(실제 사이드카와 가짜 증권사 서버로 도는 확인은 아래 `e2e:acceptance`). 실제 증권사·AI는 부르지 않고 키는 가짜 값만 넣는다.

- 연결(키움·메리츠, 키가 화면에 남지 않음) → 업로드(새 종목 알림, 확인 창, 체크 해제 종목은 올리지 않고 다시 새 종목으로 세지 않음) → 내 보유(그래프, 카드, 칩 전환을 기억) → 해제(데이터 삭제 뒤 합계에서 빠짐), 대시보드 칸(내 보유 종목, 자산 추이)
- `VATER_SHOTS_DIR=<폴더>`를 주면 그 폴더에 1280×800, 1024×600, 1280×720(1080p 배율 1.5)로 찍고 가로로 넘치지 않는지 본다. 저장소에는 넣지 않는다.
- 견본 자료는 새로 고치면 처음으로 돌아가므로 화면을 떠났다 돌아와 기억을 본다.

### 확인 테스트 (`npm run e2e:acceptance`)

`e2e/acceptance/`: 실제 사이드카 앱(DB, 서비스, 어댑터)과 실제 화면에 가짜 바깥 서비스(`stack.py`: 한투 REST·WebSocket, 키움·메리츠 서버, AI)를 붙인다. 응답 모양은 `sidecar/tests/brokers/test_{kis,kiwoom,meritz}.py`의 공식 형식 픽스처와 같다. 실제 증권사·AI·인터넷을 부르지 않는다.

- v2(`v2.accept.ts`): V1 연결 → 업로드 → 체크 해제, V2 같은 종목 합산·토글, V3 평가금액·손익, V4 주기 설정, V5 끊김·해제·삭제, V6 수동·CSV, V7 분류 탐색, V8 자산 추이(빈 날 채움, 환율 없음), V9 평단가 알림, V10 브리핑 구역(AI로 가는 요청에 보유 정보 없음), V12 주문 경로 0
- V11(`migrate.accept.ts`): `v0.1.0` 태그의 마이그레이션(`v010_db.py`)으로 만든 DB(감시 종목·규칙·이력·분석·브리핑·대시보드)를 지금 코드로 올려 데이터 유지와 v2 동작을 본다. 저장소에 `v0.1.0` 태그가 있어야 한다(얕은 clone이면 `git fetch --tags`).
- 시계: 화 2026-11-03 16:00 KST에서 실제 시간으로 흐른다. 국내 일봉 종가 = 현재가 + 일 × 100, 미국 = 현재가 + 일, 환율 = 1400 + 일.
- CI에는 아직 넣지 않았다(`e2e`와 같은 이유). 전체(기존 U 포함 31개)는 약 8분 걸린다.

## 화면 캡처

`docs/design/screens/shots/`: 화면별 1280×800·1024×600, 홈·편집·마법사는 배율 1.5. 견본 자료(예시 데이터)로 찍었다. `home-6`은 6칸 탭(1024×600에서는 배치를 그대로 두고 스크롤), `home-edit`·`home-pick`은 배치 편집.

impeccable 검출기(2026-11-03): 소스 0건, 화면 12개(1280×800)·8개(1024×600) 렌더링 0건. 고친 것: 숫자 카드 칸의 카드 속 카드, 스크롤할 때 칸이 영역 끝에 붙음. 의도된 예외 없음. 정식 critique는 돌리지 않고 캡처로 직접 점검했다.

## 남은 일

`ui/screens` 범위 밖이라 고치지 않고 적어 둔 것입니다. 해당 영역 브랜치에서 다룹니다.

**v2 보유 화면 (`ui/holdings`)이 사이드카에 바라는 것**

- (해결) 실제 사이드카와 가짜 증권사 서버 흐름은 `e2e:acceptance`의 `v2.accept.ts`가 돈다. 확인 판은 환경 변수 없이 모듈 값(`brokers.kiwoom.BASE_URL`, `meritz.BASE_URL`, 한투 `REST_HOST`)을 프로세스 안에서 바꾼다(설치본에 주소를 바꾸는 우회로를 두지 않으려고 사이드카는 고치지 않았다).
- 연결 상태가 `lost`로 바뀌거나 보유 수량이 갱신되어도 SSE 이벤트가 없다. 화면은 화면을 옮길 때 `/connections`를 다시 받고, 평가(`/portfolio/summary`)는 주가 주기마다 다시 받는다.
- `GET /portfolio/summary`의 `at`을 "시세 시각"으로 쓴다. 종목별 시세 시각이 따로 오지 않는다.
- 브리핑 `my_assets`에는 `missing_prices`가 없어 어느 종목이 합계에서 빠졌는지 알 수 없다(통화 하나가 불완전하면 그 통화의 변화는 null). 대시보드 칸과 숫자 카드는 `/portfolio/summary`의 `missing_prices`로 알린다.
- `GET /alerts/kinds`에 `avg_price_pct`의 이름·방향 문구가 없어 화면이 `screens/alerts/kinds.ts`에 옮겨 적었다.
- 수동 입력 항목의 `connection_id`는 0으로 보고(화면은 `source`로 구분) 있다. 사이드카가 다른 값을 주면 "갱신 안 됨" 표시 기준을 다시 봐야 한다.
- 분류 탐색의 미분류 목록은 쪽 나눔이 없어 화면이 100개씩 나눠 그린다.

**사이드카 API (`core/*`)**

- `GET /alerts/kinds`에 종류 이름과 방향 선택지가 없다. 화면이 `screens/alerts/kinds.ts`에 옮겨 적었다(종류가 늘면 같이 고쳐야 함).
- `GET /alerts/events`에 종목·종류 필터가 없다(`limit`만). 화면은 최근 200건 안에서 거른다.
- 분석 완료·실패 알림 이력(`AlertEventOut`, `rule_id = null`)에 분석 id·종목이 없어 이력에서 결과로 이동할 수 없다.
- `GET /alerts/status`에 휴장일·다음 개장 시각이 없어, 상태 표시줄은 장중일 때 마감 시각만 보인다.
- `GET /llm/catalog`에 가격표가 없어 분석 실행 정보의 "예상 비용"(스펙 5장)을 보일 수 없다.
- 설정의 "분석 기본값: 애널리스트 고르기"(스펙 9-2)에 해당하는 설정 키가 없다.
- 분석 보고서는 Markdown 원문이라 화면은 줄바꿈만 살려 그대로 보인다(해석기 없음).

**셸 (`shell/tauri`)**

- 로그 폴더 열기, 업데이트 확인 커맨드가 계약에 없다. 사이드카 실행 실패 배너와 설정 > 일반에 해당 버튼이 없다.
- 화면은 계약(`get_sidecar_info`, `sidecar-state`, `navigate`, `get/set_autostart`)대로 짰고 흉내로만 테스트했다. 실제 WebView2에서 확인해야 한다.

**대시보드 (`ui/dashboard`)**

- 지수 차트 칸은 최소 높이(180px)에서 차트(최소 8rem)가 다 들어가지 않아 칸 안에서 스크롤한다.
- 브리핑 요약 칸(미국)의 지수 표가 좁은 칸에서 이름이 줄바꿈된다.
- 감시·알림 규칙 편집의 종류·조건 고르기, 규칙 켜기 체크 상자는 네이티브 그대로다(디자인 시스템 Select에 묶음·막기가 없고, Toggle은 보이는 이름표와 다른 이름을 줄 수 없음).
- 이 브랜치에서 디자인 시스템 예외로 옛 토큰 별칭을 지우고 `FeedStatus`의 "폴링" 문구를 "N초마다 확인"으로 바꿨다.

**디자인 시스템 (`ui/design-system-*`)**

- `FeedStatus`에 `idle`(장중이지만 실시간 규칙이 없어 감시하지 않음) 상태가 없다. 화면이 점과 글자로 따로 짰다(`screens/common/quotes.tsx`).
- `DataTable`은 행이 0개일 때 숫자 열 머리가 어긋난다. 화면은 빈 표 대신 한 줄 안내를 보인다.
- `Select`에 `disabled`와 묶음(optgroup)이 없다. 불러오는 동안 막던 고르기는 자료가 온 뒤에 그린다.
- `format/money.ts`에 부호 없는 억 단위 금액(거래대금) 표기가 없다. 브리핑 상위 종목은 열 머리에 "(억 원)"을 달고 `formatNumber`로 보인다.
- `fonts.test.ts`의 "외부 글꼴을 불러오지 않는다" 검사가 `node_modules`까지 모두 훑은 뒤 거른다. 의존성이 늘어 전체 실행 중 한 번 5초 제한에 걸린 적이 있다(혼자 돌리면 약 1초).
