import type { ButtonHTMLAttributes, MouseEvent, ReactElement } from 'react';
import { cx } from '../internal/cx';
import styles from './Button.module.css';
import type { IconProps } from './Icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * - primary: 강조색으로 채운 주 버튼. 한 화면에 하나만(예: "새 분석", "저장").
   * - secondary: 테두리 버튼(기본).
   * - quiet: 강조색 글자의 링크 모양 버튼. 카드 머리·바닥의 작은 행동(예: "종목 추가", "브리핑 읽기").
   * - icon: 아이콘만 있는 28px 버튼(칸 머리의 ⋯, 대화 상자 닫기). 이름은 aria-label로 준다.
   */
  variant?: 'primary' | 'secondary' | 'quiet' | 'icon';
  size?: 'md' | 'sm';
  /** 글자 앞 아이콘. 장식이므로 이름에 들어가지 않는다. */
  icon?: ReactElement<IconProps>;
  /** 진행 중. 포커스는 그대로 두고 누름만 막는다(aria-busy, aria-disabled). 글자도 "확인 중…"처럼 바꿔 준다. */
  busy?: boolean;
}

/**
 * 버튼. 주문·매매처럼 읽히는 행동에는 쓰지 않는다(Vater는 주문 기능이 없다).
 * 포커스 링은 base.css의 2px 먹선이다.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  busy = false,
  disabled,
  type = 'button',
  className,
  children,
  onClick,
  ...rest
}: ButtonProps) {
  // busy는 disabled를 쓰지 않는다: 포커스를 잃으면 키보드 사용자의 자리가 처음으로 돌아간다.
  function guardedClick(event: MouseEvent<HTMLButtonElement>) {
    if (busy) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <button
      {...rest}
      type={type}
      className={cx(styles.button, className)}
      data-variant={variant}
      data-size={size}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={guardedClick}
    >
      {icon}
      {children}
    </button>
  );
}
