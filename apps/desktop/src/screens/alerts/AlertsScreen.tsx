import { useState } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useApi } from '../../api/services';
import { useResource } from '../../api/useResource';
import type {
  AlertKindInfo,
  AlertRule,
  BrokerOut,
  HoldingOut,
  MarketCode,
  WatchItem,
  WatchResult,
} from '../../api/types';
import { Banner, Button, Card, Dialog } from '../../design-system';
import { navigate } from '../../app/router';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { marketLabel } from '../common/quotes';
import { brokerInfo } from '../common/brokers';
import { ScreenHeader } from '../common/ScreenHeader';
import common from '../common/screen.module.css';
import { symbolKey, SymbolSearch } from '../common/SymbolSearch';
import { AlertHistory } from './AlertHistory';
import styles from './alerts.module.css';
import { uploadMessage } from '../holdings/UploadDialog';
import { ImportHeldDialog } from './ImportHeldDialog';
import { WatchPanel, type HeldBroker } from './WatchPanel';

export interface AlertsScreenProps {
  /** #/symbols/:market/:code로 열었으면 그 종목(펼친 상태). */
  focus: { market: MarketCode; code: string } | null;
}

/** 감시·알림(스펙 9-2): 감시 종목 추가·삭제, 종목별 규칙과 편집기, 알림 이력. */
export function AlertsScreen({ focus }: AlertsScreenProps) {
  const api = useApi();
  const watch = useResource<WatchItem[]>('/watchlist');
  const rules = useResource<AlertRule[]>('/alerts/rules');
  const kinds = useResource<AlertKindInfo[]>('/alerts/kinds');
  // 보유 여부와 증권사는 화면 표시에만 쓴다(AI로는 보내지 않는다, 스펙 8-1)
  const holdings = useResource<HoldingOut[]>('/holdings');
  const brokers = useResource<BrokerOut[]>('/brokers');
  // [보유 종목 직접 추가]는 보유 종목 탭에만 둔다(v0.2.2 22-5). 여기서는 올린 보유 종목을 불러오기만 한다
  const [importing, setImporting] = useState(false);
  // [새로고침] 신호: 자기 자료를 가진 부품(알림 이력, 펼친 종목의 그래프·내 보유)이 받아 다시 불러온다
  const [refreshKey, setRefreshKey] = useState(0);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addBusy, setAddBusy] = useState<string | null>(null);
  const [addError, setAddError] = useState<ApiError | null>(null);
  // 한꺼번에 빼기(v0.2.2 22-3): 일괄 API가 없어 DELETE /watchlist/{id}를 한꺼번에 부른다
  const [checkedIds, setCheckedIds] = useState<number[]>([]);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkFailed, setBulkFailed] = useState<{ id: number; name: string; error: ApiError }[]>([]);

  const focusKey = focus ? symbolKey(focus) : null;
  const items = watch.data;
  // 체크와 실패 안내는 지금 목록에 있는 종목만 본다(새로고침·불러오기·SSE 뒤에도 수가 실제와 맞게)
  const present = new Set((items ?? []).map((w) => w.id));
  const selected = checkedIds.filter((id) => present.has(id));
  const failedNow = bulkFailed.filter((f) => present.has(f.id));
  const watchedKeys = new Set((items ?? []).map(symbolKey));
  const focusMissing = Boolean(focus && items && !watchedKeys.has(focusKey ?? ''));
  // 종목 키 → 그 종목을 가진 증권사들(같은 증권사는 한 번만)
  const heldBy = new Map<string, HeldBroker[]>();
  for (const h of holdings.data ?? []) {
    if (h.market === null || Number(h.quantity) <= 0) continue;
    const key = `${h.market}:${h.code}`;
    const list = heldBy.get(key) ?? [];
    if (!list.some((b) => b.id === h.broker_id)) list.push(brokerInfo(brokers.data, h.broker_id));
    heldBy.set(key, list);
  }
  const heldKeys = new Set(heldBy.keys());
  const held = (items ?? []).filter((w) => heldKeys.has(symbolKey(w)));
  // 보유한 종목이 하나라도 있을 때만 나눈다
  const groups =
    held.length > 0
      ? [
          { label: '보유 중', aria: '보유 중인 감시 종목', list: held },
          {
            label: '보유하지 않음',
            aria: '보유하지 않은 감시 종목',
            list: (items ?? []).filter((w) => !heldKeys.has(symbolKey(w))),
          },
        ].filter((g) => g.list.length > 0)
      : [{ label: null, aria: '감시 종목', list: items ?? [] }];

  async function add(market: string, code: string) {
    const key = `${market}:${code}`;
    setAddBusy(key);
    setAddError(null);
    try {
      const item = await api.request<WatchItem>('/watchlist', {
        method: 'POST',
        body: { market, code },
      });
      watch.mutate((list) => [...(list ?? []), item]);
      setAdding(false);
      navigate({ name: 'symbol', market: item.market === 'US' ? 'US' : 'KR', code: item.code });
    } catch (e) {
      setAddError(toApiError(e));
    } finally {
      setAddBusy(null);
    }
  }

  function importDone(result: WatchResult) {
    setImporting(false);
    setUploaded(uploadMessage(result));
    watch.reload();
  }

  // [새로고침](v0.2.2 22-6): 목록과 시세만 다시 받는다. 증권사(/holdings/sync)는 부르지 않는다
  function reloadAll() {
    for (const r of [watch, rules, kinds, holdings, brokers]) r.reload();
    setRefreshKey((n) => n + 1);
    setBulkFailed([]);
  }

  async function removeSelected() {
    setBulkBusy(true);
    const targets = (items ?? []).filter((w) => selected.includes(w.id));
    const results = await Promise.allSettled(
      targets.map((w) => api.request(`/watchlist/${w.id}`, { method: 'DELETE' })),
    );
    const done: number[] = [];
    const failed: { id: number; name: string; error: ApiError }[] = [];
    results.forEach((r, i) => {
      const w = targets[i] as WatchItem;
      const error = r.status === 'rejected' ? toApiError(r.reason) : null;
      // 이미 없는 종목(404)은 뺀 것으로 본다
      if (!error || error.status === 404 || error.code === 'WATCHLIST_NOT_FOUND') done.push(w.id);
      else failed.push({ id: w.id, name: w.name, error });
    });
    watch.mutate((list) => list?.filter((w) => !done.includes(w.id)));
    rules.mutate((list) => list?.filter((r) => !done.includes(r.watchlist_id)));
    setCheckedIds((prev) => prev.filter((id) => !done.includes(id)));
    setBulkFailed(failed);
    setBulkBusy(false);
    setConfirmBulk(false);
    if (focus && targets.some((w) => done.includes(w.id) && symbolKey(w) === focusKey)) {
      navigate({ name: 'alerts' });
    }
  }

  const selectedRules = (rules.data ?? []).filter((r) => selected.includes(r.watchlist_id)).length;

  function removed(item: WatchItem) {
    setCheckedIds((prev) => prev.filter((id) => id !== item.id));
    setBulkFailed([]);
    watch.mutate((list) => list?.filter((w) => w.id !== item.id));
    rules.mutate((list) => list?.filter((r) => r.watchlist_id !== item.id));
    navigate({ name: 'alerts' });
  }

  return (
    <>
      <ScreenHeader
        title="감시·알림"
        lede="종목을 펼쳐 알림 규칙을 만듭니다. 조건을 새로 만족할 때만 알리고, 같은 규칙은 하루에 한 번만 알립니다."
        end={<Button onClick={reloadAll}>새로고침</Button>}
      />
      <div className={common.twoUp}>
        <div className={common.twoUpGrid}>
          <Card
            title="감시 종목"
            description={items && items.length > 0 ? `${items.length}종목` : undefined}
          >
            <div className={styles.addBar}>
              <Button variant="primary" onClick={() => setAdding(true)}>
                종목 검색으로 추가
              </Button>
              <Button
                onClick={() => {
                  setUploaded(null);
                  setImporting(true);
                }}
              >
                보유 종목에서 불러오기
              </Button>
              <span className={common.meta}>
                증권사 연결과 올리기는 <a href="#/holdings">보유 종목</a> 탭에서 합니다.
              </span>
            </div>
            {uploaded ? (
              <p role="status" className={common.meta}>
                {uploaded}
              </p>
            ) : null}
            {adding ? (
              <div className={styles.editor}>
                <SymbolSearch
                  actionLabel="추가"
                  focusOnMount
                  marked={{ keys: watchedKeys, label: '감시 중' }}
                  busyKey={addBusy}
                  onPick={(s) => add(s.market, s.code)}
                />
                {addError ? <ApiErrorNotice error={addError} /> : null}
                <div>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => {
                      setAdding(false);
                      setAddError(null);
                    }}
                  >
                    닫기
                  </Button>
                </div>
              </div>
            ) : null}
            {focus && focusMissing ? (
              <Banner
                tone="info"
                title={`이 종목(${marketLabel(focus.market)} ${focus.code})은 감시 목록에 없습니다.`}
                action={
                  <Button
                    size="sm"
                    busy={addBusy === focusKey}
                    onClick={() => add(focus.market, focus.code)}
                  >
                    감시 종목에 추가
                  </Button>
                }
              />
            ) : null}
            {!adding && addError ? <ApiErrorNotice error={addError} /> : null}
            {selected.length > 0 ? (
              <div className={styles.addBar}>
                <span className={common.meta}>{`${selected.length}종목 선택`}</span>
                <Button onClick={() => setConfirmBulk(true)}>선택한 종목 빼기</Button>
              </div>
            ) : null}
            {failedNow.length > 0 ? (
              <Banner tone="caution" title={`${failedNow.length}종목은 빼지 못했습니다.`}>
                {failedNow.map((f) => `${f.name}: ${f.error.message}`).join(' ')}
              </Banner>
            ) : null}
            {watch.error ? (
              <ApiErrorNotice
                error={watch.error}
                title="감시 종목을 불러오지 못했습니다"
                onRetry={watch.reload}
              />
            ) : null}
            {rules.error ? (
              <ApiErrorNotice
                error={rules.error}
                title="알림 규칙을 불러오지 못했습니다"
                onRetry={rules.reload}
              />
            ) : null}
            {kinds.error ? (
              <ApiErrorNotice
                error={kinds.error}
                title="알림 종류를 불러오지 못했습니다"
                onRetry={kinds.reload}
              />
            ) : null}
            {items && items.length === 0 ? (
              <p className={common.empty}>
                아직 감시 종목이 없습니다. 종목 검색으로 추가를 눌러 종목을 찾고, 알림 규칙을
                만드세요.
              </p>
            ) : null}
            {groups.map((group) =>
              group.list.length > 0 ? (
                <div key={group.aria} className={styles.watchGroup}>
                  {group.label ? (
                    <p
                      className={styles.groupLabel}
                    >{`${group.label} · ${group.list.length}종목`}</p>
                  ) : null}
                  <ul
                    className={styles.watchList}
                    aria-label={group.label ? group.aria : undefined}
                  >
                    {group.list.map((item) => {
                      const key = symbolKey(item);
                      const expanded = key === focusKey;
                      return (
                        <WatchPanel
                          key={item.id}
                          item={item}
                          heldBrokers={heldBy.get(key)}
                          rules={(rules.data ?? []).filter((r) => r.watchlist_id === item.id)}
                          kinds={kinds.data}
                          expanded={expanded}
                          onToggle={() =>
                            navigate(
                              expanded
                                ? { name: 'alerts' }
                                : {
                                    name: 'symbol',
                                    market: item.market === 'US' ? 'US' : 'KR',
                                    code: item.code,
                                  },
                            )
                          }
                          onRulesChanged={rules.reload}
                          onRuleUpdated={(rule) =>
                            rules.mutate((list) => list?.map((r) => (r.id === rule.id ? rule : r)))
                          }
                          onRemoved={() => removed(item)}
                          refreshKey={refreshKey}
                          selected={selected.includes(item.id)}
                          onSelect={(on) =>
                            setCheckedIds((prev) =>
                              on ? [...prev, item.id] : prev.filter((id) => id !== item.id),
                            )
                          }
                        />
                      );
                    })}
                  </ul>
                </div>
              ) : null,
            )}
          </Card>
          {importing ? (
            <ImportHeldDialog
              holdings={holdings}
              watchedKeys={watchedKeys}
              onClose={() => setImporting(false)}
              onDone={importDone}
            />
          ) : null}
          {confirmBulk ? (
            <Dialog
              open
              title={`감시 종목 ${selected.length}개를 뺄까요?`}
              onClose={() => setConfirmBulk(false)}
              footer={
                <>
                  <Button onClick={() => setConfirmBulk(false)}>취소</Button>
                  <Button variant="primary" busy={bulkBusy} onClick={() => void removeSelected()}>
                    빼기
                  </Button>
                </>
              }
            >
              <p className={common.meta}>
                {selectedRules > 0
                  ? `알림 규칙 ${selectedRules}개도 함께 지워집니다.`
                  : '보유 내역은 그대로 둡니다.'}
              </p>
            </Dialog>
          ) : null}
          <AlertHistory
            refreshKey={refreshKey}
            watchItems={items}
            kinds={kinds.data}
            focusKey={focusKey}
          />
        </div>
      </div>
    </>
  );
}
