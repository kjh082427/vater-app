import { useState } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useApi } from '../../api/services';
import type { Resource } from '../../api/useResource';
import type { HoldingOut, WatchResult } from '../../api/types';
import { Button, Dialog } from '../../design-system';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import common from '../common/screen.module.css';
import { uploadRows } from '../holdings/model';
import { PickList, watchTargets } from '../holdings/UploadDialog';

/**
 * [보유 종목에서 불러오기](v0.2.2 22-5): 이미 올린 보유 종목 가운데 감시 중이 아닌 것만 보인다.
 * 증권사에서 새로 받지 않고, 알림 규칙도 없다. 처음에는 모두 해제. 체크한 종목의 market·code만 보낸다
 * (체크하지 않은 종목을 seen으로 보내지 않는다: "새 종목" 표시는 올리기 창의 일이다).
 */
export function ImportHeldDialog({
  holdings,
  watchedKeys,
  onClose,
  onDone,
}: {
  holdings: Resource<HoldingOut[]>;
  watchedKeys: ReadonlySet<string>;
  onClose: () => void;
  onDone: (result: WatchResult) => void;
}) {
  const api = useApi();
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const rows = uploadRows(holdings.data ?? [], watchedKeys).filter(
    (r) => r.supported && !r.watched,
  );
  const selected = rows.filter((r) => checked.has(r.key));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.request<WatchResult>('/holdings/watch', {
        method: 'POST',
        body: { items: watchTargets(selected) },
      });
      onDone(result);
    } catch (e) {
      setError(toApiError(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title="보유 종목에서 불러오기"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={selected.length === 0}
            onClick={() => void submit()}
          >
            {selected.length > 0 ? `감시 종목에 넣기 (${selected.length})` : '감시 종목에 넣기'}
          </Button>
        </>
      }
    >
      {holdings.error ? (
        <ApiErrorNotice
          error={holdings.error}
          title="보유 내역을 불러오지 못했습니다"
          onRetry={holdings.reload}
        />
      ) : !holdings.data ? (
        <p className={common.empty}>보유 내역을 불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className={common.empty}>
          불러올 보유 종목이 없습니다. 보유 종목은 보유 종목 탭에서 올리거나 직접 추가합니다.
        </p>
      ) : (
        <PickList rows={rows} checked={checked} onChange={setChecked} />
      )}
      {error ? <ApiErrorNotice error={error} title="넣지 못했습니다" /> : null}
    </Dialog>
  );
}
