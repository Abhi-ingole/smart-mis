import { useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, Treemap, XAxis, YAxis, ZAxis } from "recharts";
import type { ChartSpec, ColumnSchema, Table } from "../engine/types";
import { buildChartData, chartDataTable, type ChartData } from "../engine/charts";
import { fmtCompact, fmtNumber, fmtValue } from "../engine/format";

export const PALETTE = ["#0f55e0", "#0e9f8e", "#e0802a", "#a23bc7", "#05a3d6", "#c94a6b", "#6b8f1d", "#7a5af0"];
const AXIS = { fontSize: 11, fill: "var(--color-ink-faint)" };
const TOOLTIP = { contentStyle: { borderRadius: 8, border: "1px solid var(--color-line)", fontSize: 12, boxShadow: "var(--shadow-card)" } };
const short = (v: string, n = 12) => (v.length > n ? v.slice(0, n - 1) + "…" : v);
/** Category axis: tilt labels when there are many or long ones so they never overlap. */
function catAxis(labels: string[]) {
  const longest = labels.reduce((m, l) => Math.max(m, Math.min(l.length, 14)), 0);
  const tilt = labels.length * longest > 48;
  return tilt
    ? { interval: 0 as const, angle: -30, textAnchor: "end" as const, height: 30 + longest * 4.2, tickFormatter: (v: string) => short(String(v), 14) }
    : { interval: 0 as const, tickFormatter: (v: string) => short(String(v), 14) };
}

export function useChartData(spec: ChartSpec, table: Table, rows: number[]) {
  return useMemo(() => buildChartData(spec, table, rows), [spec, table, rows]);
}

