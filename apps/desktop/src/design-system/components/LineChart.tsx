import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { cx } from '../internal/cx';
import styles from './LineChart.module.css';

export interface LineChartProps {
  /** 오래된 것부터 최근 순서. null(또는 숫자가 아닌 값)은 선을 끊는다. */
  values: (number | null)[];
  /** x축 라벨(values와 같은 길이). 처음·가운데·끝만 보인다. */
  labels?: string[];
  /** 기준값(예: 전일 종가). 점선과 오른쪽 회색 값 표지. */
  baseline?: number;
  /** 선·영역·마지막 값 표지의 색. 옆에 놓인 숫자와 같은 자료의 방향이어야 한다. */
  direction: 'up' | 'down' | 'flat';
  /** 눈금·표지·요약 문장의 숫자 표기(format/money.ts). */
  format: (n: number) => string;
  /** CSS 픽셀. 없으면 부모 높이를 따른다(최소 8rem). */
  height?: number;
  /** 무엇의 차트인지. 읽기 이름은 이 말 + 처음·끝 값 요약. */
  'aria-label': string;
  className?: string;
}

const WORD = { up: '상승', down: '하락', flat: '보합' } as const;
const FONT = 12;
const TAG_H = FONT + 6;
const PAD_T = 8;
const PAD_B_LABELS = 22;
const PAD_B = 6;
const FALLBACK_W = 480;
const FALLBACK_H = 180;

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 1·2·5 × 10^k 중 x 이상인 가장 작은 값. */
function niceStep(x: number): number {
  const power = 10 ** Math.floor(Math.log10(x));
  const unit = x / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

/** 바로 아래 단계의 보기 좋은 간격: 10→5, 5→2, 2→1, 1→0.5. */
function smallerStep(step: number): number {
  const power = 10 ** Math.floor(Math.log10(step) + 1e-9);
  const unit = Math.round(step / power);
  return unit === 5 ? 2 * power : unit === 2 ? power : 0.5 * power;
}

/** [lo, hi] 안의 보기 좋은 눈금 3개(가운데 쪽). 못 찾으면 고르게 나눈 3개. */
export function niceTicks(lo: number, hi: number): number[] {
  const range = hi - lo;
  if (!(range > 0) || !Number.isFinite(range)) return [lo, lo, lo];
  let step = niceStep(range / 4);
  for (let tries = 0; tries < 6; tries += 1) {
    const ticks: number[] = [];
    // 범위가 부동소수 한 칸 수준이면 t += step이 t를 바꾸지 못한다: 멈추고 고르게 나눈다(리뷰 C1).
    for (let t = Math.ceil(lo / step) * step, n = 0; t < hi && n < 50; t += step, n += 1) {
      if (t + step === t) break;
      if (t > lo) ticks.push(Math.round(t / step) * step);
    }
    if (ticks.length >= 3) {
      const start = Math.floor((ticks.length - 3) / 2);
      return ticks.slice(start, start + 3);
    }
    step = smallerStep(step);
  }
  return [1 / 6, 1 / 2, 5 / 6].map((t) => lo + range * t);
}

/** 부모 크기를 따른다. ResizeObserver가 없으면(테스트 환경) 기본 크기. */
function useSize(fixedHeight?: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: FALLBACK_W, h: fixedHeight ?? FALLBACK_H });
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({
        w: Math.max(Math.floor(width), 120),
        h: fixedHeight ?? Math.max(Math.floor(height), 120),
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fixedHeight]);
  return [ref, size] as const;
}

/**
 * 선 + 영역 차트(지수 차트 칸). 직접 그린 SVG.
 * 영역은 방향 색이 아래로 옅어지고, baseline은 점선, 마지막 값은 방향 색 바탕의 표지.
 * y축 눈금 3개(오른쪽), x축 라벨은 처음·가운데·끝. 마우스를 올리면 그 자리의 값을 보인다.
 */
