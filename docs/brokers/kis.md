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
- 국내: `TTTC8434R`(모의 `VTTC8434R`), 경로 `/uapi/domestic-stock/v1/trading/inquire-balance` ✅ 공식 샘플
- 필수 파라미터: `CANO`, `ACNT_PRDT_CD`, `AFHR_FLPR_YN`, `OFL_YN`, `INQR_DVSN`, `UNPR_DVSN`, `FUND_STTL_ICLD_YN`, `FNCG_AMT_AUTO_RDPT_YN`, `PRCS_DVSN`, `CTX_AREA_FK100`, `CTX_AREA_NK100` ✅ 공식 샘플. `INQR_DVSN=02`(종목별)를 쓴다
- 응답 `output1`: `pdno`(종목코드), `prdt_name`(이름), `hldg_qty`(보유 수량), `pchs_avg_pric`(평단가) ✅ 공식 샘플
- 연속 조회: 응답 헤더 `tr_cont`가 `F`·`M`이면 다음 쪽이 있다. 요청 헤더 `tr_cont=N`과 응답의 컨텍스트 값으로 이어 받는다 ✅ 공식 샘플. 쪽당 건수(실전 50, 모의 20)는 🔶
- 해외: `CTRP6504R`(모의 `VTRP6504R`), 경로 `/uapi/overseas-stock/v1/trading/inquire-present-balance`, 체결 기준 현재 잔고 ✅ 공식 샘플. `NATN_CD=000`(전체), `TR_MKET_CD=00`, `INQR_DVSN_CD=00`(미니스탁 포함), `WCRC_FRCR_DVSN_CD=02`(외화). 한 번으로 모든 국가를 받는다. 다른 후보 `TTTS3012R`는 거래소와 통화마다 따로 불러야 해서 쓰지 않는다
- 해외 응답 `output1`: `pdno`, `ccld_qty_smtl1`(체결 수량 합계), `avg_unpr3`(평균 단가), `ovrs_excg_cd`, `natn_kor_name`, `buy_crcy_cd` ✅ 공식 샘플. `prdt_name`은 샘플 표에 없어 없으면 코드를 이름으로 쓴다 ❓

- 빈 계좌의 실제 응답 모양(2026-11-05 확인): 국내 `output1=[]`, `output2=[{scts_evlu_amt: 0, ...}]`, 해외 `output1=[]`, `output3={evlu_amt_smtl: 0, ...}` ✅
- 목록이 비면 위 합계가 0일 때만 "보유 없음"으로 믿는다. 목록이 없거나 합계가 0이 아니면 저장하지 않는다. 주식 없이 펀드만 있는 계좌는 합계가 0이 아니어서 이 조건에 걸릴 수 있다 ❓

## 주문 금지
- 잔고 경로에도 `/trading/`이 들어 있다. 기존 가드는 `/trading/order`와 끝자리 `U` TR ID만 막으므로 이 경로는 통과한다 ✅
- 쓰는 TR을 허용 목록으로 고정한다. 주문 TR(`TTTC0802U` 등)은 절대 넣지 않는다.

## 확인할 것
- [x] 해외 잔고 TR
- [ ] 소수점 주식 응답 형식, `ccld_qty_smtl1`과 `cblc_qty13` 중 어느 쪽이 맞는지
- [x] 빈 계좌: 보유 종목이 없는 실제 계좌에서 국내·해외 조회 모두 오류 없이 0건을 돌려줬다(2026-11-05)
- [ ] 결제 전 수량 처리: 매도 직후 `hldg_qty`가 어떻게 보이는지
- [x] `ACNT_PRDT_CD`가 `01`이 아닌 계좌: v2는 받지 않는다(연금은 공식 샘플상 `TTTC2208R`을 따로 쓴다)
- [ ] 실제 보유 종목으로 `kis_live` 테스트(수량·평단가 필드 확인): 주식이 있는 계좌로 루트 `.env`에 `KIS_TEST_ACCOUNT=계좌번호10자리`를 넣고 `cd sidecar && uv run pytest -m kis_live -k holdings -q -s`

## 자료
- https://raw.githubusercontent.com/koreainvestment/open-trading-api/main/README.md
- https://github.com/koreainvestment/open-trading-api/tree/main/examples_llm (`domestic_stock/inquire_balance`, `overseas_stock/inquire_present_balance`)
- https://algolab.co.kr/blog/kis-api-inquire-balance-continuous-2026
