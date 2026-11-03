# Vater

한국투자증권 시세와 [TradingAgents](https://github.com/TauricResearch/TradingAgents) 멀티에이전트 분석을 결합한 **Windows 설치형 개인 투자 보조 앱**입니다.

> 투자 판단 보조용이며 투자 권유가 아닙니다. 앱은 주문 기능이 없습니다.

## 설치
[설치 안내](docs/INSTALL.md)를 보세요. 설치 파일은 [vater-releases](https://github.com/kjh082427/vater-releases/releases/latest)에 있습니다.

## 1차 버전 기능
- **AI 종목 분석 리포트**: 국내와 미국 종목. 애널리스트, 강세·약세 토론, 리스크 검토를 거쳐 결정을 내립니다.
- **알림**: 가격, 기술 지표(이동평균선, RSI, MACD, 볼린저밴드, 거래량, 52주 신고가·신저가), 이벤트.
- **일일 시장 브리핑**: 국내·미국 장 마감 후 자동 생성.
- **LLM 선택**: 클라우드 / 로컬(Ollama 선택 설치) / 혼합.
- **대시보드 홈**: 칸 수, 배치, 칸마다 띄울 내용을 직접 고르는 화면을 탭으로 여러 장 만듭니다.
- **자동 업데이트**: 새 버전을 찾아 서명을 확인한 뒤 설치합니다.

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
- 설치 안내: [`docs/INSTALL.md`](docs/INSTALL.md)

## 릴리스 방법 (개발자)
1. `python apps/desktop/src-tauri/packaging/check-versions.py --set X.Y.Z`로 버전을 맞춰 PR로 합칩니다.
2. main에 `vX.Y.Z` 태그를 push합니다. `release.yml`이 서명된 설치 파일과 `latest.json`을 `kjh082427/vater-releases`에 올립니다. `-rc.1` 같은 프리릴리스 태그는 프리릴리스로 올라가 자동 업데이트 대상이 되지 않습니다.
3. 서명 키는 `npx @tauri-apps/cli@2.12.3 signer generate -w ~/.tauri/vater-updater.key`로 한 번만 만듭니다. 필요한 Actions 비밀값: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `RELEASES_TOKEN`(`vater-releases`에만 contents 쓰기 권한). 공개 키는 `apps/desktop/src-tauri/tauri.conf.json`의 `plugins.updater.pubkey`에 있습니다. **서명 개인 키를 잃어버리면 이미 설치된 앱에 업데이트를 보낼 수 없으니 안전하게 보관합니다.**
