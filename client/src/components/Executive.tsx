/**
 * Report-style executive visuals: monthly bars coloured by quarter, change vs last
 * year (or vs the previous month), and a dimension × quarter matrix with data bars.
 */
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ColumnSchema } from "../engine/types";
import { pctChange, QUARTER_LABELS, type ExecMeasure, type MatrixRow, type MonthPoint, type YearMode } from "../engine/executive";
import { fmtCompact, fmtNumber, fmtPercent, fmtValue } from "../engine/format";
import { Segmented } from "./ui";

export const QUARTER_COLORS = ["#12355b", "#2a9d8f", "#7b8aa8", "#4ea8de"];
const GOOD = "#1f8a5b";
const BAD = "#c2362f";
const AXIS = { fontSize: 11, fill: "var(--color-ink-faint)" };
const TOOLTIP = { contentStyle: { borderRadius: 6, border: "1px solid var(--color-line)", fontSize: 12, boxShadow: "0 4px 14px rgba(20,26,46,.12)" }, cursor: { fill: "rgba(29,78,137,0.06)" } };

const fmt = (v: number | null | undefined, col?: ColumnSchema, m?: ExecMeasure) => (v === null || v === undefined ? "—" : m?.agg === "count" || !col ? fmtNumber(v, 0) : fmtValue(v, col));

export function Panel({ title, subtitle, right, children, className = "" }: { title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card flex min-w-0 flex-col p-4 ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="panel-title">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-ink-faint">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function QuarterLegend({ mode }: { mode: YearMode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-soft">
      {QUARTER_LABELS(mode).map((q, i) => (
        <span key={q} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: QUARTER_COLORS[i] }} />
          {q.split(" ")[0]}
        </span>
      ))}
    </div>
  );
}

