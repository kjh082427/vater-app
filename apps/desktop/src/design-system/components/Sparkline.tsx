import { MISSING, type Direction } from '../format/money';
import { cx } from '../internal/cx';
import styles from './Sparkline.module.css';
import { VisuallyHidden } from './VisuallyHidden';

export interface SparklineProps {
  /** 오래된 것부터 최근 순서의 값. 숫자가 아닌 값은 건너뛴다. */
  values: readonly number[];
  /** 무엇의 선인지. 예: "코스피 최근 30일 종가". direction을 주면 "상승" 같은 말이 뒤에 붙어 읽힌다. */
  label: string;
  /**
   * 색을 정하는 방향. **옆에 놓인 숫자와 같은 자료**여야 한다(브리핑 지수 표라면 그날 전일 대비).
   * 주지 않으면 처음·끝 비교로 색을 지어내지 않고 먹(flat)으로 그린다. 30일 동안 내렸어도
   * 그날은 올랐을 수 있어서, 선의 색이 옆 숫자의 색과 다른 말을 하게 되기 때문이다.
   */
  direction?: Direction;
  /** CSS 픽셀(16px = 1rem으로 바꿔 그린다). */
  width?: number;
  height?: number;
  className?: string;
}

const PAD = 2.5;
const DOT_R = 2;
const WORD: Record<Direction, string> = { up: '상승', down: '하락', flat: '보합' };

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * 미니 차트: 선 하나와 끝점 하나. 축, 눈금, 채우기, 그라데이션은 없다.
 * 값 범위에 맞춰 위아래로 늘린다. 색은 주어진 direction(상승 빨강·하락 파랑), 없으면 먹.
 */
export function Sparkline({
  values,
  label,
  direction,
  width = 84,
  height = 22,
  className,
}: SparklineProps) {
  const data = values.filter((v) => Number.isFinite(v));
  if (data.length === 0) {
    return (
      <span className={cx(styles.empty, className)}>
        <span aria-hidden="true">{MISSING}</span>
        <VisuallyHidden>{`${label}: 데이터 없음`}</VisuallyHidden>
      </span>
    );
  }

  const last = data[data.length - 1] as number;
  const dir: Direction = direction ?? 'flat';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const innerW = width - PAD * 2;
  const innerH = height - PAD * 2;
  const x = (i: number) =>
    data.length === 1 ? width - PAD : PAD + (i * innerW) / (data.length - 1);
  const y = (v: number) => (max === min ? height / 2 : PAD + ((max - v) / (max - min)) * innerH);
  const pts = data.map((v, i) => `${round(x(i))},${round(y(v))}`).join(' ');

  return (
    <svg
      role="img"
      aria-label={direction ? `${label}, ${WORD[direction]}` : label}
      className={cx(styles.spark, className)}
      data-direction={dir}
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: `${width / 16}rem`, height: `${height / 16}rem` }}
    >
      {data.length > 1 ? (
        <polyline
          points={pts}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <circle cx={round(x(data.length - 1))} cy={round(y(last))} r={DOT_R} fill="currentColor" />
    </svg>
  );
}
