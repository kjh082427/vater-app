# 한국투자증권: 보유 종목 연결 참고 노트

브랜치 `core/broker-kis`에서 어댑터를 설계·구현할 때 보는 자료다. 표시: ✅ 공식 자료 또는 이 저장소 코드로 확인, 🔶 2차 자료, ❓ 미확인. **❓와 🔶는 구현 전에 공식 문서로 확인한다.**

v2에서 한투는 시세·알림의 기준 증권사이므로 키가 계속 필수다. 보유 조회만 추가한다.

## 사용자에게 받는 값
| 값 | 필수 | 비고 |
|---|---|---|
| 앱키, 앱시크릿 | ✅ | 이미 있음(`KIS_APP_KEY`, `KIS_APP_SECRET`) |
| 계좌번호 앞 8자리, 뒤 2자리 | ✅ | **새로 받는다.** `CANO`, `ACNT_PRDT_CD`. 화면에는 가려서 표시 |
| HTS ID | 아니오 | 공식 샘플 설명상 체결 통보 등에 쓰는 값. 잔고 조회 파라미터에 없음 🔶 |

## 인증
- 이미 있는 `kis/auth.py`의 `TokenManager`를 그대로 쓴다 ✅
- 토큰은 24시간, 1일 1회 발급 원칙. 앱이 저장해 다시 쓴다 ✅

## 보유 조회
- 국내: `TTTC8434R`(모의 `VTTC8434R`), 경로 `/uapi/domestic-stock/v1/trading/inquire-balance` 🔶
- 필수 파라미터: `CANO`, `ACNT_PRDT_CD`, `AFHR_FLPR_YN`, `OFL_YN`, `INQR_DVSN`, `UNPR_DVSN`, `FUND_STTL_ICLD_YN`, `FNCG_AMT_AUTO_RDPT_YN`, `PRCS_DVSN`, `CTX_AREA_FK100`, `CTX_AREA_NK100` 🔶
- 응답 `output1`: `pdno`(종목코드), `prdt_name`(이름), `hldg_qty`(보유 수량) 🔶
- 연속 조회: 실전 50건, 모의 20건씩. 헤더 `tr_cont`와 컨텍스트 값으로 이어 받는다 🔶
- 해외: 별도 API ❓ TR ID와 응답 필드 확인 필요

## 주문 금지
- 잔고 경로에도 `/trading/`이 들어 있다. 기존 가드는 `/trading/order`와 끝자리 `U` TR ID만 막으므로 이 경로는 통과한다 ✅
- 쓰는 TR을 허용 목록으로 고정한다. 주문 TR(`TTTC0802U` 등)은 절대 넣지 않는다.

## 확인할 것
- [ ] 해외 잔고 TR, 소수점 주식 응답 형식
- [ ] 결제 전 수량 처리: 매도 직후 `hldg_qty`가 어떻게 보이는지
- [ ] `ACNT_PRDT_CD`가 `01`이 아닌 계좌(연금 등)의 조회 범위
- [ ] 실제 키로 `kis_live` 테스트

## 자료
- https://raw.githubusercontent.com/koreainvestment/open-trading-api/main/README.md
- https://algolab.co.kr/blog/kis-api-inquire-balance-continuous-2026
