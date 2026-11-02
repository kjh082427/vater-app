# 사용한 Claude Code 도구

이 프로젝트에서 쓰는 스킬, 플러그인, MCP 목록입니다. 새로 설치하면 이 표에 추가합니다.

## Claude가 이 프로젝트를 위해 설치한 것

| 날짜 | 도구 | 버전 | 범위 | 출처 | 용도 | 참고 |
|---|---|---|---|---|---|---|
| 2026-11-02 | `impeccable` 플러그인 (+ 마켓플레이스) | 4.8.0 | 프로젝트 (`.claude/settings.json`) | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | UI 품질 점검: critique, audit, polish, PRODUCT.md, DESIGN.md | 훅 3개(세션 시작, 파일 수정 직후, 응답 종료). 처음 실행할 때 GitHub Releases에서 엔진 실행 파일을 받아 sha256으로 검증. 스크립트에서 텔레메트리는 보이지 않음 |
| 2026-11-02 | `taste-skill` 플러그인 (+ 마켓플레이스) | 2.1.5 | 사용자 전체 | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | 앱 화면 아트 디렉션 | Node 22 이상과 Chromium이 필요(브라우저 점검용) |

## 원래 설치되어 있던 것
| 도구 | 버전 | 용도 |
|---|---|---|
| superpowers | 6.4.2 | 브레인스토밍, 계획, TDD, 서브에이전트 개발, 코드 리뷰 |
| ui-ux-pro-max | 2.15.0 | 디자인 시스템, 토큰, 차트 |
| frontend-design | 1.1.1 | 프런트엔드 디자인 보조 |
| diagram-design | 2.6.110 | 구조도 |

## 설치 예정 (필요한 시점에)
| 도구 | 시점 | 용도 |
|---|---|---|
| KIS Code Assistant MCP | `core/kis` | 한투 API 문서·예제 검색 |
| Context7 MCP | 구현 시작 | 최신 라이브러리 문서 |
| Playwright MCP | `ui/*` | UI 확인, E2E 테스트 |
