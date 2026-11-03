/**
 * 칸 1개의 틀: 카드 머리(제목, 설명 한 줄, ⋯ 메뉴: 내용 바꾸기·새로 고침)와 오류 경계.
 * 내용이 그리다 예외를 던지면 그 칸에만 안내와 [다시 시도]를 보인다(성공 기준 3).
 */
import { Component, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import { toApiError } from '../api/errors';
import { Button, Card, Icon, Menu } from '../design-system';
import { ApiErrorNotice } from '../screens/common/ApiErrorNotice';
import type { PanelDoc, Size } from './layout/types';
import { panelDef } from './panels/registry';
import { PanelEmpty } from './panels/common';
import { RefreshContext, type RefreshRegistry } from './shared';
import styles from './dashboard.module.css';

interface BoundaryProps {
  onRetry: () => void;
  children: ReactNode;
}

class PanelBoundary extends Component<BoundaryProps, { error: unknown }> {
  override state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    // 개발자 도구에만 남긴다(사용자 화면에는 칸 안내)
    console.error('칸을 그리지 못했습니다', error, info.componentStack);
  }

  override render() {
    if (this.state.error === null) return this.props.children;
    return (
      <ApiErrorNotice
        error={toApiError(this.state.error)}
        title="이 칸을 그리지 못했습니다"
        onRetry={() => {
          this.props.onRetry();
          this.setState({ error: null });
        }}
      />
    );
  }
}

export interface PanelFrameProps {
  panel: PanelDoc;
  index: number;
  size: Size;
  /** ⋯ 메뉴·안내의 [내용 바꾸기]. 없으면 그 항목을 보이지 않는다. */
  onChangeContent?: (index: number) => void;
}

function useRegistry(): [RefreshRegistry, () => void] {
  const [reloads] = useState(() => new Set<() => void>());
  const registry = useMemo<RefreshRegistry>(
    () => ({
      add: (fn) => {
        reloads.add(fn);
        return () => reloads.delete(fn);
      },
    }),
    [reloads],
  );
  return [registry, () => reloads.forEach((fn) => fn())];
}

export function PanelFrame({ panel, index, size, onChangeContent }: PanelFrameProps) {
  const def = panelDef(panel.type);
  const [registry, refresh] = useRegistry();
  const n = index + 1;
  const change = onChangeContent ? () => onChangeContent(index) : undefined;
  const changeButton = change ? (
    <Button size="sm" onClick={change}>
      내용 바꾸기
    </Button>
  ) : null;

  if (!def) {
    const empty = panel.type === 'empty';
    const title = empty ? '빈칸' : '지원하지 않는 내용';
    return (
      <Card title={title} aria-label={`칸 ${n}: ${title}`} className={styles.panel}>
        <PanelEmpty>
          {empty ? '이 칸에 보여 줄 내용을 고르세요.' : '이 버전에서 지원하지 않는 내용입니다'}
        </PanelEmpty>
        {changeButton ? <div className={styles.center}>{changeButton}</div> : null}
      </Card>
    );
  }

  const Body = def.Component;
  return (
    <Card
      title={def.label}
      description={def.describe?.(panel.options) ?? def.description}
      aria-label={`칸 ${n}: ${def.label}`}
      className={styles.panel}
      actions={
        <Menu
          trigger={
            <Button variant="icon" aria-label={`칸 ${n} 메뉴`} icon={<Icon name="more" />} />
          }
          items={[
            ...(change ? [{ id: 'change', label: '내용 바꾸기', onSelect: change }] : []),
            { id: 'refresh', label: '새로 고침', onSelect: refresh },
          ]}
        />
      }
    >
      <RefreshContext.Provider value={registry}>
        <PanelBoundary onRetry={refresh}>
          <Body options={panel.options} size={size} />
        </PanelBoundary>
      </RefreshContext.Provider>
    </Card>
  );
}
