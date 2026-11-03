import type { ComponentType } from 'react';
import type { MetricId, PanelType } from '../layout/mins';
import type { Size } from '../layout/types';

export interface PanelProps {
  options: Record<string, unknown>;
  /** 칸(카드 바깥) 크기. 칸 높이에 맞춰 줄 수를 정하는 내용이 쓴다. */
  size: Size;
}

export interface Choice {
  value: string;
  label: string;
}

export type OptionDef =
  | {
      kind: 'select';
      key: string;
      label: string;
      default: string;
      /** 고를 수 있는 값. 자료에서 오는 목록(최근 분석, 감시 종목)이면 훅이다. */
      useChoices: () => Choice[];
    }
  | { kind: 'metrics'; key: string; label: string; default: MetricId[]; max: number };

export interface PanelDef {
  label: string;
  /** 내용 고르기 목록의 설명 한 줄. */
  description: string;
  /** 칸 머리의 설명 한 줄(옵션에 따라). 없으면 description. */
  describe?: (options: Record<string, unknown>) => string;
  min: Size;
  options?: OptionDef[];
  Component: ComponentType<PanelProps>;
}

export type PanelRegistry = Record<PanelType, PanelDef>;

/** 옵션 값 읽기: 문자열이고 허용 목록에 있으면 그 값, 아니면 기본값. */
export function pick<T extends string>(
  options: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const v = options[key];
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
