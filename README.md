# Vater

국내·미국 주식의 시세, 알림, AI 분석, 보유 현황을 한곳에서 보는 **Windows 설치형 개인 투자 보조 앱**입니다.

> 투자 판단 보조용이며 투자 권유가 아닙니다. 앱에는 주문 기능이 없습니다. 증권사 키를 넣어도 조회만 합니다.

## 설치
[설치 안내](docs/INSTALL.md)를 보세요. 설치 파일은 [vater-releases](https://github.com/kjh082427/vater-releases/releases/latest)에 있습니다. 설치한 앱은 새 버전을 찾아 서명을 확인한 뒤 업데이트합니다.

## 기능

### v1 (0.1.0)
- **AI 종목 분석:** 국내·미국 종목. 애널리스트 분석, 강세·약세 토론, 리스크 검토를 거쳐 결정(매수~매도)과 3줄 요약을 냅니다. [TradingAgents](https://github.com/TauricResearch/TradingAgents)를 씁니다.
- **알림:** 가격, 기술 지표(이동평균, RSI, MACD, 볼린저밴드, 거래량, 52주 신고가·신저가), 이벤트. 장중에는 실시간으로 감시합니다.
- **일일 시장 브리핑:** 국내·미국 장 마감 뒤 자동으로 만듭니다.
- **대시보드 홈:** 칸 수, 배치, 칸마다 띄울 내용을 직접 골라 탭으로 여러 장 만듭니다.
- **AI 선택:** 클라우드(Gemini 무료 등급 등), 로컬(Ollama), 혼합.

### v2 (0.2.0)에서 더한 것
- **증권사 연결:** 한국투자, 키움, 메리츠 계좌의 보유 종목을 읽어 옵니다. 삼성, 미래에셋 등은 직접 입력하거나 CSV로 가져옵니다.
- **내 보유:** 종목 화면의 주가 그래프 아래에 평가금액, 손익, 증권사별 수량을 보여 줍니다. 원화와 달러는 따로 보고, 전체는 그날 환율로 환산합니다.
- **보유 종목 올리기:** 보유 종목을 골라 감시 종목에 한 번에 넣고 알림 규칙도 함께 적용합니다.
- **자산 추이:** 주식 평가금액과 매입금액을 매일 기록해 그래프로 봅니다.
- **평단가 알림:** 평단가 대비 ±N%에 도달하면 알립니다. 기본은 꺼져 있습니다.
- **분류로 찾기:** 반도체, 2차전지, 바이오 등 테마 26개와 미국 업종으로 종목을 찾습니다.
- **브리핑 내 자산:** 그날 평가금액 변화와 많이 오르거나 내린 보유 종목을 보여 줍니다.
- **대시보드 편집:** 칸을 끌어 서로 바꾸고, 맨 위 숫자 줄의 순서를 바꿉니다.
- **분석 안정성:** 무료 Gemini가 혼잡하면 기다렸다 다시 시도하고, 다른 무료 모델로 넘어갑니다.

## 개인정보
- 키와 토큰은 Windows 자격 증명 관리자에 저장하고, 로그에는 가려서 남깁니다.
- **보유 내역(계좌번호, 수량, 평단가, 금액, 보유 종목, 증권사)은 어떤 AI에도 보내지 않습니다.** AI가 받는 것은 공개 시장 자료, 감시 종목, 분석하려고 고른 종목뿐입니다.

## 구성
| 계층 | 기술 | 폴더 |
|---|---|---|
| 데스크톱 셸 | Tauri 2 (Rust) | `apps/desktop/src-tauri` |
| 화면 | React + TypeScript | `apps/desktop/src` |
| 사이드카 | Python 3.13 + FastAPI | `sidecar/` |

## 같이 작업하는 분께
- 작업 규칙: [`CLAUDE.md`](CLAUDE.md). 앱 영역 1개 = 브랜치 1개이고, PR은 merge commit으로 합칩니다.
- 설계: v1 [`docs/superpowers/specs/2026-11-02-vater-mvp-design.md`](docs/superpowers/specs/2026-11-02-vater-mvp-design.md), v2 [`docs/superpowers/specs/2026-11-05-v2-design.md`](docs/superpowers/specs/2026-11-05-v2-design.md)
- 구조 지도(폴더 ↔ 브랜치 ↔ PR): [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- 증권사별 참고 노트: [`docs/brokers/`](docs/brokers/)
- 화면 개발과 확인 테스트: [`apps/desktop/README.md`](apps/desktop/README.md), 사이드카: [`sidecar/README.md`](sidecar/README.md)
- 사용한 Claude Code 도구: [`docs/TOOLING.md`](docs/TOOLING.md)
