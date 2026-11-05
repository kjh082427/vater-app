# 키움증권: 보유 종목 연결 참고 노트

어댑터 `sidecar/src/vater_core/brokers/kiwoom.py`의 근거 자료다. 표시: ✅ 공식 자료로 확인, 🔶 2차 자료, ❓ 미확인. 공식 자료는 오픈 API 포털과 키움 공식 저장소의 명세 `kiwoom/_data/kiwoom_api_spec.json`이다.

## 사용자에게 받는 값
| 값 | 필수 | 비고 |
|---|---|---|
| 앱키, 시크릿키 | ✅ | 호출 제한이 "계좌별(토큰별)"이고 잔고 TR에 계좌 파라미터가 없다. 키가 계좌에 묶인다고 본다 ✅ |
| 계좌번호 | 아니오 | 보내지 않는다 ✅. 같은 키의 중복 연결은 앱키로 막고, 연결 목록에는 앱키 해시 앞 4자리를 보인다 |
| 사전 조건 | ✅ | 키움 계좌 보유, HTS ID 연결, API 사용 신청 ✅. 앱 입력값은 아니다 |

## 인증
- 운영 `https://api.kiwoom.com`, 모의 `https://mockapi.kiwoom.com` ✅. 앱은 운영만 쓴다. 모의 키는 8030으로 실패하고, 3개월 자동 해지의 접속 기준도 실서버다 ✅
- `POST /oauth2/token`(`au10001`), 본문 `grant_type`, `appkey`, `secretkey`. 응답 `token`, `expires_dt`, `return_code`, `return_msg` ✅
- 토큰 유효 기간은 문서에 없다 ❓. 만료 시각을 쓰지 않고, 거부 응답을 받으면 한 번 다시 발급한다
- 오류 코드 8005(토큰 무효), 8010(발급 IP와 다름), 8031(투자구분 불일치), 8103은 재발급 대상이다 ✅. 8001·8002(키 검증 실패) 등 8000번대는 인증 실패다 ✅. `return_code=3`에 `return_msg="[8005:...]"`로 오는 경우도 있다 ✅

## 보유 조회
- 국내 `POST /api/dostk/acnt`, 헤더 `api-id: kt00018`, 본문 `qry_tp=1`(합산), `dmst_stex_tp=KRX` ✅. 응답 목록 `acnt_evlt_remn_indv_tot`: `stk_cd`, `stk_nm`, `rmnd_qty`, `pur_pric`. 합계 `tot_evlt_amt` ✅
- 종목코드는 접두어 1자리 + 6자리. A 주식, J ELW, Q ETN ✅. 숫자는 앞이 0으로 채워진 문자열이다 ✅
- 미국 `POST /api/us/acnt`, 헤더 `api-id: ust21070`, 본문 `stex_tp`, `stk_cd`는 비우면 전체 ✅. 목록 `result_list`: `stk_cd`, `frgn_stk_nm`, `poss_qty`, `frgn_stk_book_uv`, `crnc_code` ✅
- 연속 조회: 응답 헤더 `cont-yn=Y`이면 요청 헤더 `cont-yn=Y`, `next-key`로 이어 받는다 ✅

## 제한
- 조회 TR 초당 5회(국내), 미국 초당 5회(한국시간 9~10시는 3회) ✅. 쪽 사이에 0.25초를 쉰다
- 계좌별 세션 1개 ✅. REST에도 적용되는지는 문서에 없다 ❓. 실시간 시세 항목과 함께 적혀 있어 웹소켓 쪽으로 읽힌다
- 3개월 미접속 시 매월 첫 영업일에 자동 해지, 재등록 필요 ✅. 해지 때 어떤 오류 코드가 오는지는 ❓. 8000번대 전체에 재신청 안내를 붙였다

## 약관 (오픈 API 서비스 이용약관, 2026-06-01 개정)
- 배포 앱에서 사용자가 자기 키를 넣는 방식을 **금지하는 조항은 없다.** 명시적으로 허용하는 조항도 없다.
- 5조 2항: 앱키와 시크릿키를 제3자에게 대여, 위임, 양도, 누설하지 않는다. Vater는 키를 사용자 PC에만 두고 어디에도 보내지 않는다.
- 5조 3항: 시세 정보는 고객이 직접 쓰는 프로그램 등 개인 업무에만 쓰고 제3자에게 제공하지 않는다. Vater는 키움에서 본인 잔고만 읽고 재배포하지 않는다.
- 8, 9조: 비정상 조회 부하가 있으면 1개월 중단, 3회 이상이면 해지. 호출을 잔고 조회로 한정하고 간격을 둔다.
- 공식 저장소의 샘플 코드는 키움 라이선스(복제, 수정 금지)라서 가져오지 않았다. 명세의 필드 이름만 참고했다.

## 주문 금지
- 호출 가능한 것은 `/oauth2/token`, `kt00018`, `ust21070`뿐이다. 경로마다 TR이 하나로 고정돼 있다.
- 가드(`tests/test_readonly_guarantee.py`)가 막는 것: `/api/dostk/ordr`, `/api/dostk/crdordr`, `/api/us/ordr`, `/api/us/exchange`, `ust31300~ust31302`, `kt10000~kt10003`, `kt10006~kt10009`, `kt50000~kt50003`, `ust20000~ust20003`, `ust31490` ✅ 공식 명세로 확인

## 확인할 것 (실제 키 필요)
- [ ] 미국 거래를 안 하는 계좌에서 `ust21070`이 오류를 내는지. 오류면 연결 테스트가 실패한다
- [ ] 빈 계좌의 실제 응답 모양. 목록이 없거나 합계가 비어 있으면 동기화가 실패한다(내역은 지키는 쪽으로 정했다)
- [ ] `qry_tp=1`에서 대주(`crd_tp`) 행이 보유로 잡히는지. 명세에 설명이 없다
- [ ] 미국 소수 수량의 형식. 명세 예시는 정수뿐이다
- [ ] **출시 전 확인 권장:** `dmst_stex_tp=KRX`로 넥스트레이드에서 산 수량까지 보이는지. 빠지면 그 종목을 판 것으로 보인다. 명세에 전체(`%`) 값이 없다
- [ ] 주식 없이 합계만 있는 경우
- [ ] 실연동: 루트 `.env`에 `KIWOOM_TEST_APP_KEY`, `KIWOOM_TEST_APP_SECRET`을 넣고 `cd sidecar && uv run pytest -m broker_live -k kiwoom -q -s`

## 자료
- https://openapi.kiwoom.com/intro
- https://openapi.kiwoom.com/guide/apiguide
- https://github.com/Kiwoom-Securities/Kiwoom-REST-API
- https://download.kiwoom.com/deploy/AG001/pdf/AG001_110.pdf (오픈 API 서비스 이용약관)