export function LineChart({
  values,
  labels,
  baseline,
  direction,
  format,
  height,
  'aria-label': ariaLabel,
  className,
}: LineChartProps) {
  const [ref, { w, h }] = useSize(height);
  const gradientId = `vt-line-${useId().replace(/[^\w-]/g, '')}`;
  const [hover, setHover] = useState<number | null>(null);

  const points = values.flatMap((v, i) => (isNum(v) ? [i] : []));
  const n = values.length;
  const firstIndex = points[0];
  const lastIndex = points[points.length - 1];

  if (firstIndex === undefined || lastIndex === undefined) {
    // 바깥 div는 자료가 있을 때와 같은 요소다(크기 관찰이 끊기지 않게)
    return (
      <div
        ref={ref}
        className={cx(styles.chart, className)}
        data-direction={direction}
        style={height ? { height } : undefined}
      >
        <div role="img" aria-label={`${ariaLabel}: 자료 없음`} className={styles.empty}>
          <span aria-hidden="true">자료 없음</span>
        </div>
      </div>
    );
  }

  const first = values[firstIndex] as number;
  const last = values[lastIndex] as number;
  const at = (i: number) => (labels?.[i] ? `(${labels[i]})` : '');
  const summary =
    points.length === 1
      ? `${ariaLabel}: ${format(last)}${at(lastIndex)}, ${WORD[direction]}`
      : `${ariaLabel}: 처음 ${format(first)}${at(firstIndex)}, 끝 ${format(last)}${at(lastIndex)}, ${WORD[direction]}`;

  // 범위: 값과 기준값을 모두 담고 위아래 12% 여유. 모두 같으면 값의 1%(0이면 1)만큼 벌린다.
  const all = points.map((i) => values[i] as number).concat(isNum(baseline) ? [baseline] : []);
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo <= Math.abs(hi) * 1e-9) {
    // 모두 같거나 부동소수 오차만큼만 다르면 평평한 선으로 본다
    const spread = Math.abs(hi) * 0.01 || 1;
    lo -= spread;
    hi += spread;
  }
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;

  const tagTexts = [format(last), ...(isNum(baseline) ? [format(baseline)] : [])];
  const ticks = niceTicks(lo, hi);
  const widest = Math.max(...tagTexts.concat(ticks.map(format)).map((t) => t.length));
  const padR = Math.ceil(widest * FONT * 0.62) + 14;
  const padB = labels && labels.length > 0 ? PAD_B_LABELS : PAD_B;
  const plotW = Math.max(w - padR, 10);
  const inner = Math.max(plotW - 8, 2); // 마지막 점이 값 표지에 붙지 않게
  const plotH = Math.max(h - PAD_T - padB, 10);
  const x = (i: number) => (n <= 1 ? inner / 2 : (inner * i) / (n - 1));
  const y = (v: number) => PAD_T + plotH * (1 - (v - lo) / (hi - lo));
  const r1 = (v: number) => Math.round(v * 10) / 10;

  // 선을 null에서 끊은 조각들
  const segments: number[][] = [];
  let run: number[] = [];
  values.forEach((v, i) => {
    if (isNum(v)) run.push(i);
    else if (run.length) {
      segments.push(run);
      run = [];
    }
  });
  if (run.length) segments.push(run);
  const lines = segments.filter((s) => s.length > 1);
  const lone = segments
    .filter((s) => s.length === 1 && s[0] !== lastIndex)
    .map((s) => s[0] as number);
  const lineD = lines
    .map((s) =>
      s.map((i, k) => `${k ? 'L' : 'M'}${r1(x(i))} ${r1(y(values[i] as number))}`).join(''),
    )
    .join('');
  const bottom = PAD_T + plotH;
  const areaD = lines
    .map((s) => {
      const head = s[0] as number;
      const tail = s[s.length - 1] as number;
      const top = s
        .map((i, k) => `${k ? 'L' : 'M'}${r1(x(i))} ${r1(y(values[i] as number))}`)
        .join('');
      return `${top}L${r1(x(tail))} ${bottom}L${r1(x(head))} ${bottom}Z`;
    })
    .join('');

  const clampTag = (v: number) => Math.max(PAD_T + TAG_H / 2, Math.min(bottom - TAG_H / 2, y(v)));
  const lastTagY = clampTag(last);
  const baseTagY = isNum(baseline) ? clampTag(baseline) : null;
  const showBaseTag = baseTagY !== null && Math.abs(baseTagY - lastTagY) >= TAG_H;
  const tagYs = [lastTagY, ...(showBaseTag && baseTagY !== null ? [baseTagY] : [])];
  const xLabelIdx =
    labels && labels.length > 0
      ? [...new Set([0, Math.floor((labels.length - 1) / 2), labels.length - 1])]
      : [];

  function onMove(event: PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / Math.max(box.width, 1)) * plotW;
    let best: number | null = null;
    for (const i of points) {
      if (best === null || Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    }
    setHover(best);
  }

  const hv = hover !== null ? (values[hover] as number) : null;

  return (
    <div
      ref={ref}
      className={cx(styles.chart, className)}
      data-direction={direction}
      style={height ? { height } : undefined}
    >
      <svg
        role="img"
        aria-label={summary}
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        className={styles.svg}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.16" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => {
          const ty = r1(y(t));
          const hidden = tagYs.some((tag) => Math.abs(tag - ty) < TAG_H);
          return (
            <g key={t}>
              <line data-role="y-grid" className={styles.grid} x1={0} x2={plotW} y1={ty} y2={ty} />
              {hidden ? null : (
                <text className={styles.axis} x={plotW + 6} y={ty + FONT * 0.36}>
                  {format(t)}
                </text>
              )}
            </g>
          );
        })}
        {xLabelIdx.map((i, k) => (
          <text
            key={i}
            data-role="x-label"
            className={styles.axis}
            x={r1(x(i))}
            y={h - 5}
            textAnchor={k === 0 ? 'start' : i === (labels?.length ?? 0) - 1 ? 'end' : 'middle'}
          >
            {labels?.[i]}
          </text>
        ))}
        {isNum(baseline) ? (
          <line
            data-role="baseline"
            className={styles.baseline}
            x1={0}
            x2={plotW}
            y1={r1(y(baseline))}
            y2={r1(y(baseline))}
            strokeDasharray="3 3"
          />
        ) : null}
        {areaD ? <path className={styles.area} d={areaD} fill={`url(#${gradientId})`} /> : null}
        {lineD ? <path data-role="line" className={styles.line} d={lineD} /> : null}
        {lone.map((i) => (
          <circle
            key={i}
            data-role="point"
            className={styles.point}
            cx={r1(x(i))}
            cy={r1(y(values[i] as number))}
            r={2.5}
          />
        ))}
        <circle
          data-role="point"
          className={styles.lastPoint}
          cx={r1(x(lastIndex))}
          cy={r1(y(last))}
          r={3.2}
        />
        {showBaseTag && baseTagY !== null && isNum(baseline) ? (
          <g data-role="baseline-tag">
            <rect
              className={styles.baseTag}
              x={plotW + 2}
              y={baseTagY - TAG_H / 2}
              width={padR - 2}
              height={TAG_H}
              rx={3}
            />
            <text className={styles.baseTagText} x={plotW + 6} y={baseTagY + FONT * 0.36}>
              {format(baseline)}
            </text>
          </g>
        ) : null}
        <g data-role="last-tag">
          <rect
            className={styles.lastTag}
            x={plotW + 2}
            y={lastTagY - TAG_H / 2}
            width={padR - 2}
            height={TAG_H}
            rx={3}
          />
          <text className={styles.lastTagText} x={plotW + 6} y={lastTagY + FONT * 0.36}>
            {format(last)}
          </text>
        </g>
        {hover !== null && hv !== null ? (
          <g aria-hidden="true">
            <line
              className={styles.cross}
              x1={r1(x(hover))}
              x2={r1(x(hover))}
              y1={PAD_T}
              y2={bottom}
            />
            <circle className={styles.lastPoint} cx={r1(x(hover))} cy={r1(y(hv))} r={3.2} />
            <text
              className={styles.readout}
              x={Math.min(Math.max(r1(x(hover)), 40), plotW - 40)}
              y={PAD_T + FONT}
              textAnchor="middle"
            >
              {`${labels?.[hover] ? `${labels[hover]} ` : ''}${format(hv)}`}
            </text>
          </g>
        ) : null}
        <rect
          className={styles.hit}
          x={0}
          y={0}
          width={plotW}
          height={h}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
    </div>
  );
}
