import type { ButtonHTMLAttributes, ReactElement } from 'react';
import { cx } from '../internal/cx';
import styles from './Button.module.css';
import type { IconProps } from './Icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * - primary: 먹으로 채운 주 버튼. 한 화면에 하나만(예: "새 분석").
   * - secondary: 테두리 버튼(기본).
   * - quiet: 밑줄 글자 버튼. 구역 머리의 작은 행동(예: "종목 추가", "전체 보기").
   */
  variant?: 'primary' | 'secondary' | 'quiet';
  size?: 'md' | 'sm';
  /** 글자 앞 아이콘. 장식이므로 이름에 들어가지 않는다. */
  icon?: ReactElement<IconProps>;
  /** 진행 중. 누를 수 없고 aria-busy를 켠다. 글자도 "확인 중…"처럼 바꿔 준다. */
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
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx(styles.button, className)}
      data-variant={variant}
      data-size={size}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {icon}
      {children}
    </button>
  );
}
