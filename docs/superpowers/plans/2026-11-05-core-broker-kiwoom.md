# core/broker-kiwoom 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 키움 계좌의 보유 종목을 어댑터로 불러온다.

**Architecture:** `brokers/kiwoom.py`, `ReadOnlyHttp`로만 호출한다. 토큰은 연결별 비밀키(`BROKER_{id}_TOKEN`)에 캐시한다.

**Spec:** v2 설계 0, 1, 8장. 참고: `docs/brokers/kiwoom.md`. 선행: `core/holdings`.

## Global Constraints
- 라벨 `area:core`. **`api-id` 허용 목록 고정. 주문 TR 금지.**
- 조회 초당 5회(국내) 제한을 지킨다.

## Review Focus
1. **3개월 미접속 자동 해지** → 연결 `lost`와 재신청 안내. (Task 2)
2. **세션 1개 제한** → 다른 프로그램과 충돌하면 오류 문구로 안내. (Task 2)
3. **종목코드 접두어(`A005930`)** → 정규화. (Task 1)
4. **토큰 만료 응답** → 1회 재발급 후 재시도. (Task 1)
5. **미국 잔고 API가 없으면** → 국내만 지원하고 연결 화면에 표시. (Task 2)

---

### Task 1: 공식 문서 확인과 국내 잔고
**Files:** `brokers/kiwoom.py` / Test `tests/brokers/test_kiwoom.py`
- 먼저 openapi.kiwoom.com 문서로 노트의 ❓·🔶를 채우고 노트를 고친다: 계좌번호 필요 여부, `kt00018` 필드, 연속 조회, 토큰 수명, **약관상 배포 앱 허용 여부**. 약관이 막으면 멈추고 사용자에게 알린다.
- [ ] 테스트(실패 확인): 토큰 발급·캐시, 필드 변환, 코드 정규화, 연속 조회, 만료 재시도, 허용 목록 밖 호출 거절
- [ ] 구현 → 커밋 `feat(brokers): 키움 국내 잔고`

### Task 2: 미국 잔고, 오류, 실연동
- [ ] 테스트(실패 확인): 해지·인증 오류 → `BROKER_AUTH_INVALID`, 세션 충돌 문구, 미국 잔고(있으면) 소수점
- [ ] 구현 → 사용자가 키움 키를 넣으면 `@pytest.mark.broker_live`로 확인(없으면 건너뛰고 PR에 적음) → 커밋 `feat(brokers): 키움 오류 처리와 실연동`
