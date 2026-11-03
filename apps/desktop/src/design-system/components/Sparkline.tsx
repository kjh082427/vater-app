import { MISSING, type Direction } from '../format/money';
import { cx } from '../internal/cx';
import styles from './Sparkline.module.css';
import { VisuallyHidden } from './VisuallyHidden';

export interface SparklineProps {
  /** 오래된 것부터 최근 순서의 값. 숫자가 아닌 값은 건너뛴다. */
  values: readonly number[];
  /** 무엇의 선인지. 예: "코스피 최근 30일 종가". 방향("상승")이 뒤에 붙어 읽힌다. */
  label: string;
  /** 색을 정하는 방향. 없으면 처음과 끝을 비교한다. 브리핑은 그날 전일 대비 방향을 준다. */
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
 * 값 범위에 맞춰 위아래로 늘리고, 상승 빨강·하락 파랑·보합 회색으로 칠한다.
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

  const first = data[0] as number;
  const last = data[data.length - 1] as number;
  const dir: Direction = direction ?? (last > first ? 'up' : last < first ? 'down' : 'flat');
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
      aria-label={`${label}, ${WORD[dir]}`}
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
