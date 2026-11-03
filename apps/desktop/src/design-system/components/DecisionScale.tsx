import { cx } from '../internal/cx';
import styles from './DecisionScale.module.css';

/** 사이드카의 결정 값(`analysis/summary.py`의 Decision)과 같다. */
export type Decision = 'Buy' | 'Overweight' | 'Hold' | 'Underweight' | 'Sell' | 'REVIEW';

export const DECISION_LABEL: Record<Decision, string> = {
  Buy: '매수',
  Overweight: '비중확대',
  Hold: '보유',
  Underweight: '비중축소',
  Sell: '매도',
  REVIEW: '검토 필요',
};

/** 눈금 위치: 왼쪽 매도(1) → 오른쪽 매수(5). 검토 필요는 눈금 밖. */
const POSITION: Record<Decision, number | null> = {
  Sell: 1,
  Underweight: 2,
  Hold: 3,
  Overweight: 4,
  Buy: 5,
  REVIEW: null,
};

type Tone = 'up' | 'down' | 'neutral' | 'caution';

function toneOf(position: number | null): Tone {
  if (position === null) return 'caution';
  if (position > 3) return 'up';
  if (position < 3) return 'down';
  return 'neutral';
}

export interface DecisionScaleProps {
  decision: Decision;
  /** md: 목록·알림 안(기본), lg: 분석 결과 머리. */
  size?: 'md' | 'lg';
  className?: string;
}

/**
 * AI 분석 결정을 5칸 "의견 눈금"으로 보여 준다. 결정이 다섯 단계 중 어디쯤인지 위치로 읽히고,
 * "검토 필요"는 눈금 밖(빈 칸, 황토색)이다. 국내 관례에 따라 매수 쪽은 빨강, 매도 쪽은 파랑.
 */
export function DecisionScale({ decision, size = 'md', className }: DecisionScaleProps) {
  const position = POSITION[decision];
  const label = DECISION_LABEL[decision];
  const spoken =
    position === null
      ? `AI 의견 ${label}: 결론을 5단계 눈금에 놓지 못해 사람이 검토해야 합니다`
      : `AI 의견 ${label}: 매도부터 매수까지 5단계 중 ${position}단계`;
  return (
    <span
      role="img"
      aria-label={spoken}
      className={cx(styles.scale, className)}
      data-decision={decision}
      data-tone={toneOf(position)}
      data-size={size}
    >
      <span className={styles.track}>
        <span className={styles.bar}>
          {[1, 2, 3, 4, 5].map((cell) => (
            <span
              key={cell}
              className={styles.cell}
              data-cell={cell}
              data-active={cell === position ? 'true' : 'false'}
            />
          ))}
        </span>
        {size === 'lg' ? (
          <span className={styles.ends}>
            <span>매도</span>
            <span>매수</span>
          </span>
        ) : null}
      </span>
      <span>{label}</span>
    </span>
  );
}
