# 메리츠증권: 보유 종목 연결 참고 노트

어댑터 `sidecar/src/vater_core/brokers/meritz.py`의 근거 자료다. 표시: ✅ 공식 자료로 확인, 🔶 2차 자료, ❓ 미확인. 공식 자료는 메리츠 공식 조직(https://github.com/meritz-securities)의 `open-api`(`openapi.json` 2026-10-28, `docs/errors.md`)와 `open-api-mcp`(`meritz/data/catalog.json`, `corrections.json`)다. 모두 MIT다.

## 사용자에게 받는 값
| 값 | 필수 | 비고 |
|---|---|---|
| App Key, App Secret | ✅ | 앱키 하나에 계좌 하나가 묶인다 ✅. 계좌가 둘이면 연결도 둘 |
| 계좌번호 | 아니오 | 요청에 넣지 않아도 그 앱키의 계좌가 조회된다 ✅ |
| 계좌 비밀번호 | 아니오 | 조회 호출 명세에 없다 ✅ |

## 앱이 보내는 값
- **MAC 주소: 토큰 발급을 뺀 모든 호출에 `mac_address` 헤더 필수.** 12자리 대문자 16진수, 없으면 `IGW50024`로 거절 ✅. `uuid.getnode()`로 읽고 로그에 쓰지 않는다. 임의 값(멀티캐스트 비트)이면 호출하지 않고 오류로 알린다. 무엇을 왜 보내는지 연결 화면에 안내한다.

## 인증
- 기본 주소 `https://openapi.imeritz.com:9443` ✅
- `POST /oauth2/token`, 폼 본문 `grant_type=client_credentials`, `client_id`, `client_secret`, `scope=login`. 응답 `access_token`, `expires_in` ✅
- 만료 시각을 쓰지 않고 `EGW00121`, `EGW00123`, 401을 받으면 한 번 다시 발급한다 ✅
- 잘못된 키는 HTTP 403, `EGW00103` ✅

## 보유 조회
- 국내 `GET /accounts/v1/me/holdings?nthn_rmnd_incu_yn=N` ✅. 응답 `data[]`: `iscd`(`A005930`), `isnm`, `rmnd_qty`, `byng_unpr`, `pros_trgt_cls_code`
- **이 목록에 해외 행이 섞여 온다.** `pros_trgt_cls_code`가 `J`이면 해외 행이라 빼고 해외 조회를 쓴다 ✅
- 해외 `GET /accounts/v1/me/overseas/holdings` ✅. 응답 `data[]`: `ovrs_stck_symb_iscd`(순수 심볼), `iscd`(`AAPL.OQ`), `isnm`, `rmnd_dqty`(소수 수량), `avrg_unpr`, `crcd`
- 연속 조회: `rsp_cd=5762`이면 다음 쪽이 있다. 쿼리 `tr_cont=1`과 응답의 `tr_cont_key`를 공백까지 그대로 보낸다 ✅
- 성공 코드는 `5766`(조회 완료), `5820`(자료 없음), `5762`(다음 쪽 있음)이다. 다음 쪽은 `tr_cont=1`로도 알린다 ✅
- 두 목록의 해외 종목이 일치해야 저장한다. 두 목록이 모두 비면 `GET /accounts/v1/me/valuation/by-asset`(`aset_cls_code` 01, 02)의 `vltn_amt`가 0일 때만 보유 없음으로 믿는다. `pros_trgt_cls_code`가 `1`이면 국내, `J`면 해외, 그 밖은 지원하지 않는 행이다 ✅

## 오류
- 업무 오류도 HTTP 500으로 온다. `rsp_cd`를 먼저 본다 ✅
- `EGW00200`은 초당 건수 초과이고 500으로 온다 ✅

## 제한
- 두 조회 모두 초당 10건 ✅. 쪽 사이에 0.15초를 쉰다
- 모의 서버가 없다(카탈로그의 도메인은 운영뿐) ✅. 테스트는 흉내 서버, 실연동은 조회만

## 약관
- **확인하지 못했다.** Open API 이용약관 원문을 포털과 `home.imeritz.com/contract/CtcnList.do`에서 찾지 못했다. API 신청 화면에서 동의하는 약관으로 보이며 로그인이 필요할 수 있다.
- 공개 자료에서 본 문구: 포털 소개의 "AI로 나만의 투자 서비스를 구현", 저장소 면책 문서의 "메리츠증권 Open API 이용약관 및 개인정보 처리방침에 따릅니다". 배포 앱의 허용이나 금지를 말하는 문장은 아니다.
- **v0.2.0 공개 전에 사용자가 API 신청 화면의 약관을 확인한다.** 금지 조항이 있으면 메리츠 연결을 뺀다.

## 주문 금지
- 키 자체는 주문이 가능하다고 본다. 호출 가능한 것은 토큰 발급과 두 조회뿐이다.
- 가드(`tests/test_readonly_guarantee.py`)가 막는 것: `/trading/v1/` 전체, `/forex/v1/exchanges`, 주문 TR `obtrs_oder_*a`, `obtro_oder_*a`, 환전 TR `obtsd_fbnk_*a` ✅ 공식 카탈로그로 확인

## 확인할 것 (실제 키 필요)
- [ ] 빈 계좌, 해외 거래 없는 계좌의 실제 응답
- [ ] 국내 목록의 해외 행과 해외 조회의 `iscd`가 실제로 일치하는지. 다르면 동기화가 실패한다(내역은 지키는 쪽으로 정했다)
- [ ] 빈 계좌에서 `by-asset` 응답 모양
- [ ] MAC 주소가 바뀌면(다른 네트워크 장치) 토큰이나 호출이 거부되는지
- [ ] 실연동: 루트 `.env`에 `MERITZ_TEST_APP_KEY`, `MERITZ_TEST_APP_SECRET`을 넣고 `cd sidecar && uv run pytest -m broker_live -k meritz -q -s`

## 자료
- https://openapi.imeritz.com/about-openapi
- https://github.com/meritz-securities/open-api-mcp
