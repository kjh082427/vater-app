import type { ApiError } from '../../api/errors';
import { Button, Dialog } from '../../design-system';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import common from '../common/screen.module.css';

/** 분석 지우기 확인 창(21장). 목록(여러 건)과 상세(1건)가 같이 쓴다. */
export function DeleteAnalysisDialog({
  count,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  count: number;
  busy: boolean;
  error: ApiError | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      title={`분석 ${count}건을 지울까요?`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" busy={busy} onClick={onConfirm}>
            지우기
          </Button>
        </>
      }
    >
      <p className={common.meta}>보고서와 중간 저장분도 함께 지웁니다. 되돌릴 수 없습니다.</p>
      {error ? <ApiErrorNotice error={error} /> : null}
    </Dialog>
  );
}

/** 지워진(또는 지워진 줄 몰랐던) 분석을 가리킬 때 보이는 말. */
export const DELETED_ANALYSIS = '지워진 분석입니다';
