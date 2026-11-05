import { useState } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useApi } from '../../api/services';
import { useResource } from '../../api/useResource';
import type {
  AlertKindInfo,
  AlertRule,
  BrokerOut,
  ConnectionOut,
  HoldingOut,
  MarketCode,
  WatchItem,
  WatchResult,
} from '../../api/types';
import { Banner, Button, Card } from '../../design-system';
import { navigate } from '../../app/router';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { marketLabel } from '../common/quotes';
import { ScreenHeader } from '../common/ScreenHeader';
import common from '../common/screen.module.css';
import { symbolKey, SymbolSearch } from '../common/SymbolSearch';
import { AlertHistory } from './AlertHistory';
import styles from './alerts.module.css';
import { ManualDialog } from '../holdings/ManualForm';
import { UploadButtons, UploadDialog } from '../holdings/UploadDialog';
import { WatchPanel } from './WatchPanel';

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
  const brokers = useResource<BrokerOut[]>('/brokers');
  const connections = useResource<ConnectionOut[]>('/connections');
  const holdings = useResource<HoldingOut[]>('/holdings');
  // 업로드 확인 창: brokerId null은 연결한 증권사 모두
  const [uploading, setUploading] = useState<{ brokerId: string | null } | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addBusy, setAddBusy] = useState<string | null>(null);
  const [addError, setAddError] = useState<ApiError | null>(null);

  const focusKey = focus ? symbolKey(focus) : null;
  const items = watch.data;
  const watchedKeys = new Set((items ?? []).map(symbolKey));
  const focusMissing = Boolean(focus && items && !watchedKeys.has(focusKey ?? ''));

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

  function uploadDone(result: WatchResult) {
    setUploading(null);
    setUploaded(
      `${result.added}종목을 감시 종목에 올렸습니다.${result.skipped > 0 ? ` ${result.skipped}종목은 이미 있거나 찾지 못해 건너뛰었습니다.` : ''}${result.rules > 0 ? ` 알림 규칙 ${result.rules}개를 만들었습니다.` : ''}`,
    );
    watch.reload();
    rules.reload();
    holdings.reload();
  }

  function removed(item: WatchItem) {
    watch.mutate((list) => list?.filter((w) => w.id !== item.id));
    rules.mutate((list) => list?.filter((r) => r.watchlist_id !== item.id));
    navigate({ name: 'alerts' });
  }

  return (
    <>
      <ScreenHeader
        title="감시·알림"
        lede="종목을 펼쳐 알림 규칙을 만듭니다. 조건을 새로 만족할 때만 알리고, 같은 규칙은 하루에 한 번만 알립니다."
        end={
          <Button variant="primary" onClick={() => setAdding(true)}>
            종목 추가
          </Button>
        }
      />
      <div className={common.twoUp}>
        <div className={common.twoUpGrid}>
          <Card
            title="감시 종목"
            description={items && items.length > 0 ? `${items.length}종목` : undefined}
          >
            <UploadButtons
              brokers={brokers.data ?? []}
              connections={connections.data ?? []}
              holdings={holdings.data ?? []}
              watchedKeys={watchedKeys}
              onOpen={(brokerId) => {
                setUploaded(null);
                setUploading({ brokerId });
              }}
            >
              <Button onClick={() => setManual(true)}>보유 종목 직접 추가</Button>
            </UploadButtons>
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
                아직 감시 종목이 없습니다. 종목 추가를 눌러 종목을 찾고, 알림 규칙을 만드세요.
              </p>
            ) : null}
            {items && items.length > 0 ? (
              <ul className={styles.watchList}>
                {items.map((item) => {
                  const key = symbolKey(item);
                  const expanded = key === focusKey;
                  return (
                    <WatchPanel
                      key={item.id}
                      item={item}
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
                    />
                  );
                })}
              </ul>
            ) : null}
          </Card>
          {uploading ? (
            <UploadDialog
              brokerId={uploading.brokerId}
              brokers={brokers.data ?? []}
              kinds={kinds.data}
              onClose={() => setUploading(null)}
              onUploaded={uploadDone}
            />
          ) : null}
          {manual ? (
            <ManualDialog
              onClose={() => setManual(false)}
              onChanged={() => {
                holdings.reload();
                connections.reload();
              }}
              onCsvDone={(brokerId) => {
                setManual(false);
                holdings.reload();
                brokers.reload();
                setUploaded(null);
                setUploading({ brokerId });
              }}
            />
          ) : null}
          <AlertHistory watchItems={items} kinds={kinds.data} focusKey={focusKey} />
        </div>
      </div>
    </>
  );
}
