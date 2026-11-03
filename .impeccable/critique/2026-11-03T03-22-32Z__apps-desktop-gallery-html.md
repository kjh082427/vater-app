---
target: 디자인 시스템 견본 gallery.html
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/home/kjh08/work/vater-app/.claude/worktrees/ui+design-system/apps/desktop/gallery.html"
target_fingerprint: "sha256:d4c119aa58764ea9aa1e2bac43d54d099f536b93eeab3ae8a8911651cc970845"
target_path: /home/kjh08/work/vater-app/.claude/worktrees/ui+design-system/apps/desktop/gallery.html
timestamp: 2026-11-03T03-22-32Z
slug: apps-desktop-gallery-html
---
Method: dual-agent (A: design review sub-agent · B: detector sub-agent). 대상: apps/desktop/gallery.html (컴포넌트 견본 + #shell, #shell-offline), Operate 모드.

## Design Health Score (고치기 전)
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | 700px 미만 높이에서 상태 표시줄이 화면 밖, 오프라인 틀이 서로 다른 말, busy와 disabled가 같아 보임 |
| 2 | Match System / Real World | 3 | 국내 관례(빨강 상승, 억, 원, 장중/마감)는 좋음. "폴링", "수신" 같은 개발 용어 |
| 3 | User Control and Freedom | 3 | 감시 일시 중지/다시 시작, 배너 재시도. 안내 배너 닫기 없음 |
| 4 | Consistency and Standards | 3 | 토큰 일관. 안쪽 구역(h3)이 h2와 같은 모양, 빨강·파랑을 의견에도 씀 |
| 5 | Error Prevention | 3 | 주문 버튼 없음, 주 버튼 하나. 입력 컴포넌트는 아직 없음 |
| 6 | Recognition Rather Than Recall | 3 | 아이콘에 늘 글자. 작은 의견 눈금에 양 끝 표시 없음 |
| 7 | Flexibility and Efficiency | 3 | 건너뛰기 링크, 표 행 화살표 이동, ARIA 탭 |
| 8 | Aesthetic and Minimalist Design | 3 | 절제. 감시 상태가 세 곳에 중복 |
| 9 | Error Recovery | 3 | 배너에 원인 + 해결 버튼(황토). 구역 단위 오류·AI 문장 빠짐 상태 없음 |
| 10 | Help and Documentation | 1 | 도움말·용어 설명 컴포넌트 없음(의견 눈금, 비중확대, 폴링) |
| **Total** | | **27/40** | **Acceptable(상단)** |

## Design Specificity Verdict
제품에 맞춰 만든 것(범주 공용 아님): 의견 눈금과 눈금 밖의 검토 필요, AI 문장 명조 / 데이터 고딕, 카드 대신 2px 먹선, 색 없는 크롬, 황토 주의, U+2212·억·원 표기, 실시간/폴링/끊김. 검출기(B): CLI 54파일 지적 0, CDP 렌더링 #shell·#shell-offline 1024×700 지적 0, 카탈로그 em-dash-overuse 1건은 토큰 이름의 `--`를 센 거짓 양성.

## Priority Issues
- [P1] AI 문장(명조)과 데이터(고딕) 구분이 1배율에서 안 보임 → 고침: AiText 왼쪽 1px 선 + 들여쓰기, 요약에 "AI 요약" 꼬리표.
- [P1] min-height 43.75rem 때문에 1920×1080@150% 창(CSS 높이 약 640)에서 상태 표시줄이 사라짐 → 고침: 높이 제한 제거, 본문·사이드바 각자 스크롤.
- [P2] 오프라인 틀이 "일시 중지"와 "감시 중"을 동시에 표시 → 고침: 한 offline 값으로 배너·상태 표시줄·사이드바·표가 함께 바뀜, 감시 상태는 한곳.
- [P2] 작은 의견 눈금 빈 칸 1.30:1, 빨간 굵은 "매수"가 HTS 주문 버튼처럼 읽힘 → 고침: 빈 칸 1px ink-3 테두리, 결정 이름 먹색, 방향 색은 채운 칸에만.
- [P2] busy 버튼이 disabled라 포커스를 잃음, AI 문장 빠짐·표 로딩·오래된 행 상태 없음 → busy 고침. 나머지 상태는 ui/screens에서 실제 데이터 흐름과 함께.

## Persona Red Flags
- 박 부장(50대, HTS 10년, 1080p 노트북 150%): 상태 표시줄이 안 보임, 빨간 "매수"가 주문 버튼처럼, 명조 구분이 안 보여 AI 문장을 데이터로 읽음.
- 처음 쓰는 사람: 의견 눈금·비중확대·폴링 설명 없음, 빈 표 안내가 다른 화면을 가리킴.
- 저시력·키보드 사용자: 빈 칸 대비, 200% 확대에서 상태 표시줄 잃음, busy 후 포커스가 처음으로.

## Minor Observations
화면 머리(제목 + 기준 시각 + 주 버튼) 컴포넌트가 없음, 입력 컴포넌트 없음, 1024 창에서 두 열이 한 열로 바뀌어 최근 분석이 아래로, 이미 떠 있는 role="alert" 배너는 읽히지 않을 수 있음.

## Questions to Consider
- 명조가 15px에서 잘 안 보인다면, 배치(해설 단락의 선, 꼬리표)가 "AI의 말"을 맡고 글꼴은 결을 더하는 정도로 두면 어떤가?
- 의견 눈금의 채운 칸까지 먹으로 하면 빨강·파랑은 정말 시세 방향 하나의 뜻만 갖는다. 국내 관례와 어느 쪽이 나은가?
