import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 디자인 시스템 Select의 버튼. 이름은 "이름표 지금 값"이다(예: "종목 전체 종목"). */
export function selectButton(scope: HTMLElement, label: string): HTMLElement {
  return within(scope).getByRole('button', { name: new RegExp(`^${escape(label)} `) });
}

export async function findSelectButton(scope: HTMLElement, label: string): Promise<HTMLElement> {
  return waitFor(() => selectButton(scope, label));
}

/** Select를 열고 항목을 고른다. */
export async function choose(scope: HTMLElement, label: string, option: string | RegExp) {
  await userEvent.click(await findSelectButton(scope, label));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}
