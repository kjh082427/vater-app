# 사용한 Claude Code 도구

이 프로젝트에서 쓰는 스킬, 플러그인, MCP 목록입니다. 새로 설치하면 이 표에 추가합니다.

## Claude가 이 프로젝트를 위해 설치한 것

| 날짜 | 도구 | 버전 | 범위 | 출처 | 용도 | 참고 |
|---|---|---|---|---|---|---|
| 2026-11-02 | `impeccable` 플러그인 (+ 마켓플레이스) | 4.8.0 | 프로젝트 (`.claude/settings.json`) | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | UI 품질 점검: critique, audit, polish, PRODUCT.md, DESIGN.md | 훅 3개(세션 시작, 파일 수정 직후, 응답 종료). 처음 실행할 때 GitHub Releases에서 엔진 실행 파일을 받아 sha256으로 검증. 스크립트에서 텔레메트리는 보이지 않음 |
| 2026-11-02 | `taste-skill` 플러그인 (+ 마켓플레이스) | 2.1.5 | 사용자 전체 | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | 앱 화면 아트 디렉션 | Node 22 이상과 Chromium이 필요(브라우저 점검용) |

## 개발 도구 (Claude가 설치)
| 날짜 | 도구 | 버전 | 위치 | 용도 | 참고 |
|---|---|---|---|---|---|
| 2026-11-03 | uv (+ uvx) | 0.13.6 | `~/.local/bin` | Python 버전·의존성 관리 | GitHub Releases 공식 바이너리, sha256 검증 (`curl \| sh` 설치 스크립트는 worktree 격리 규칙 때문에 쓰지 않음) |
| 2026-11-03 | Python | 3.13 | uv 관리 폴더 | 검증 실험·사이드카 실행 | `uv python install 3.13` |
| 2026-11-03 | Ollama 모델 | `qwen3.5:4b`, `qwen3.5:9b` | Windows Ollama | 로컬 LLM 검증 | Ollama 0.40.13은 사용자가 설치 |
| 2026-11-03 | fonttools + brotli (`uvx`로 실행) | fonttools 4.68.0 | uv 캐시 (설치하지 않음) | Hahmlet 글꼴 서브셋, woff2 변환 (`pyftsubset`, `varLib.instancer`) | `ui/design-system`. 명령은 `apps/desktop/src/design-system/fonts/make-fonts.sh` |
| 2026-11-03 | 프런트엔드 npm 의존성 | `apps/desktop/package.json`에 정확한 버전 고정 | `apps/desktop/node_modules` (git 제외) | Vite, React 18, TypeScript, Vitest, ESLint, Prettier | `npm install --before=2026-10-20`으로 2주 이상 지난 버전만 받음. `package-lock.json` 커밋 |
| 2026-11-03 | `@tauri-apps/api` | 2.12.4 (2026-10-14 배포) | `apps/desktop` dependencies | 화면이 셸 커맨드·이벤트를 부르는 통로(`src/platform/`만 씀) | `ui/screens`. `npm install --save-exact --before=2026-10-20` |
| 2026-11-03 | `openapi-typescript` | 7.13.0 (2026-02-11 배포) | `apps/desktop` devDependencies | 사이드카 OpenAPI 스냅샷 → `src/api/schema.d.ts` (`npm run gen:api`) | `ui/screens`. 피어 의존성이 TypeScript 5라서 `package.json`의 `overrides`로 앱의 TypeScript 6.0.3을 쓰게 함. 같은지 `schema.test.ts`가 검사 |
| 2026-11-03 | `msw` (Mock Service Worker) | 3.0.3 (2026-10-10 배포) | `apps/desktop` devDependencies | 테스트와 견본 화면(`mock.html`)의 사이드카 흉내(스펙 10장) | `ui/screens`. 3.x는 `listen({ onUnhandledFrame })`. 서비스 워커는 쓰지 않고 `getResponse`로 처리기를 직접 부름 |
| 2026-11-03 | `@playwright/test` | 1.64.1 (2026-10-14 배포) | `apps/desktop` devDependencies | 화면 흐름 테스트(`npm run e2e`, 실제 개발 모드 사이드카) | `ui/screens`. `npm install --save-exact --before=2026-10-20` |
| 2026-11-03 | Playwright Chromium (Chrome Headless Shell 156.0.8078.4, chromium-1248) | playwright 1.64.1가 고른 빌드 | `~/.cache/ms-playwright` (사용자 캐시, 저장소 밖) | 흐름 테스트와 impeccable 검출기(`IMPECCABLE_BROWSER`)의 브라우저 | `npx playwright install chromium`. WSL에서 바로 실행됨(시스템 라이브러리 추가 설치 없음) |

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