export function ChartView({ spec, table, rows, height = 260, animate = true, data: given }: { spec: ChartSpec; table: Table; rows: number[]; height?: number; animate?: boolean; data?: ChartData }) {
  const computed = useChartData(spec, table, rows);
  const data = given ?? computed;
  const yCol: ColumnSchema | undefined = table.schema.find((c) => c.key === (spec.y ?? spec.measures?.[0]));
  const xCol: ColumnSchema | undefined = table.schema.find((c) => c.key === spec.x);
  const fmtY = (v: number) => (yCol && spec.agg !== "count" ? fmtValue(v, yCol) : fmtNumber(v));
  const anim = animate ? undefined : false;
  const opt = spec.options ?? {};
  const labelFmt = (v: unknown) => (typeof v === "number" ? fmtCompact(v) : "");

  if (data.kind === "empty") return <div className="flex items-center justify-center text-sm text-ink-faint" style={{ height }}>{data.message}</div>;

  if (data.kind === "table") {
    return (
      <div className="overflow-auto rounded-lg border border-line" style={{ maxHeight: height + 80 }}>
        <table className="table">
          <thead>
            <tr>
              {data.columns.map((c) => (
                <th key={c.key} className="whitespace-nowrap">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j} className={`max-w-[16rem] truncate ${v === null ? "text-ink-faint" : ""}`} title={v ?? ""}>
                    {v ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sticky left-0 border-t border-line bg-sunken px-3 py-2 text-xs text-ink-soft">
          Showing {data.rows.length.toLocaleString("en-IN")} of {data.total.toLocaleString("en-IN")} rows.
        </p>
      </div>
    );
  }

  const note = "note" in data && data.note ? <p className="mt-2 text-xs text-ink-faint">{data.note}</p> : null;

  // Table view of the chart's own numbers
  if (opt.asTable || spec.type === "table") {
    const t = chartDataTable(data);
    if (!t) return null;
    return (
      <div>
        <div className="overflow-auto rounded-lg border border-line" style={{ maxHeight: height + 40 }}>
          <table className="table">
            <thead>
              <tr>
                {t.headers.map((h, i) => (
                  <th key={i} className={`whitespace-nowrap ${i ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) => (
                    <td key={j} className={j ? "text-right tabular-nums" : "max-w-[14rem] truncate"}>
                      {v === null ? "—" : typeof v === "number" ? (data.kind === "scatter" ? fmtNumber(v) : fmtY(v)) : v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {note}
      </div>
    );
  }

  if (data.kind === "scatter") {
    return (
      <div>
        <ResponsiveContainer width="100%" height={height}>
          <ScatterChart margin={{ top: 8, right: 12, bottom: 18, left: 4 }}>
            <CartesianGrid stroke="var(--color-line)" />
            <XAxis type="number" dataKey="x" name={data.xLabel} tick={AXIS} tickFormatter={fmtCompact} label={{ value: data.xLabel, position: "insideBottom", offset: -10, fontSize: 11, fill: "var(--color-ink-soft)" }} />
            <YAxis type="number" dataKey="y" name={data.yLabel} tick={AXIS} tickFormatter={fmtCompact} width={52} />
            <ZAxis range={[24, 24]} />
            <Tooltip {...TOOLTIP} formatter={(v) => fmtNumber(Number(v))} />
            <Scatter data={data.points} fill={PALETTE[0]} fillOpacity={0.55} isAnimationActive={anim} />
          </ScatterChart>
        </ResponsiveContainer>
        <p className="mt-1 text-xs text-ink-faint">
          Correlation {data.r === null ? "n/a" : data.r.toFixed(2)} — association only, not cause. {data.note ?? ""}
        </p>
      </div>
    );
  }

  if (data.kind === "matrix") {
    if (spec.type === "heatmap") {
      let max = 0;
      data.values.forEach((r) => r.forEach((v) => v !== null && v > max && (max = v)));
      return (
        <div className="overflow-auto" style={{ maxHeight: height + 60 }}>
          <table className="w-full border-separate border-spacing-0.5 text-xs">
            <thead>
              <tr>
                <th className="p-1 text-left font-medium text-ink-faint">
                  {data.xLabel} ↓ / {data.seriesLabel} →
                </th>
                {data.cols.map((c) => (
                  <th key={c} className="max-w-[7rem] truncate p-1 font-medium text-ink-soft" title={c}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={r}>
                  <th className="max-w-[9rem] truncate p-1 text-left font-medium text-ink-soft" title={r}>
                    {r}
                  </th>
                  {data.values[i].map((v, j) => {
                    const t = v === null || !max ? 0 : v / max;
                    return (
                      <td key={j} className="rounded p-1.5 text-center" style={{ background: v === null ? "var(--color-sunken)" : `rgba(59,79,216,${0.08 + t * 0.82})`, color: t > 0.55 ? "#fff" : "var(--color-ink)" }} title={`${r} × ${data.cols[j]}: ${v === null ? "no data" : fmtY(v)}`}>
                        {v === null ? "—" : fmtCompact(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {note}
        </div>
      );
    }
    // stacked (or grouped columns when the type is "column")
    const rowsData = data.rows.map((r, i) => Object.fromEntries([["label", r], ...data.cols.map((c, j) => [c, data.values[i][j] ?? 0])]));
    return (
      <div>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={rowsData} margin={{ top: 16, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis dataKey="label" tick={AXIS} {...catAxis(data.rows)} />
            <YAxis tick={AXIS} tickFormatter={fmtCompact} width={52} />
            <Tooltip {...TOOLTIP} formatter={(v) => fmtY(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
            {data.cols.map((c, j) => (
              <Bar key={c} dataKey={c} stackId={spec.type === "stacked" ? "s" : undefined} fill={PALETTE[j % PALETTE.length]} radius={spec.type === "stacked" ? 0 : [3, 3, 0, 0]} isAnimationActive={anim} />
            ))}
          </BarChart>
        </ResponsiveContainer>
        {note}
      </div>
    );
  }

  // Several measures (grouped columns, horizontal bars, lines, areas or stacked)
  if (data.kind === "multi") {
    const rowsData = data.labels.map((l, i) => Object.fromEntries([["label", l], ...data.series.map((s) => [s.key, s.values[i]])]));
    const legend = <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" verticalAlign="top" align="left" height={28} />;
    const tip = <Tooltip {...TOOLTIP} cursor={{ fill: "var(--color-sunken)" }} formatter={(v, name) => [v === null || v === undefined ? "no data" : fmtY(Number(v)), name]} />;
    const horizontal = spec.type === "bar";
    const lineLike = spec.type === "line" || spec.type === "area";
    return (
      <div>
        <ResponsiveContainer width="100%" height={horizontal ? Math.max(height, data.labels.length * data.series.length * 14 + 60) : height}>
          {lineLike ? (
            spec.type === "line" ? (
              <LineChart data={rowsData} margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--color-line)" />
                <XAxis dataKey="label" tick={AXIS} minTickGap={16} />
                <YAxis tick={AXIS} tickFormatter={fmtCompact} width={52} />
                {tip}
                {legend}
                {data.series.map((s, i) => (
                  <Line key={s.key} dataKey={s.key} name={s.name} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={opt.dots ?? data.labels.length <= 24 ? { r: 3 } : false} isAnimationActive={anim}>
                    {opt.labels && <LabelList dataKey={s.key} position="top" fontSize={10} formatter={labelFmt} />}
                  </Line>
                ))}
              </LineChart>
            ) : (
              <AreaChart data={rowsData} margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--color-line)" />
                <XAxis dataKey="label" tick={AXIS} minTickGap={16} />
                <YAxis tick={AXIS} tickFormatter={fmtCompact} width={52} />
                {tip}
                {legend}
                {data.series.map((s, i) => (
                  <Area key={s.key} dataKey={s.key} name={s.name} stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.12} strokeWidth={2} dot={opt.dots ?? data.labels.length <= 24 ? { r: 3 } : false} isAnimationActive={anim} />
                ))}
              </AreaChart>
            )
          ) : (
            <BarChart data={rowsData} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
              <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke="var(--color-line)" />
              {horizontal ? (
                <>
                  <XAxis type="number" tick={AXIS} tickFormatter={fmtCompact} />
                  <YAxis type="category" dataKey="label" tick={AXIS} width={110} tickFormatter={(v: string) => short(v, 16)} />
                </>
              ) : (
                <>
                  <XAxis dataKey="label" tick={AXIS} {...catAxis(data.labels)} />
                  <YAxis tick={AXIS} tickFormatter={fmtCompact} width={52} />
                </>
              )}
              {tip}
              {legend}
              {data.series.map((s, i) => (
                <Bar key={s.key} dataKey={s.key} name={s.name} stackId={spec.type === "stacked" ? "s" : undefined} fill={PALETTE[i % PALETTE.length]} radius={spec.type === "stacked" ? 0 : horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]} maxBarSize={36} isAnimationActive={anim}>
                  {opt.labels && spec.type !== "stacked" && <LabelList dataKey={s.key} position={horizontal ? "right" : "top"} fontSize={10} formatter={labelFmt} />}
                </Bar>
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
        {note}
      </div>
    );
  }

  // ── Single series ──
  const points = data.points.map((p) => ({ label: p.label, value: p.value }));

  if (spec.type === "pie" || spec.type === "donut") {
    const total = points.reduce((a, p) => a + (p.value ?? 0), 0) || 1;
    return (
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <div className="w-full sm:w-1/2" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={points}
                dataKey="value"
                nameKey="label"
                innerRadius={spec.type === "donut" ? "58%" : 0}
                outerRadius="88%"
                paddingAngle={1}
                isAnimationActive={anim}
                label={opt.labels ? ({ percent }: { percent?: number }) => `${((percent ?? 0) * 100).toFixed(0)}%` : false}
                labelLine={false}
              >
                {points.map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip {...TOOLTIP} formatter={(v) => fmtY(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="w-full space-y-1.5 text-sm sm:w-1/2">
          {points.map((p, i) => (
            <li key={p.label} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="min-w-0 flex-1 truncate" title={p.label}>
                {p.label}
              </span>
              <span className="text-ink-soft">{(((p.value ?? 0) / total) * 100).toFixed(1)}%</span>
            </li>
          ))}
        </ul>
        {note}
      </div>
    );
  }

  if (spec.type === "treemap") {
    const total = points.reduce((a, p) => a + Math.max(0, p.value ?? 0), 0) || 1;
    const tm = points.filter((p) => (p.value ?? 0) > 0).map((p, i) => ({ name: p.label, size: p.value ?? 0, fill: PALETTE[i % PALETTE.length] }));
    return (
      <div>
        <ResponsiveContainer width="100%" height={height}>
          <Treemap data={tm} dataKey="size" nameKey="name" stroke="#fff" isAnimationActive={anim} content={<TreemapCell total={total} />}>
            <Tooltip {...TOOLTIP} formatter={(v) => fmtY(Number(v))} />
          </Treemap>
        </ResponsiveContainer>
        {note}
      </div>
    );
  }

  const isTime = xCol?.type === "date";
  if (spec.type === "bar") {
    const h = Math.max(height, points.length * 28 + 20);
    return (
      <div>
        <ResponsiveContainer width="100%" height={h}>
          <BarChart data={points} layout="vertical" margin={{ top: 4, right: opt.labels ? 48 : 16, bottom: 4, left: 4 }}>
            <CartesianGrid horizontal={false} stroke="var(--color-line)" />
            <XAxis type="number" tick={AXIS} tickFormatter={fmtCompact} />
            <YAxis type="category" dataKey="label" tick={AXIS} width={120} tickFormatter={(v: string) => short(v, 18)} />
            <Tooltip {...TOOLTIP} cursor={{ fill: "var(--color-sunken)" }} formatter={(v) => [fmtY(Number(v)), data.yLabel]} />
            <Bar dataKey="value" fill={PALETTE[0]} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={anim}>
              {opt.labels && <LabelList dataKey="value" position="right" fontSize={10} formatter={labelFmt} />}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        {note}
      </div>
    );
  }
  const common = { data: points, margin: { top: opt.labels ? 18 : 8, right: 12, bottom: 4, left: 4 } };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--color-line)" />
      {isTime || spec.type === "histogram" ? <XAxis dataKey="label" tick={AXIS} minTickGap={16} interval="preserveStartEnd" /> : <XAxis dataKey="label" tick={AXIS} {...catAxis(points.map((p) => p.label))} />}
      <YAxis tick={AXIS} tickFormatter={fmtCompact} width={52} />
      <Tooltip {...TOOLTIP} cursor={{ fill: "var(--color-sunken)" }} formatter={(v) => [v === null || v === undefined ? "no data" : fmtY(Number(v)), data.yLabel]} />
    </>
  );
  const dots = opt.dots ?? points.length <= 24;
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        {spec.type === "line" ? (
          <LineChart {...common}>
            {axes}
            <Line dataKey="value" stroke={PALETTE[0]} strokeWidth={2} dot={dots ? { r: 3, fill: PALETTE[0] } : false} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={anim}>
              {opt.labels && <LabelList dataKey="value" position="top" fontSize={10} formatter={labelFmt} />}
            </Line>
          </LineChart>
        ) : spec.type === "area" ? (
          <AreaChart {...common}>
            {axes}
            <Area dataKey="value" stroke={PALETTE[0]} fill={PALETTE[0]} fillOpacity={0.12} strokeWidth={2} dot={opt.dots ? { r: 3, fill: PALETTE[0] } : false} isAnimationActive={anim}>
              {opt.labels && <LabelList dataKey="value" position="top" fontSize={10} formatter={labelFmt} />}
            </Area>
          </AreaChart>
        ) : (
          <BarChart {...common} barCategoryGap={spec.type === "histogram" ? 1 : "20%"}>
            {axes}
            <Bar dataKey="value" fill={PALETTE[0]} radius={spec.type === "histogram" ? 0 : [4, 4, 0, 0]} maxBarSize={48} isAnimationActive={anim}>
              {opt.labels && <LabelList dataKey="value" position="top" fontSize={10} formatter={labelFmt} />}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
      {note}
    </div>
  );
}

/** Treemap tile with name and share, only when the tile is large enough to read. */
function TreemapCell(props: { x?: number; y?: number; width?: number; height?: number; name?: string; size?: number; fill?: string; total: number; depth?: number }) {
  const { x = 0, y = 0, width = 0, height = 0, name, size = 0, fill, total, depth } = props;
  if (depth === 0) return null;
  const big = width > 70 && height > 34;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill ?? PALETTE[0]} stroke="#fff" strokeWidth={2} rx={4} />
      {big && (
        <>
          <text x={x + 8} y={y + 18} fontSize={12} fill="#fff" fontWeight={600}>
            {short(String(name ?? ""), Math.max(4, Math.floor(width / 8)))}
          </text>
          <text x={x + 8} y={y + 33} fontSize={11} fill="#fff" opacity={0.9}>
            {((size / total) * 100).toFixed(1)}%
          </text>
        </>
      )}
    </g>
  );
}
