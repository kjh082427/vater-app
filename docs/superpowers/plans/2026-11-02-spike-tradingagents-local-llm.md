# 검증 실험: TradingAgents + 로컬 LLM 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스펙 13장의 미검증 가정 S1~S8에 답하고, 결과를 `spikes/tradingagents-local-llm/REPORT.md`에 기록한다.

**Architecture:** 버리는 실험 코드다. 측정 스크립트(`run_spike.py` 등)로 TradingAgents를 직접 돌리고, 결과를 JSON(`runs/`, git 제외)과 요약 보고서(커밋)로 남긴다. 앱 코드는 쓰지 않는다. 결론은 스펙과 모델 카탈로그 초기값에 반영한다.

**Tech Stack:** Python 3.13, uv, TradingAgents v0.7.1, Ollama (Windows), GitHub Actions `windows-latest`, PyInstaller

**Spec:** `docs/superpowers/specs/2026-11-02-vater-mvp-design.md` (3-3, 5, 13장)

## Global Constraints
- 브랜치: `spike/tradingagents-local-llm`, 폴더: `spikes/tradingagents-local-llm/`, PR 라벨: `area:spike`
- 모든 스크립트 첫 줄에 `# SPIKE: throwaway code, not part of the app`
- TradingAgents는 `v0.7.1` 태그로 고정 (`git+https://github.com/TauricResearch/TradingAgents@v0.7.1`)
- Ollama 주소: `http://localhost:11434` (WSL mirrored 네트워크로 Windows Ollama에 접속)
- 모델: `qwen3.5:4b`, `qwen3.5:9b`, `num_ctx` 16384
- 토론 라운드: 리서치 1, 리스크 1
- 대상 종목: `AAPL`(미국), `005930.KS`(코스피), `247540.KQ`(코스닥, 에코프로비엠). 기준일은 실행일 직전 거래일
- 원시 결과: `runs/*.json` (git 제외). 커밋하는 것은 스크립트와 `REPORT.md`뿐
- 클라우드 키는 저장소 루트의 `.env`(git 제외)에서 읽는다. 이 파일은 사용자가 편집기로 직접 채운다. 이름 대응은 `LLM_ANTHROPIC_KEY → ANTHROPIC_API_KEY`, `LLM_OPENAI_KEY → OPENAI_API_KEY`, `LLM_GOOGLE_KEY → GOOGLE_API_KEY`이고, `presets.py`가 실행 시 환경변수로 옮긴다. 키는 채팅이나 `!` 명령으로 받지 않는다(명령 내용이 대화 기록에 남는다)

## Review Focus
1. **첫 모델 로딩 시간이 측정을 왜곡함** → 모델마다 예열 호출 1회를 측정에서 뺀다 (Task 4 Step 1)
2. **노트북이 배터리 모드면 GPU가 느려짐** → 실행 전 전원 연결과 고성능 모드를 확인하고 보고서에 기록한다 (Task 4 Step 1)
3. **16K 컨텍스트에서 KV 캐시가 VRAM을 넘어 CPU로 넘어감** → 실행 중 `/api/ps`의 `size_vram`과 `size`를 기록한다 (Task 4)
4. **Yahoo가 `.KQ` 종목에 빈 데이터를 줌** → 빈 응답도 "데이터 없음"으로 기록하고 실패로 숨기지 않는다 (Task 2)
5. **도구 호출 실패가 예외 없이 엉뚱한 텍스트로 끝남** → 실행 결과에서 애널리스트 보고서가 비었거나 도구 결과 없이 끝난 경우를 "도구 호출 실패"로 집계한다 (Task 3)

---

### Task 1: 실험 환경 구성

**Files:**
- Create: `spikes/tradingagents-local-llm/pyproject.toml`, `spikes/tradingagents-local-llm/README.md`, `spikes/tradingagents-local-llm/check_env.py`

**Interfaces:**
- Produces: `uv run python check_env.py`. Ollama 연결, 모델 존재, TradingAgents import, `DEFAULT_CONFIG` 키 목록을 출력한다

