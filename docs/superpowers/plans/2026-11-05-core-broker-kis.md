# core/broker-kis 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한투 계좌의 보유 종목을 어댑터로 불러온다.

**Architecture:** `brokers/kis.py`가 이미 있는 `KisClient`와 토큰을 쓴다. 기존 시세 코드는 건드리지 않는다.

**Spec:** v2 설계 0, 1, 8장. 참고: `docs/brokers/kis.md`(이 브랜치, main을 먼저 합친다). 선행: `core/holdings`.

## Global Constraints
- 라벨 `area:core`. **TR은 허용 목록으로 고정한다. 주문 TR 금지.**
- 계좌번호는 연결 비밀키 `BROKER_{id}_ACCOUNT`(8-2 형식)에만 저장한다.
- 실연동 테스트는 `@pytest.mark.kis_live`, 조회만.

## Review Focus
1. **50종목이 넘는 계좌** → 연속 조회로 전부 받는다. (Task 1)
2. **전량 매도 직후 `hldg_qty=0` 행** → 수량 0으로 처리. (Task 1)
3. **잘못된 계좌번호** → `BROKER_AUTH_INVALID`가 아니라 계좌 오류 문구. (Task 1)
4. **미국 외 해외 종목(일본 등)** → `market=None`. (Task 2)
5. **모의 서버** → `VTTC8434R`을 쓴다. (Task 1)

---

### Task 1: 국내 잔고
**Files:** `brokers/kis.py` / Test `tests/brokers/test_kis.py`(respx, 실제 형식 픽스처)
- 시작할 때 공식 포털에서 `docs/brokers/kis.md`의 🔶 항목을 확인하고 노트를 고친다.
- [ ] 테스트(실패 확인): 필드 변환(`pdno`, `prdt_name`, `hldg_qty`, `pchs_avg_pric`), 연속 조회, 0 수량, 실전/모의 TR, 계좌 오류, ETF
- [ ] 구현 → 커밋 `feat(brokers): 한투 국내 잔고`

### Task 2: 해외 잔고와 실연동
- 공식 샘플에서 해외 잔고 TR 확인 → 소수점 수량·통화 처리, 미국 외는 `market=None`
- [ ] 테스트(실패 확인) → 구현 → `kis_live` 실제 계좌로 확인(값은 출력하지 않고 개수만) → 커밋 `feat(brokers): 한투 해외 잔고와 실연동`
