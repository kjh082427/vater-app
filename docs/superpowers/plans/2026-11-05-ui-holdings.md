# ui/holdings 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v2의 모든 화면을 만든다: 색, 증권사 연결, 업로드, 내 보유와 그래프, 수동·CSV, 대시보드 칸, 분류 탐색, 주기 설정, 브리핑 구역.

**Architecture:** `src/screens/holdings/` 새 폴더, 감시·알림 화면과 대시보드에 붙인다. 자료는 기존 `useResource`, `dashboard/sources.ts` 방식. `npm run gen:api`로 타입을 만든다.

**Spec:** v2 설계 전체(화면). 선행: `core/*` 전부 main에 합침.

## Global Constraints
- 라벨 `area:ui`, 색 토큰은 디자인 시스템 폴더 포함(PR에 영역 예외 표기). **새 의존성 없음.**
- 상승 `#E60000`, 하락 `#0000FF`. **강조색과 하락색의 색상 거리가 22°로 줄어 토큰 테스트(40°)가 깨진다. 강조색을 색상 280° 근처(`#8B3FD9` 후보, 대비 확인)로 옮긴다.**
- 증권사 색은 막대·칩의 점에만. 글자는 검정. 규칙을 `DESIGN.md`와 토큰 테스트에 반영한다.
- 숫자는 표기 함수만. 미국 수량은 소수점, 국내는 정수. 원화와 달러를 말없이 섞지 않는다.

## Review Focus
1. **연결 하나도 없음** → 버튼 대신 연결 안내. (Task 3)
2. **긴 종목 목록(200개) 업로드 창** → 스크롤, 전체 선택, 멈추지 않음. (Task 3)
3. **시세 없음·평단 없음** → "—", 0으로 표시하지 않음. (Task 4)
4. **칩 토글 뒤 합계 비율** → 반올림해도 어색하지 않음(33.3 / 66.7). (Task 4)
5. **1024×600의 내 보유 카드와 표** → 넘치지 않음, 좁으면 평단가부터 숨김. (Task 4, 5)

---

### Task 1: 색
**Files:** `design-system/tokens.css`, `tokens.test.ts`, `DESIGN.md`, 새 부품 `BrokerBar`, `BrokerChip`
- [ ] 테스트(실패 확인): 새 상승·하락 값과 대비, 강조색 거리 40°, 증권사 색 5개 비텍스트 대비 3:1, 칩 글자는 잉크색, 막대 칸 사이 틈
- [ ] 구현 → 커밋 `feat(design-system): 증권사 색과 방향 색`

### Task 2: 증권사 연결
**Files:** `screens/holdings/ConnectionsSection.tsx`, 설정 화면, 마법사 안내, 앱 배너
- 설정 > 증권사 연결: 목록(마스킹 계좌, 상태), 추가, 해제 확인 창(스펙 1-1 문구), 끊김 배너 [다시 연결]/[데이터 삭제], 메리츠 MAC 안내.
- [다시 연결]은 `POST /connections`에 `replaces: <옛 연결 id>`를 보낸다. 연결 추가 때 같은 증권사에 끝 4자리가 같은 해제 연결이 있으면 "이전 내역을 이 연결로 바꿀까요?"를 묻는다(스펙 1-1). 연결 중인 증권사의 `DELETE /brokers/{id}/data`는 409 `BROKER_CONNECTED`다.
- [ ] 테스트(실패 확인): 테스트 실패 시 저장 안 함과 hint, 키가 다시 안 보임, 해제 후 삭제/유지, 끊김 배너, 다시 연결의 `replaces` → 커밋 `feat(ui): 증권사 연결`