- [ ] **Step 1: 사용자에게 Windows Ollama 설치를 요청한다.** ollama.com/download의 Windows 설치 파일을 쓴다(관리자 권한 불필요). 설치되면 WSL에서 `curl -s localhost:11434/api/version`이 버전 JSON을 반환해야 한다. 응답이 없으면 Windows에서 환경변수 `OLLAMA_HOST=0.0.0.0`을 설정하고 Ollama를 재시작하도록 안내한다
- [ ] **Step 2: uv를 설치한다.** `curl -LsSf https://astral.sh/uv/install.sh | sh`. 확인은 `uv --version`. `docs/TOOLING.md`의 "개발 도구"에 기록한다
- [ ] **Step 3: 모델을 받는다.** `curl -s localhost:11434/api/pull -d '{"model":"qwen3.5:4b"}'`와 `qwen3.5:9b`. 확인: `curl -s localhost:11434/api/tags`에 두 모델이 보인다
- [ ] **Step 4: `pyproject.toml`을 만든다.** `requires-python = "==3.13.*"`, 의존성 `tradingagents @ git+https://github.com/TauricResearch/TradingAgents@v0.7.1`, `httpx`, `python-dotenv`. 먼저 `git ls-remote --tags https://github.com/TauricResearch/TradingAgents | grep v0.7.1`로 태그가 있는지 확인한다. 실행: `uv python install 3.13 && uv sync`
- [ ] **Step 5: `check_env.py`를 쓰고 실행한다.** 출력에 ① Ollama 버전, ② 두 모델 태그, ③ `tradingagents` import 성공, ④ `DEFAULT_CONFIG`의 전체 키와 값이 나와야 한다. ④에서 LLM 제공자, 등급별 모델, 백엔드 URL, 체크포인트, 토론 라운드, **출력 언어** 관련 키의 실제 이름을 찾아 README에 적는다(이것이 S3 근거). README 기준 예상 키 이름은 `llm_provider`, `deep_think_llm`, `quick_think_llm`, `deep_think_provider`, `quick_think_provider`, `*_backend_url`, `checkpoint_enabled`, `max_debate_rounds`, `max_risk_discuss_rounds`
- [ ] **Step 6: 커밋하고 push한다**

```bash
git add spikes/tradingagents-local-llm docs/TOOLING.md
git commit -m "spike: 실험 환경 구성 (uv, TradingAgents v0.7.1, Ollama 연결 확인)"
git push -u origin spike/tradingagents-local-llm
```

### Task 2: S2 국내 종목 데이터 품질

**Files:**
- Create: `spikes/tradingagents-local-llm/inspect_data.py`

**Interfaces:**
- Consumes: Task 1의 환경
- Produces: `runs/data-<ticker>.json`, 데이터 종류별 `{rows | chars, sample, empty: bool, error: str|null}`

- [ ] **Step 1: `inspect_data.py <ticker> <date>`를 쓴다.** LLM 없이 TradingAgents의 데이터 함수(`tradingagents.dataflows` 아래, Task 1 Step 5에서 확인한 실제 이름)를 직접 호출해 가격(OHLCV 1년), 기술 지표, 재무제표, 뉴스, 소셜을 받는다. 각 결과의 크기와 앞부분 300자를 저장한다
- [ ] **Step 2: 세 종목으로 실행한다.** 확인: `runs/` 아래 JSON 3개가 생기고, 각 데이터 종류의 `empty`와 `error`가 채워져 있다
- [ ] **Step 3: `REPORT.md`의 S2 섹션을 쓴다.** 종목 × 데이터 종류 표(✅ 충분 / ⚠️ 부족 / ❌ 없음)를 만들고, 국내 종목에서 끌 애널리스트를 정한다
- [ ] **Step 4: 커밋하고 push한다**

### Task 3: 실행 하네스 (S3, S4, S6)

**Files:**
- Create: `spikes/tradingagents-local-llm/run_spike.py`, `spikes/tradingagents-local-llm/presets.py`

**Interfaces:**
- Produces:
  - `presets.py`: `build_config(preset: str) -> dict`. `preset`은 `local-4b`, `local-9b`, `mixed`, `cloud` 중 하나
  - `run_spike.py --ticker T --date D --preset P [--checkpoint]`: `runs/run-<ts>-<T>-<P>.json`을 출력한다. 필드는 `{preset, models, ticker, date, wall_sec, node_events: [{node, t_start, t_end}], decision_raw, decision_parsed, report_lengths: {agent: chars}, empty_reports: [agent], exceptions: [str], output_language_guess, tokens: {in, out} | null}`

