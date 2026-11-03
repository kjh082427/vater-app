import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import styles from './Dialog.module.css';
import { Icon } from './Icon';

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** 아래 버튼 줄. 보통 [취소] [확인]. 주 버튼은 하나. */
  footer?: ReactNode;
  children: ReactNode;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 모달 대화 상자. 열리면 안의 첫 요소에 초점, Tab·Shift+Tab은 안에서만 돈다.
 * Esc나 닫기 버튼은 onClose를 부른다. 닫히면 초점은 연 요소로 돌아간다.
 * 뒤 바탕을 눌러도 닫지 않는다(편집 중인 내용을 실수로 잃지 않게).
 */
export function Dialog({ open, title, onClose, footer, children }: DialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const node = dialogRef.current;
    if (!open || !node) return;
    const opener = document.activeElement as HTMLElement | null;
    const first = node.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node).focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const focusables = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const head = focusables[0];
      const tail = focusables[focusables.length - 1];
      if (!head || !tail) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    }

    node.addEventListener('keydown', onKeyDown);
    return () => {
      node.removeEventListener('keydown', onKeyDown);
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className={styles.scrim}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.dialog}
      >
        <div className={styles.head}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <Button
            variant="icon"
            aria-label="닫기"
            icon={<Icon name="close" size="sm" />}
            onClick={onClose}
          />
        </div>
        <div className={styles.body}>{children}</div>
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
