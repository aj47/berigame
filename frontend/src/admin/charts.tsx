import React, { useEffect, useRef, useState } from 'react';

/**
 * Small SVG charts for the admin panel: one y-axis each, thin marks, a hover
 * tooltip on every chart, recessive grid. Colors come from CSS roles in admin.css.
 */

export type Series = { name: string; color: string };
export type BarDatum = { label: string; values: number[] };

const PAD = { top: 10, right: 8, bottom: 22, left: 40 };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** 0, then three round steps that cover the range. */
function ticks(min: number, max: number): number[] {
  const span = Math.max(1, max - min);
  const raw = span / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

export const compact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return <div className="adm-legend">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>;
}

function Tip({ x, width, children }: { x: number; width: number; children: React.ReactNode }) {
  const left = Math.min(Math.max(x, 70), width - 70);
  return <div className="adm-tip" style={{ left }}>{children}</div>;
}

/** Bars per label; several series stack. Negative values stack downward from zero. */
export function BarChart({ data, series, height = 180, format = compact, empty = 'No data in this range' }: {
  data: BarDatum[]; series: Series[]; height?: number; format?: (n: number) => string; empty?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const tops = data.map((d) => d.values.reduce((s, v) => s + Math.max(0, v), 0));
  const bottoms = data.map((d) => d.values.reduce((s, v) => s + Math.min(0, v), 0));
  const max = Math.max(1, ...tops);
  const min = Math.min(0, ...bottoms);
  const grid = ticks(min, max);
  const lo = Math.min(min, grid[0]), hi = Math.max(max, grid[grid.length - 1]);
  const innerW = width - PAD.left - PAD.right, innerH = height - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH;
  const slot = innerW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(28, slot - 2));
  const every = Math.ceil(data.length / Math.max(2, Math.floor(innerW / 56)));
  const isEmpty = tops.every((t) => t === 0) && bottoms.every((b) => b === 0);

  return <div className="adm-chart" ref={ref}>
    <Legend series={series} />
    <svg width={width} height={height} role="img" aria-label={series.map((s) => s.name).join(', ')} onMouseLeave={() => setHover(null)}>
      {grid.map((v) => <g key={v}>
        <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} className={v === 0 ? 'adm-axis' : 'adm-gridline'} />
        <text x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end" className="adm-tick">{format(v)}</text>
      </g>)}
      {data.map((d, i) => {
        const cx = PAD.left + slot * i + slot / 2;
        let up = 0, down = 0;
        return <g key={d.label}>
          {hover === i && <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={innerH} className="adm-hover-band" />}
          {d.values.map((v, k) => {
            if (!v) return null;
            const from = v > 0 ? up : down;
            const to = from + v;
            if (v > 0) up = to; else down = to;
            const top = y(Math.max(from, to)), bottom = y(Math.min(from, to));
            // 2px surface gap between stacked segments.
            const gap = (v > 0 ? from > 0 : from < 0) ? 2 : 0;
            const h = Math.max(1, bottom - top - gap);
            return <rect key={k} x={cx - barW / 2} y={v > 0 ? top : top + gap} width={barW} height={h} rx={Math.min(3, barW / 3)} fill={series[k]?.color} />;
          })}
          {(data.length - 1 - i) % every === 0 && <text x={cx} y={height - 6} textAnchor="middle" className="adm-tick">{d.label}</text>}
          <rect x={PAD.left + slot * i} y={0} width={slot} height={height} fill="transparent" onMouseEnter={() => setHover(i)} />
        </g>;
      })}
    </svg>
    {isEmpty && <div className="adm-empty">{empty}</div>}
    {hover !== null && data[hover] && <Tip x={PAD.left + slot * hover + slot / 2} width={width}>
      <b>{data[hover].label}</b>
      {series.map((s, k) => <div key={s.name}><i style={{ background: s.color }} />{s.name}<span>{format(data[hover].values[k] ?? 0)}</span></div>)}
    </Tip>}
  </div>;
}

/** One line with a crosshair tooltip. */
export function LineChart({ data, color, name, height = 180, format = compact }: {
  data: { label: string; value: number }[]; color: string; name: string; height?: number; format?: (n: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const values = data.map((d) => d.value);
  const grid = ticks(Math.min(0, ...values), Math.max(1, ...values));
  const lo = grid[0], hi = grid[grid.length - 1];
  const innerW = width - PAD.left - PAD.right, innerH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (data.length < 2 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH;
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join('');
  const every = Math.ceil(data.length / Math.max(2, Math.floor(innerW / 56)));
  const pick = (clientX: number, rect: DOMRect) => {
    if (!data.length) return;
    const ratio = (clientX - rect.left - PAD.left) / innerW;
    setHover(Math.max(0, Math.min(data.length - 1, Math.round(ratio * (data.length - 1)))));
  };

  return <div className="adm-chart" ref={ref}>
    <svg width={width} height={height} role="img" aria-label={name}
      onMouseMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())} onMouseLeave={() => setHover(null)}>
      {grid.map((v) => <g key={v}>
        <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} className={v === 0 ? 'adm-axis' : 'adm-gridline'} />
        <text x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end" className="adm-tick">{format(v)}</text>
      </g>)}
      {data.map((d, i) => (data.length - 1 - i) % every === 0 && <text key={d.label} x={x(i)} y={height - 6} textAnchor="middle" className="adm-tick">{d.label}</text>)}
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {hover !== null && <>
        <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} className="adm-crosshair" />
        <circle cx={x(hover)} cy={y(data[hover].value)} r={4.5} fill={color} className="adm-dot" />
      </>}
    </svg>
    {hover !== null && <Tip x={x(hover)} width={width}><b>{data[hover].label}</b><div><i style={{ background: color }} />{name}<span>{format(data[hover].value)}</span></div></Tip>}
  </div>;
}

/** Ranked horizontal bars for a short list (funnel steps, actions, reasons). */
export function HBars({ rows, color, format = compact }: { rows: { label: string; value: number; note?: string }[]; color: string; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  if (!rows.length) return <div className="adm-muted">Nothing recorded yet.</div>;
  return <div className="adm-hbars">
    {rows.map((r) => <div key={r.label} className="adm-hbar" title={`${r.label}: ${format(r.value)}${r.note ? ` (${r.note})` : ''}`}>
      <span className="adm-hbar-label">{r.label}</span>
      <span className="adm-hbar-track"><span style={{ width: `${(Math.abs(r.value) / max) * 100}%`, background: color }} /></span>
      <span className="adm-hbar-value">{format(r.value)}{r.note && <small> {r.note}</small>}</span>
    </div>)}
  </div>;
}
