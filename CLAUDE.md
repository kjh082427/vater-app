# Vater: Claude 작업 규칙

- 설계 스펙: `docs/superpowers/specs/2026-11-02-vater-mvp-design.md` (결정의 근거는 이 문서가 기준)
- 구조 지도: `docs/ARCHITECTURE.md`, 도구 목록: `docs/TOOLING.md`

## 언어
- 문서, PR 설명, 커밋 메시지 본문은 한국어로 쓴다. 코드 식별자와 커밋 제목의 접두어(`feat:`, `fix:` 등)는 영어로 쓴다.

## 브랜치와 PR
- 앱 영역 1개 = 브랜치 1개 = 폴더 1개 (스펙 12-1의 표). 영역을 벗어나는 수정은 그 영역의 브랜치에서 한다.
- 계획서의 작업 1개가 끝날 때마다 커밋하고 push한다.
- 브랜치가 완성되면 PR을 만든다(템플릿 4개 항목과 `area:*` 라벨). CI를 통과하면 `gh pr merge --merge`로 합친다. **squash는 금지하고, 브랜치는 삭제하지 않는다.**
- 단계가 끝나면 main에 `stage-N-<이름>` 태그를 붙인다.

## 절대 규칙
- **주문, 정정, 취소 API는 구현하지 않는다.** (`tests/test_readonly_guarantee.py`)
- 비밀키(한투 키, LLM 키, 토큰)를 코드, DB, 로그, 커밋, 채팅에 남기지 않는다. 개발 중에는 git에서 제외된 저장소 루트 `.env`를 쓴다(형식은 `.env.example`). 키 값을 출력하거나 cat하지 않는다.
- 새 스킬, 플러그인, MCP를 설치하면 `docs/TOOLING.md`에 기록한다.
- 테스트를 먼저 쓴다 (superpowers:test-driven-development).