- [ ] **Step 1: `build_config`를 구현한다.** `DEFAULT_CONFIG`를 복사하고 Task 1에서 찾은 실제 키 이름으로 설정한다.
  - local: 두 등급 모두 Ollama에 `/v1` 백엔드, `num_ctx` 16384 (설정 경로가 없으면 Ollama 모델 옵션으로 지정하고 방법을 README에 기록)
  - mixed: quick은 Ollama `qwen3.5:4b`, deep은 클라우드
  - cloud: 두 등급 모두 `.env`에 있는 제공자
- [ ] **Step 2: `run_spike.py`를 구현한다.** `TradingAgentsGraph(config)`의 그래프를 LangGraph `stream`(또는 v0.7.1이 제공하는 진행 콜백)으로 실행해 노드마다 시작·끝 시각을 남긴다(S6 근거). 최종 `decision`은 원문과 파싱 결과를 모두 저장한다(S4 근거). 보고서 본문의 한글 비율로 `output_language_guess`를 추정한다(S3 근거). 토큰 수는 LangChain 콜백으로 얻을 수 있으면 기록하고, 없으면 `null`로 둔다
- [ ] **Step 3: 시험 실행한다.** `uv run python run_spike.py --ticker AAPL --date <D> --preset local-4b`. 확인: run JSON이 생성되고 `node_events`가 1개 이상, `decision_raw`가 비어 있지 않다
- [ ] **Step 4: `REPORT.md`의 S3, S4, S6 섹션을 쓴다.**
  - S3: 출력 언어 설정이 있는지, 없으면 한국어 요약 단계가 필요하다고 결론
  - S4: 결정값 체계를 실제 값 목록으로 기록
  - S6: 노드 이벤트를 받는 방법을 코드 조각으로 기록
- [ ] **Step 5: 커밋하고 push한다**

### Task 4: S1 로컬 모델 완주 측정

**Files:**
- Create: `spikes/tradingagents-local-llm/vram_probe.py`

**Interfaces:**
- Consumes: `run_spike.py`
- Produces: `vram_probe.py --interval 5 --out runs/vram-<ts>.jsonl`. `/api/ps`를 주기적으로 조회해 `{t, model, size, size_vram}`을 기록한다

- [ ] **Step 1: 측정 조건을 기록한다.** 전원 연결 여부, Windows 전원 모드, `nvidia-smi` 출력을 `REPORT.md` S1의 "측정 조건"에 적는다. 모델마다 예열 호출 1회(`/api/generate`, 짧은 프롬프트)를 하고, 이 호출은 측정에서 뺀다
- [ ] **Step 2: `vram_probe.py`를 쓴다**
- [ ] **Step 3: 4회 실행한다.** `{local-4b, local-9b} × {AAPL, 005930.KS}` 조합이고, 실행 동안 `vram_probe.py`를 함께 돌린다. 1회 실행이 60분을 넘으면 중단하고 "시간 초과"로 기록한다
- [ ] **Step 4: `REPORT.md` S1 표를 쓴다.** 열은 모델, 종목, 완주 여부, 소요 시간, 비어 있는 보고서 수, 예외 수, 최대 `size_vram/size` 비율이다. 결론으로 8GB 등급의 기본 모델(`qwen3.5:4b` 유지 여부)과 기본 프리셋(혼합 유지 / 클라우드로 변경)을 정한다
- [ ] **Step 5: 커밋하고 push한다**

### Task 5: S5 체크포인트로 이어서 실행

- [ ] **Step 1: 중단을 재현한다.** `run_spike.py --ticker AAPL --preset local-4b --checkpoint`를 실행하고, 두 번째 노드 이벤트가 찍히면 프로세스를 종료한다(`timeout`이나 `kill`)
- [ ] **Step 2: 같은 명령을 다시 실행한다.** 확인: 이미 끝난 노드의 `node_events`가 다시 나타나지 않거나, 소요 시간이 처음 실행보다 짧다. 체크포인트 파일 위치(`~/.tradingagents/cache/checkpoints/` 예상)를 기록한다
- [ ] **Step 3: `REPORT.md` S5에 결론을 쓴다.** 이어서 실행되는지, 앱에서 켤 때 필요한 설정이 무엇인지. 커밋하고 push한다

