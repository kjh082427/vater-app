import type { ApiError } from '../../api/errors';
import { Banner, Button, Icon } from '../../design-system';

export interface ApiErrorNoticeProps {
  error: ApiError;
  /** 무엇을 하다 실패했는지. 예: "감시 종목을 불러오지 못했습니다". 없으면 오류 문구가 제목. */
  title?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

/**
 * 사이드카 오류를 원인(message)과 해결 방법(hint) 그대로 보여 준다(스펙 8장: 실패는 숨기지 않는다).
 * 황토 띠(Banner caution)이고 빨강은 쓰지 않는다.
 */
export function ApiErrorNotice({
  error,
  title,
  onRetry,
  retryLabel = '다시 시도',
}: ApiErrorNoticeProps) {
  const body = [title ? error.message : null, error.hint].filter(Boolean).join(' ');
  return (
    <Banner
      tone="caution"
      title={title ?? error.message}
      action={
        onRetry ? (
          <Button size="sm" icon={<Icon name="refresh" size="sm" />} onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : undefined
      }
    >
      {body || undefined}
    </Banner>
  );
}
