# Vater

한국투자증권 시세와 [TradingAgents](https://github.com/TauricResearch/TradingAgents) 멀티에이전트 분석을 결합한 **Windows 설치형 개인 투자 보조 앱**입니다.

> 투자 판단 보조용이며 투자 권유가 아닙니다. 앱은 주문 기능이 없습니다.

## 1차 버전 기능
- **AI 종목 분석 리포트**: 국내와 미국 종목. 애널리스트, 강세·약세 토론, 리스크 검토를 거쳐 결정을 내립니다.
- **알림**: 가격, 기술 지표(이동평균선, RSI, MACD, 볼린저밴드, 거래량, 52주 신고가·신저가), 이벤트.
- **일일 시장 브리핑**: 국내·미국 장 마감 후 자동 생성.
- **LLM 선택**: 클라우드 / 로컬(Ollama 선택 설치) / 혼합.

## 구성
| 계층 | 기술 | 폴더 |
|---|---|---|
| 데스크톱 셸 | Tauri 2 (Rust) | `apps/desktop/src-tauri` |
| UI | React + TypeScript | `apps/desktop/src` |
| 백엔드 (사이드카) | Python 3.13 + FastAPI | `sidecar/` |

## 문서
- 설계 스펙: [`docs/superpowers/specs/2026-11-02-vater-mvp-design.md`](docs/superpowers/specs/2026-11-02-vater-mvp-design.md)
- 구조 지도 (폴더 ↔ 브랜치 ↔ PR): [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- 사용한 Claude Code 도구: [`docs/TOOLING.md`](docs/TOOLING.md)

## 상태
1단계(설계) 진행 중입니다.
