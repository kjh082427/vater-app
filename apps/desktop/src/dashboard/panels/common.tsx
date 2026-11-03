/** 칸 내용 공통 조각: 오류(사이드카 문구 그대로 + [다시 시도]), 빈 상태 한 줄. */
import type { ReactNode } from 'react';
import type { ApiError } from '../../api/errors';
import { ApiErrorNotice } from '../../screens/common/ApiErrorNotice';
import styles from './panels.module.css';

export function PanelError({
  error,
  title,
  onRetry,
}: {
  error: ApiError;
  title: string;
  onRetry: () => void;
}) {
  return <ApiErrorNotice error={error} title={title} onRetry={onRetry} />;
}

export function PanelEmpty({ children }: { children: ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}

export { styles };