### Task 3: 업로드 창
**Files:** `screens/holdings/UploadDialog.tsx`, `screens/alerts/AlertsScreen.tsx`
- 검색창 위 버튼 `[증권사…] [연결한 증권사 모두] [보유 종목 직접 추가]`, "새 종목 N개" 표시. 전부 체크, "이미 감시 중"·"지원하지 않는 종목", 규칙 선택(기본 없음, 목표가 제외), 41종목 안내(실시간 규칙일 때 사용량과 함께).
- `GET /holdings`의 `is_new`와 `unsupported_reason`을 쓴다. "새 종목 N개"는 `is_new`이면서 감시 중이 아닌 지원 종목의 수, "이미 감시 중"은 `/watchlist`와 맞춰 본다. 올릴 때 체크한 종목은 `items`, 체크 안 한 종목은 `seen`으로 보낸다.
- [ ] 테스트(실패 확인): 버튼 개수, 체크 해제 항목 미전송(`seen`으로만 전송), 실패 증권사만 오류, 규칙 일괄, 안내 문구, 연결 없음 → 커밋 `feat(ui): 보유 종목 업로드`

### Task 4: 주가 그래프와 내 보유 카드
**Files:** `screens/holdings/PriceChart.tsx`, `MyHoldingsCard.tsx`, 감시·알림의 종목 영역
- 일봉 선 그래프(1개월/3개월/1년), 평단가 점선. 아래에 스펙 4-2의 카드. 칩 클릭 시 수량↔비율 전체 전환(기억), 평가손익 방향 색, 시세 시각, 새로 고침.
- [ ] 테스트(실패 확인): 예시 값 표시, 토글과 기억, 미국 소수점, 시세·평단 없음, 평단 점선은 보유 때만, 그래프 자료 없음 → 커밋 `feat(ui): 주가 그래프와 내 보유`

### Task 5: 감시 종목 열과 대시보드
**Files:** 감시 종목 표, `dashboard/panels/{HoldingsPanel,AssetTrendPanel}.tsx`, `metrics.tsx`, `registry.ts`, `layout/mins`
- 보유·평단가·평가손익 열(좁으면 평단가부터 숨김). 칸 "내 보유 종목", "자산 추이"(전체/원화/달러, 기간, 평가금액·매입금액 두 선, 적용 환율·미국 비중, 채운 날 표시), 숫자 카드 총 평가금액·총 평가손익.
- [ ] 테스트(실패 확인): 칸 목록과 최소 크기, 보기 전환, 환율 없음, 기록 없음 안내 → 커밋 `feat(ui): 보유 표와 대시보드 칸`

### Task 6: 수동 입력과 CSV
**Files:** `screens/holdings/ManualForm.tsx`, `CsvImport.tsx`
- 종목 검색 → 증권사 클릭 → 수량 → 평균 매수가, 증권사 추가. CSV: 파일 → 증권사 → 열 확인 → 미리보기(오류 행 이유) → 변경 요약 → 올리기.
- [ ] 테스트(실패 확인): 필수값, 증권사 추가와 색, 수정·삭제, 열 바꾸기, 오류 행, 후보 고르기 → 커밋 `feat(ui): 수동 입력과 CSV`

### Task 7: 분류 탐색, 설정, 브리핑
**Files:** `screens/common/SymbolSearch.tsx` 옆 `CategoryBrowser.tsx`, 설정 일반, `screens/briefing`, `dashboard/sources.ts`
- 시장 칸(통합 기본), 대→중→소, 고른 분류 유지, 키워드 검색. 설정: 주가 주기(기본 10분), 보유 주기(기본 끔). `quotesSource`가 설정 주기로 다시 부름(장중만). 브리핑 "내 자산" 구역.
- [ ] 테스트(실패 확인): 중분류 전체, 소분류 좁히기, 시장 전환 시 분류 유지, 주기 변경 반영, 장외에 안 부름, 구역 숨김 → 커밋 `feat(ui): 분류 탐색과 주기 설정`

### Task 8: 흐름 테스트와 마무리
- [ ] Playwright(흉내 증권사 서버): 연결 → 업로드 → 내 보유 → 해제. 캡처 3크기, impeccable 검출기, README → 커밋 `test(ui): v2 흐름`
