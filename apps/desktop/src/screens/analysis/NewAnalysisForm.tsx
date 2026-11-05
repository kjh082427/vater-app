import { useEffect, useState, type FormEvent } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useApi } from '../../api/services';
import { useResource } from '../../api/useResource';
import type { AnalysisCreate, AnalysisQueued, SymbolOut, WatchItem } from '../../api/types';
import { Button } from '../../design-system';
import { navigate } from '../../app/router';
import { PRESET_LABEL } from '../../app/status';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { Field } from '../common/Field';
import form from '../common/form.module.css';
import { StockName } from '../common/quotes';
import { SymbolSearch } from '../common/SymbolSearch';
import styles from './analysis.module.css';
import { SelectField } from '../common/SelectField';

type Picked = Pick<SymbolOut, 'market' | 'code' | 'name'>;

/** 주소 쿼리(#/analyses?market=&code=&as_of=)로 미리 채울 값. "AI 사용 방식 바꿔 새로 분석"이 쓴다. */
function prefillFromHash(): { market: string; code: string; asOf: string } | null {
  const query = window.location.hash.split('?')[1];
  if (!query) return null;
  const q = new URLSearchParams(query);
  const market = q.get('market');
  const code = q.get('code');
  if ((market !== 'KR' && market !== 'US') || !code) return null;
  return { market, code, asOf: q.get('as_of') ?? '' };
}

/** 새 분석(스펙 9-2): 종목 검색, 기준일(비우면 최근 거래일), 프리셋(비우면 설정값). */
export function NewAnalysisForm() {
  const api = useApi();
  const settings = useResource<Record<string, unknown>>('/settings');
  const watch = useResource<WatchItem[]>('/watchlist');
  const [prefill] = useState(prefillFromHash);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [asOf, setAsOf] = useState(prefill?.asOf ?? '');
  const [preset, setPreset] = useState('');
  const [missingSymbol, setMissingSymbol] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // 미리 채울 종목의 이름을 찾는다(못 찾으면 코드만)
  useEffect(() => {
    if (!prefill) return;
    let alive = true;
    api
      .request<SymbolOut[]>('/symbols/search', { query: { q: prefill.code } })
      .catch(() => [] as SymbolOut[])
      .then((found) => {
        if (!alive) return;
        const hit = found.find((s) => s.market === prefill.market && s.code === prefill.code);
        setPicked(hit ?? { market: prefill.market, code: prefill.code, name: prefill.code });
      });
    return () => {
      alive = false;
    };
  }, [api, prefill]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!picked) {
      setMissingSymbol(true);
      return;
    }
    const body: AnalysisCreate = {
      market: picked.market === 'US' ? 'US' : 'KR',
      code: picked.code,
    };
    if (asOf) body.as_of = asOf;
    if (preset === 'cloud' || preset === 'local' || preset === 'mixed') body.preset = preset;
    setBusy(true);
    setError(null);
    try {
      const out = await api.request<AnalysisQueued>('/analyses', { method: 'POST', body });
      navigate({ name: 'analysis', id: out.id });
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(false);
    }
  }

  const current = settings.data?.['llm.preset'];
  const currentLabel = typeof current === 'string' ? PRESET_LABEL[current] : undefined;
  return (
    <form aria-label="새 분석" className={styles.form} onSubmit={submit} noValidate>
      {picked ? (
        <div className={styles.picked}>
          <StockName market={picked.market} name={picked.name} code={picked.code} />
          <Button size="sm" variant="quiet" onClick={() => setPicked(null)}>
            다른 종목
          </Button>
        </div>
      ) : (
        <div className={styles.search}>
          {/* 앱 안에서만 보여 주는 목록이다. AI로는 고른 한 종목만 간다(스펙 19장). 보유 여부는 표시하지 않는다 */}
          {watch.data && watch.data.length > 0 ? (
            <div className={styles.watchPick}>
              <span className={form.legend}>감시 종목에서 고르기</span>
              <ul className={styles.watchChoices} aria-label="감시 종목에서 고르기">
                {watch.data.map((w) => (
                  <li key={w.id}>
                    <button
                      type="button"
                      className={styles.watchChoice}
                      aria-label={`감시 종목 ${w.name}`}
                      onClick={() => {
                        setPicked({ market: w.market, code: w.code, name: w.name });
                        setMissingSymbol(false);
                      }}
                    >
                      <b>{w.name}</b>
                      <span className="vt-num">{w.code}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <SymbolSearch
            actionLabel="선택"
            onPick={(s) => {
              setPicked(s);
              setMissingSymbol(false);
            }}
          />
        </div>
      )}
      {missingSymbol && !picked ? (
        <span className={form.error}>분석할 종목을 먼저 고르세요.</span>
      ) : null}
      <div className={styles.formRow}>
        <Field label="기준일" hint="비워 두면 최근 거래일로 분석합니다.">
          {(control) => (
            <input
              {...control}
              className={`${form.control} vt-num`}
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
            />
          )}
        </Field>
        <SelectField
          label="AI 사용 방식"
          hint="AI 엔진 조합입니다. 설정에서 기본값을 바꿉니다."
          value={preset}
          onChange={setPreset}
          options={[
            { value: '', label: currentLabel ? `설정값(${currentLabel})` : '설정값' },
            { value: 'cloud', label: '클라우드' },
            { value: 'local', label: '로컬' },
            { value: 'mixed', label: '혼합' },
          ]}
        />
      </div>
      {error ? <ApiErrorNotice error={error} /> : null}
      <div>
        <Button type="submit" variant="primary" busy={busy}>
          {busy ? '시작하는 중…' : '분석 시작'}
        </Button>
      </div>
    </form>
  );
}
