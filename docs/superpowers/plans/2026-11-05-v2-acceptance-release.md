# v2 확인 테스트와 0.2.0 릴리스 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v2 전체를 실제 쓰는 흐름으로 확인하고 `v0.2.0`을 공개한다.

**Spec:** v2 설계 전체, `2026-11-02-vater-mvp-design.md` 0장. 브랜치 `ui/acceptance-v2`, `infra/release-0.2`(버전 올리기). 선행: 다른 v2 브랜치 전부.

## Global Constraints
- 저장소 `vater-releases`와 업데이트 주소, 서명 키를 바꾸지 않는다. `v0.1.0`은 남긴다. 업로드 토큰 만료 시 사용자에게 안내한다.
- 공개 전 사용자에게 알린다.

## Review Focus
1. **`0.1.0`에서 업데이트한 사용자** → DB 올라가고 감시 종목·규칙·대시보드 유지. (Task 1, 3)
2. **번들에 분류표가 빠짐** → 설치본에서 분류 API가 동작. (Task 2)
3. **키가 로그에 남음** → 설치 스모크에서 검사. (Task 2)
4. **주문 경로** → 세 어댑터와 화면 모두 없음. (Task 1)
5. **어댑터별 오류** → 한 증권사 실패가 앱 전체로 번지지 않음. (Task 1)

---

### Task 1: 확인 테스트 (Linux, Playwright)
- 기존 `e2e/acceptance` 판에 흉내 증권사 서버 3개를 더한다. V1 연결 → 업로드 → 체크 해제, V2 같은 종목 합산·토글, V3 평가금액·손익, V4 주기 설정, V5 끊김·해제·삭제, V6 수동·CSV, V7 분류 탐색(통합·시장), V8 자산 추이 빈 날 채움·환율 없음, V9 평단가 알림, V10 브리핑 구역, V11 0.1.0 DB 올리기, V12 주문 경로 0
- [ ] 전부 통과, 결함은 해당 영역 브랜치에서 수정 → 커밋 `test(acceptance): v2 확인 테스트`

### Task 2: Windows 확인과 rc
- [ ] `check-versions.py --set 0.2.0-rc.1`을 옆 브랜치에서, 태그 → `release.yml` 통과 → W1~W9, 설치본 분류 API, R3~R5 재실행, R8(`https_tag`), 로그·파일에 비밀값 없음

### Task 3: 정식 공개
- [ ] main을 `0.2.0`으로 올리는 PR → `stage`와 별개로 `v0.2.0` 태그 → 공개 확인(로그인 없이 `latest.json`, 파일 3개)
- [ ] 사용자 확인: 실제 `v0.1.0` 설치 → 앱이 새 버전 알림 → [지금 설치] → 데이터 유지. 실제 키로 연결. 수동 확인 목록 전달