export function MonthBars({ points, measure, col, mode, animate = true }: { points: MonthPoint[]; measure: ExecMeasure; col?: ColumnSchema; mode: YearMode; animate?: boolean }) {
  const data = points.map((p) => ({ ...p, v: p.rows ? p.value : null }));
  const many = points.length > 12;
  return (
    <div>
      <QuarterLegend mode={mode} />
      <div className="mt-2 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis dataKey={many ? "long" : "label"} tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--color-line)" }} interval={many ? "preserveStartEnd" : 0} minTickGap={8} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => fmtCompact(v)} />
            <Tooltip {...TOOLTIP} formatter={(v) => [fmt(v as number, col, measure), measure.name]} labelFormatter={(_, p) => (p?.[0]?.payload as MonthPoint | undefined)?.long ?? ""} />
            <Bar dataKey="v" radius={[2, 2, 0, 0]} maxBarSize={34} isAnimationActive={animate}>
              {data.map((p, i) => (
                <Cell key={i} fill={QUARTER_COLORS[p.quarter - 1]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Change per month: vs the same month last year when there is one, else vs the previous month. */
export function VarianceBars({ points, measure, col, animate = true }: { points: MonthPoint[]; measure: ExecMeasure; col?: ColumnSchema; animate?: boolean }) {
  const [mode, setMode] = useState<"abs" | "pct">("abs");
  const yoy = points.some((p) => p.prior !== null && p.rows > 0);
  const data = points.map((p, i) => {
    const before = yoy ? p.prior : i > 0 && points[i - 1].rows ? points[i - 1].value : null;
    const now = p.rows ? p.value : null;
    const abs = now !== null && before !== null ? now - before : null;
    return { label: points.length > 12 ? p.long : p.label, long: p.long, v: mode === "abs" ? abs : pctChange(now, before), before, now };
  });
  const has = data.some((d) => d.v !== null);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-soft">{yoy ? "Compared with the same month last year" : "Compared with the previous month"}</p>
        <Segmented
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: "abs", label: "Change" },
            { value: "pct", label: "% change" },
          ]}
        />
      </div>
      <div className="mt-2 h-44">
        {!has ? (
          <p className="flex h-full items-center justify-center text-sm text-ink-faint">Needs at least two months of data.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--color-line)" />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval={points.length > 12 ? "preserveStartEnd" : 0} minTickGap={8} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => (mode === "pct" ? `${Math.round(v)}%` : fmtCompact(v))} />
              <ReferenceLine y={0} stroke="var(--color-line-strong)" />
              <Tooltip
                {...TOOLTIP}
                labelFormatter={(_, p) => (p?.[0]?.payload as { long: string } | undefined)?.long ?? ""}
                formatter={(v, _n, item) => {
                  const d = item.payload as { before: number | null; now: number | null };
                  const main = mode === "pct" ? fmtPercent(v as number) : `${(v as number) > 0 ? "+" : ""}${fmt(v as number, col, measure)}`;
                  return [`${main} (${fmt(d.before, col, measure)} → ${fmt(d.now, col, measure)})`, yoy ? "vs last year" : "vs previous month"];
                }}
              />
              <Bar dataKey="v" maxBarSize={30} radius={[2, 2, 2, 2]} isAnimationActive={animate}>
                {data.map((d, i) => (
                  <Cell key={i} fill={(d.v ?? 0) >= 0 ? GOOD : BAD} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

type MatrixView = "actual" | "yoy" | "share";

export function QuarterMatrix({ rows, total, mode, measure, col, dimName }: { rows: MatrixRow[]; total: MatrixRow; mode: YearMode; measure: ExecMeasure; col?: ColumnSchema; dimName: string }) {
  const hasPrior = total.prior.some((v) => v !== null);
  const additive = measure.agg === "sum" || measure.agg === "count";
  const [view, setView] = useState<MatrixView>("actual");
  const v = view === "yoy" && !hasPrior ? "actual" : view === "share" && !additive ? "actual" : view;
  const quarters = QUARTER_LABELS(mode).map((q) => q.split(" ")[0]);
  const cellMax = Math.max(1, ...rows.flatMap((r) => r.quarters.map((x) => Math.abs(x ?? 0))));
  const totalMax = Math.max(1, ...rows.map((r) => Math.abs(r.total ?? 0)));
  // Long Indian-format amounts (₹8,01,73,000) don't fit five columns; show ₹8.02Cr and keep the exact value on hover.
  const compact = Math.abs(total.total ?? 0) >= 1e7;
  const show = (val: number) => {
    if (!compact) return fmt(val, col, measure);
    const sym = col?.type === "currency" ? fmt(0, col, measure).replace(/[\d.,\s-]/g, "") : "";
    const a = Math.abs(val);
    const t = a >= 1e7 ? `${(val / 1e7).toFixed(2)}Cr` : a >= 1e5 ? `${(val / 1e5).toFixed(2)}L` : fmtNumber(val, 0);
    return `${val < 0 ? "-" : ""}${sym}${t.replace("-", "")}`;
  };

  const cell = (val: number | null, prior: number | null, colTotal: number | null, max: number, bold = false) => {
    if (v === "yoy") {
      const ch = pctChange(val, prior);
      if (ch === null) return <span className="text-ink-faint">—</span>;
      return (
        <span className={`font-medium ${ch >= 0 ? "text-good" : "text-bad"}`}>
          {ch >= 0 ? "▲" : "▼"} {fmtPercent(Math.abs(ch))}
        </span>
      );
    }
    if (val === null) return <span className="text-ink-faint">—</span>;
    const text = v === "share" ? fmtPercent(colTotal ? (val / colTotal) * 100 : null) : show(val);
    const w = v === "share" ? (colTotal ? Math.abs(val / colTotal) : 0) : Math.abs(val) / max;
    return (
      <span className="relative block">
        {!bold && (
          <span className="absolute inset-y-0 right-0 rounded-sm" style={{ width: `${Math.min(100, w * 100)}%`, background: val < 0 ? "rgba(194,54,47,0.16)" : "rgba(42,157,143,0.18)" }} aria-hidden />
        )}
        <span className={`relative ${bold ? "font-semibold" : ""}`} title={fmt(val, col, measure)}>
          {text}
        </span>
      </span>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Segmented
        value={v}
        onChange={setView}
        options={[
          { value: "actual", label: "Actuals" },
          { value: "yoy", label: "vs last year", disabled: !hasPrior, title: hasPrior ? undefined : "No data for the previous year" },
          { value: "share", label: "% of total", disabled: !additive },
        ]}
      />
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-right text-[13px] tabular-nums">
          <thead>
            <tr className="border-b border-line-strong text-xs text-ink-soft">
              <th className="py-2 pr-3 text-left font-semibold">{dimName}</th>
              {quarters.map((q) => (
                <th key={q} className="px-2 py-2 font-semibold">
                  {q}
                </th>
              ))}
              <th className="py-2 pl-2 font-semibold text-ink">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-line/70">
                <td className="max-w-[12rem] truncate py-1.5 pr-3 text-left text-ink" title={r.label}>
                  {r.label}
                </td>
                {r.quarters.map((x, k) => (
                  <td key={k} className="px-2 py-1.5">
                    {cell(x, r.prior[k], total.quarters[k], cellMax)}
                  </td>
                ))}
                <td className="py-1.5 pl-2">{cell(r.total, r.priorTotal, total.total, totalMax)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line-strong bg-sunken/60">
              <td className="py-2 pr-3 text-left font-semibold">Total</td>
              {total.quarters.map((x, k) => (
                <td key={k} className="px-2 py-2 font-semibold">
                  {cell(x, total.prior[k], x, 1, true)}
                </td>
              ))}
              <td className="py-2 pl-2 font-semibold">{cell(total.total, total.priorTotal, total.total, 1, true)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {v === "yoy" && <p className="mt-2 text-[11px] text-ink-faint">Each quarter compared with the same quarter one year earlier.</p>}
    </div>
  );
}

/** Ranked list with inline bars and share of total — compact, readable, prints well. */
export function RankedBars({ items, measure, col, total }: { items: { key: string; value: number }[]; measure: ExecMeasure; col?: ColumnSchema; total: number }) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  const additive = measure.agg === "sum" || measure.agg === "count";
  return (
    <ul className="space-y-2.5">
      {items.map((it, k) => (
        <li key={it.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-[13px]">
          <span className="truncate text-ink" title={it.key}>
            {it.key}
          </span>
          <span className="h-3.5 overflow-hidden rounded-sm bg-sunken">
            <span className="block h-full rounded-sm" style={{ width: `${(Math.abs(it.value) / max) * 100}%`, background: k === 0 ? "#1d4e89" : "#7b8aa8" }} />
          </span>
          <span className="whitespace-nowrap text-right tabular-nums text-ink">
            {fmt(it.value, col, measure)}
            {additive && total > 0 && <span className="ml-2 inline-block w-12 text-xs text-ink-faint">{fmtPercent((it.value / total) * 100)}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
