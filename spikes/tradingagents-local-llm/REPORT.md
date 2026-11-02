# 검증 실험 결과 보고서 (S1~S8)

> 스펙 13장의 미검증 가정을 실제로 돌려 확인한 결과입니다. 원시 결과(`runs/*.json`)는 git에서 제외되며, 이 문서에 요약합니다.

## 결론 요약
(Task 8에서 작성)

---

## S2. 국내 종목 데이터 품질
- **측정:** `inspect_data.py`, 기준일 2026-10-30(과거)과 2026-11-02(최근 거래일), 2026-11-03 01:40 KST 실행
- **종목:** `AAPL`, `005930.KS`(삼성전자), `247540.KQ`(에코프로비엠)

| 데이터 종류 | AAPL | 005930.KS | 247540.KQ |
|---|---|---|---|
| 가격 1년 (`get_stock_data`) | ✅ | ✅ (하루 지연) | ✅ (하루 지연) |
| 기술 지표 RSI·MACD (`get_indicators`) | ✅ | ✅ | ✅ |
| 기업 개요 (`get_fundamentals`) | ❌ 공개 시점 규칙으로 제외 | ❌ 같은 이유 | ❌ 같은 이유 |
| 재무제표 (`get_balance_sheet`, `get_income_statement`) | ✅ SEC EDGAR | ❌ SEC 없음 + yfinance 제외 | ❌ 같은 이유 |
| 종목 뉴스 7일 (`get_news`) | ✅ (최근 거래일 기준만, 과거 날짜는 ❌) | ❌ Yahoo에 국내 종목 뉴스 없음 | ❌ 같은 이유 |
| 내부자 거래 (`get_insider_transactions`) | ❌ 공개 시점 규칙으로 제외 | ❌ | ❌ |

**발견**
1. TradingAgents v0.7.1은 **point-in-time 원칙**(분석 기준일에 실제로 공개돼 있던 데이터만 씀)을 엄격히 지킵니다. 공개일이 없는 yfinance 재무·개요·내부자 데이터는 오늘 날짜라도 항상 제외합니다. 미국 재무제표는 공개일이 있는 SEC EDGAR가 대신합니다.
2. 국내 종목은 **가격과 기술 지표만** 쓸 수 있습니다. 재무와 종목 뉴스가 없으므로 기본 설정의 펀더멘털·뉴스 애널리스트는 "데이터 없음" 보고서만 냅니다.
3. Yahoo의 국내 일봉은 하루 늦게 들어옵니다(11/2 종가가 비어 있어 10/30을 최신으로 씀).

**결론 (스펙 13장 S2의 "실패하면" 대안 적용)**
- 국내 종목은 **소셜 애널리스트를 끕니다**(스펙 5장 원안 그대로).
- 국내 종목용 데이터 공급자 **`kis`를 1차 버전 `core/analysis`에 추가**합니다. TradingAgents의 `VENDOR_METHODS`에 등록하고, `.KS`/`.KQ` 종목에만 `tool_vendors`로 지정합니다.
  - 가격: 한투 일봉(지연 없음)
  - 재무: 한투 국내주식 재무비율·손익계산서·대차대조표 API
  - 뉴스: 한투 종합 시황·공시 제목 API
  - 앱은 "최근 거래일" 분석이므로 현재값을 그대로 제공합니다. point-in-time 제약은 백테스트용이라 1차 버전 범위가 아닙니다.
- DART 키가 없어서 DART 어댑터는 2차 버전에 그대로 둡니다.
- 한투의 재무·뉴스 API를 실제로 쓸 수 있는지는 `core/kis` 첫 작업에서 확인합니다. 안 되면 국내 종목은 펀더멘털·뉴스 애널리스트를 끄고 차트·거시 분석만 합니다.

---

## S7. Windows PyInstaller onedir 빌드
- **측정:** GitHub Actions `windows-latest`, 워크플로 `spike-pyinstaller` (실행 41484216852, 2026-11-02 16:43 UTC)
- **방법:** `pyinstaller --noconfirm --onedir --name smoke --paths . pyinstaller_smoke/smoke_entry.py`. 실행 파일이 TradingAgents를 import하고, LLM 호출 없이 `TradingAgentsGraph`를 만든 뒤 `SMOKE OK`를 출력하는지 확인

| 항목 | 결과 |
|---|---|
| 빌드 | ✅ **첫 시도에 성공.** `--hidden-import`나 `--collect-all` 같은 추가 옵션이 필요 없었음 |
| 실행 | ✅ `SMOKE OK 15 2.2s` (그래프 노드 15개) |
| 시작 시간 | 3.1초 (프로세스 시작부터 종료까지) |
| onedir 크기 | **123.8MB** (스펙에서 예상한 수백 MB보다 작음) |
| 빌드 시간 | 약 2분 (의존성 설치 포함) |

**결론**
- 스펙 11장의 "PyInstaller onedir + Tauri resources" 방식을 그대로 유지합니다. 내장 Python 방식으로 바꿀 필요가 없습니다.
- **남은 위험:** 스모크는 그래프 생성까지만 확인했습니다. Gemini 클라이언트처럼 실행 중에 늦게 import되는 모듈과 데이터 조회 경로는 확인하지 않았습니다. 그래서 `shell/tauri` 단계의 Windows CI에서 실제 사이드카 실행 파일로 `/health`와 분석 1건(가짜 엔진)을 검증합니다.