### Task 6: S8 혼합 프리셋

- [ ] **Step 1: 루트 `.env`에 `LLM_*` 키가 하나 이상 있는지 확인한다.** 키 값은 출력하지 않고, 비어 있지 않은지만 본다(`grep -c '^LLM_[A-Z]*_KEY=.\+' .env`). 없으면 S8을 "보류: 키 없음"으로 기록하고 Task 7로 넘어간다
- [ ] **Step 2: 실행한다.** `run_spike.py --ticker 005930.KS --preset mixed`. 확인: 완주하고 `models`에 두 제공자가 기록된다
- [ ] **Step 3: `REPORT.md` S8에 local-4b와 비교한 소요 시간과 토큰 수를 기록한다.** 커밋하고 push한다

### Task 7: S7 Windows PyInstaller 빌드

**Files:**
- Create: `spikes/tradingagents-local-llm/pyinstaller_smoke/smoke_entry.py`, `.github/workflows/spike-pyinstaller.yml`

**Interfaces:**
- Produces: GitHub Actions 워크플로 `spike-pyinstaller`(수동 실행과 이 브랜치 push에서 트리거). 산출물은 `smoke_entry` onedir 폴더 zip

- [ ] **Step 1: `smoke_entry.py`를 쓴다.** `tradingagents`를 import하고, LLM 호출 없이 `TradingAgentsGraph(build_config("local-4b"))`로 그래프 객체를 만든 뒤 `SMOKE OK <노드 수>`를 출력하고 종료 코드 0으로 끝낸다. 생성 단계에서 네트워크가 필요하면 그 사실을 기록하고, 대신 import만 확인한다
- [ ] **Step 2: 워크플로를 쓴다.** `windows-latest`, `astral-sh/setup-uv`, Python 3.13 설치, `uv sync`, `uv run pyinstaller --onedir --name smoke smoke_entry.py` 순서이고 빌드 후 `dist/smoke/smoke.exe` 실행 출력에 `SMOKE OK`가 있는지 확인한다. 실패하면 PyInstaller 경고 로그(`build/smoke/warn-smoke.txt`)를 산출물로 올린다
- [ ] **Step 3: push해서 실행하고 결과를 확인한다.** `gh run watch`로 결과를 본다. 실패하면 누락 모듈을 `--collect-all`이나 `--hidden-import`로 보정하며 최대 5회 반복한다
- [ ] **Step 4: `REPORT.md` S7을 쓴다.** 성공 여부, 필요했던 PyInstaller 옵션, onedir 크기(MB), 시작 시간을 적는다. 5회 안에 실패하면 결론은 "내장 Python 방식으로 전환"이다. 커밋하고 push한다

### Task 8: 결론 반영과 PR

**Files:**
- Modify: `spikes/tradingagents-local-llm/REPORT.md`, `docs/superpowers/specs/2026-11-02-vater-mvp-design.md`(3-3 카탈로그 표, 5장, 13장 결과 열), `docs/ARCHITECTURE.md`(PR 열)

- [ ] **Step 1: `REPORT.md` 맨 위에 "결론 요약"을 쓴다.** S1~S8 각각 한 줄, 그리고 스펙 변경 목록
- [ ] **Step 2: 스펙에 반영한다.** 13장 표에 "결과" 열을 추가하고, 결과에 따라 3-3 카탈로그 기본값과 5장의 한국어 처리·결정값·진행 스트리밍 문장을 확정한다
- [ ] **Step 3: PR을 만든다.**

```bash
gh pr create --base main --head spike/tradingagents-local-llm --label area:spike \
  --title "spike: TradingAgents + 로컬 LLM 검증 실험 (S1~S8)" --body-file <템플릿 4개 항목을 채운 파일>
```

- [ ] **Step 4: CI를 통과하면 `gh pr merge --merge`로 합친다(브랜치 유지).** main에 `stage-2-spike` 태그를 붙여 push한다
