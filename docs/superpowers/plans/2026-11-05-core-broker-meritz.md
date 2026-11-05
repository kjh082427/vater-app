# core/broker-meritz 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메리츠 계좌의 보유 종목을 어댑터로 불러온다.

**Architecture:** `brokers/meritz.py`, `ReadOnlyHttp`로만 호출한다. 기본 주소 `https://openapi.imeritz.com`, 토큰 `POST /oauth2/token`(scope `login`, 12시간, `expires_in` 60초 전 재발급).

**Spec:** v2 설계 0, 1, 8장. 참고: `docs/brokers/meritz.md`. 선행: `core/holdings`.

## Global Constraints
- 라벨 `area:core`. **경로 허용 목록 고정. 주문 경로 금지.** 공식 명세의 메리츠 주문 경로를 `tests/test_readonly_guarantee.py`의 패턴과 그 테스트에 더한다.
- 모든 요청에 `mac_address`(12자리 대문자 16진수). 앱은 `uuid.getnode()`로 읽는다. MAC을 로그에 쓰지 않는다.
- 계좌 비밀번호는 받지 않는다. 조회에 필요하다고 확인되면 멈추고 사용자에게 묻는다.

## Review Focus
1. **`uuid.getnode()`가 임의 값을 줌**(멀티캐스트 비트) → 오류 문구로 알리고 호출하지 않는다. (Task 1)
2. **MAC 없음 응답 `IGW50024`** → 이유가 보이는 오류. (Task 2)
3. **토큰 만료 직전** → 미리 재발급. (Task 1)
4. **해외 잔고가 다른 필드** → 소수점·통화. (Task 2)
5. **모의 계좌 없음** → 테스트는 흉내 서버, 실연동은 조회만. (Task 2)

---

### Task 1: 공식 명세 확인, 인증, 국내 잔고
**Files:** `brokers/meritz.py` / Test `tests/brokers/test_meritz.py`
- 먼저 개발자 포털 명세로 노트를 채운다: 실제 경로·필드, 계좌번호·비밀번호 필요 여부, 호출 한도, **약관상 배포 앱 허용 여부**. 약관이 막으면 멈추고 알린다.
- `mac_address() -> str` 단위 테스트
- [ ] 테스트(실패 확인): 헤더, 토큰 캐시·재발급, 필드 변환, 연속 조회, 허용 목록
- [ ] 구현 → 커밋 `feat(brokers): 메리츠 인증과 국내 잔고`

### Task 2: 해외 잔고, 오류, 실연동
- [ ] 테스트(실패 확인): `ovs_holdings` 변환, `IGW50024`, 인증 오류
- [ ] 구현 → 키가 있으면 `broker_live`로 확인 → 커밋 `feat(brokers): 메리츠 해외 잔고와 오류 처리`
