# 메리츠증권: 보유 종목 연결 참고 노트

브랜치 `core/broker-meritz`에서 어댑터를 설계·구현할 때 보는 자료다. 표시: ✅ 공식 자료로 확인, 🔶 2차 자료, ❓ 미확인. **❓와 🔶는 구현 전에 공식 문서로 확인한다.**

## 사용자에게 받는 값
| 값 | 필수 | 비고 |
|---|---|---|
| App Key, App Secret | ✅ | **계좌별 발급** (공식). 계좌 둘이면 연결도 둘 |
| 계좌번호 | ❓ | 키가 계좌 단위라 불필요할 수 있음. MCP 도구의 `account`는 선택값 |
| 계좌 비밀번호 | 앱에는 받지 않음 | 포털에서 키를 신청할 때 입력(공식). 조회 호출에 필요한지 ❓ 필요하면 범위를 다시 판단한다 |

## 앱이 보내는 값
- **MAC 주소: 모든 API 호출에 `mac_address` 헤더 필수.** 12자리 대문자 16진수, 없으면 거부(공식). 사용자 입력이 아니라 앱이 PC에서 읽는다. 무엇을 왜 보내는지 연결 화면에 안내한다.

## 인증 (공식)
- 기본 주소 `https://openapi.imeritz.com`
- `POST /oauth2/token`: `client_id`, `client_secret`, scope `login`
- 토큰 12시간, 응답의 `expires_in` 기준으로 재발급. 폐기는 `POST /oauth2/revoke`

## 보유 조회
- 국내 `holdings`(내 계좌 종목별 평가 조회), 해외 `ovs_holdings`(해외주식 잔고 조회): 메리츠가 공개한 MCP의 이름 🔶
- 실제 경로, 파라미터, 응답 필드, 연속 조회 ❓ 개발자 포털 명세로 확인

## 제한
- 호출 한도 ❓
- 실계좌만 연결됨. 모의 계좌를 전제로 하지 않는다 🔶 → 테스트는 흉내 서버, 실연동은 조회만

## 주문 금지
- 메리츠 MCP의 "조회 전용"은 그 도구의 설정이지 키 권한이 아니다. **키 자체는 주문이 가능하다고 본다.**
- 기존 가드는 한투 패턴만 막는다. 메리츠 주문 경로를 가드에 더한다(공식 명세로 목록 확인).
- 호출 경로를 허용 목록으로 고정한다.

## 확인할 것
- [ ] 조회에 계좌번호·비밀번호가 필요한지
- [ ] MAC 주소를 어떤 네트워크 장치에서 읽을지, 장치 변경 시 동작
- [ ] 응답 필드와 소수점 수량, 호출 한도
- [ ] 약관상 사용자 본인 키를 넣는 배포 앱 허용 여부

## 자료
- https://openapi.imeritz.com/about-openapi
- https://openapi.imeritz.com/howto-use
- https://glama.ai/mcp/servers/meritz-securities/open-api-mcp/tools/meritz_account
- https://raw.githubusercontent.com/meritz-securities/open-api-mcp/main/DISCLAIMER.md
