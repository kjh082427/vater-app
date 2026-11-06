import { useState } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useApi, useEvent } from '../../api/services';
import type { BriefingDetail, ErrorBody } from '../../api/types';
import { Banner, Button } from '../../design-system';
import common from '../common/screen.module.css';
import styles from './briefing.module.css';

/*
 * AI에 닿는 요청(해석 다시 만들기)을 보내는 부품. 보유 내역·내 자산을 모르도록 상세 화면에서 떼어 두고
 * privacy.test.ts가 지킨다(스펙 8-1).
 */

/** AI 해석이 없는 이유(분석 화면 20장과 같은 문구). */
const INTERPRET_REASON: Record<string, string> = {
  LLM_BUSY: '구글 AI 서버가 혼잡합니다. 잠시 후 자동으로 다시 시도합니다.',
  LLM_RATE_LIMITED: '무료 사용량의 분당 한도에 걸려 잠시 기다립니다.',
  LLM_DAILY_LIMIT: '오늘 무료 사용량을 다 썼습니다. 내일 다시 시도하거나 로컬 AI로 바꿔 주세요.',
  LLM_KEY_INVALID: 'AI 키가 맞지 않습니다. 설정에서 키를 확인해 주세요.',
  LLM_KEY_MISSING: 'AI 키가 없습니다. 설정에서 키를 넣어 주세요.',
  BRIEFING_LLM_FAILED: 'AI 해석을 끝내지 못했습니다. 잠시 뒤 [AI 해석 다시 만들기]를 눌러 주세요.',
};
// 키 문제는 설정 링크도 함께 둔다(키를 고친 뒤 다시 만들 수 있게)
const KEY_CODES = new Set(['LLM_KEY_INVALID', 'LLM_KEY_MISSING']);

/**
 * 해석이 없는 브리핑의 이유와 [AI 해석 다시 만들기](POST /briefings/{id}/interpret, 202).
 * 진행과 결과는 SSE briefing.status로 받는다: 끝나면 상세를 다시 불러오는 것은 화면(BriefingDetailScreen)이 한다.
 * 요청에는 아무것도 싣지 않는다(브리핑 AI 입력 범위는 그대로, 8-1장).
 */
export function InterpretRetry({ b }: { b: BriefingDetail }) {
  const api = useApi();
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<ErrorBody | ApiError | null>(null);
  useEvent('briefing.status', (event) => {
    if (event.id !== b.id && !(event.market === b.market && event.date === b.date)) return;
    if (event.status === 'running') {
      setRunning(true);
      return;
    }
    setRunning(false);
    // AI 실패 이유는 상세를 다시 불러오면 interpret_error로 온다. 그 밖의 실패(다른 브리핑 작업 중 등)는 여기서 보인다
    const error = event.status === 'failed' ? event.error : null;
    setProblem(error && !(error.code in INTERPRET_REASON) ? error : null);
  });

  async function start() {
    setStarting(true);
    setProblem(null);
    // 202보다 SSE 끝 알림이 먼저 올 수 있어 요청 전에 켠다(끝 알림이 끈다)
    setRunning(true);
    try {
      await api.request(`/briefings/${b.id}/interpret`, { method: 'POST' });
    } catch (e) {
      setRunning(false);
      setProblem(toApiError(e));
    } finally {
      setStarting(false);
    }
  }

  const code = b.interpret_error?.code;
  const reason = code ? (INTERPRET_REASON[code] ?? b.interpret_error?.message) : undefined;
  return (
    <div className={styles.interpret}>
      {running ? (
        <Banner tone="info" title="AI 해석을 만드는 중입니다. 끝나면 이 화면이 바뀝니다." />
      ) : (
        <>
          {reason ? <Banner tone="caution" title={reason} /> : null}
          {problem ? (
            <Banner tone="caution" title={problem.message}>
              {problem.hint ?? undefined}
            </Banner>
          ) : null}
        </>
      )}
      <div className={styles.interpretActions}>
        <Button busy={running || starting} onClick={() => void start()}>
          AI 해석 다시 만들기
        </Button>
        {code && KEY_CODES.has(code) && !running ? (
          <a className={common.textLink} href="#/settings">
            설정 열기
          </a>
        ) : null}
      </div>
    </div>
  );
}
