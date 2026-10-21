import { useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import type { ChartSpec, ColumnSchema, Table } from "../engine/types";
import { buildChartData } from "../engine/charts";
import { fmtCompact, fmtNumber, fmtValue } from "../engine/format";

export const PALETTE = ["#3b4fd8", "#0e9f8e", "#e0802a", "#a23bc7", "#2f8fd8", "#c94a6b", "#6b8f1d", "#7a5af0"];
const AXIS = { fontSize: 11, fill: "var(--color-ink-faint)" };
const TOOLTIP = { contentStyle: { borderRadius: 8, border: "1px solid var(--color-line)", fontSize: 12, boxShadow: "var(--shadow-card)" } };

export function ChartView({ spec, table, rows, height = 260, animate = true }: { spec: ChartSpec; table: Table; rows: number[]; height?: number; animate?: boolean }) {
  const data = useMemo(() => buildChartData(spec, table, rows), [spec, table, rows]);
  const yCol: ColumnSchema | undefined = table.schema.find((c) => c.key === spec.y);
  const xCol: ColumnSchema | undefined = table.schema.find((c) => c.key === spec.x);
  const fmtY = (v: number) => (yCol && spec.agg !== "count" ? fmtValue(v, yCol) : fmtNumber(v));
  const anim = animate ? undefined : false;

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
    const rowsData = data.rows.map((r, i) => Object.fromEntries([["label", r], ...data.cols.map((c, j) => [c, data.values[i][j] ?? 0])]));
    return (
      <div>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={rowsData} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis dataKey="label" tick={AXIS} interval={0} tickFormatter={(v: string) => (v.length > 12 ? v.slice(0, 11) + "…" : v)} />
            <YAxis tick={AXIS} tickFormatter={fmtCompact} width={52} />
            <Tooltip {...TOOLTIP} formatter={(v) => fmtY(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {data.cols.map((c, j) => (
              <Bar key={c} dataKey={c} stackId="s" fill={PALETTE[j % PALETTE.length]} isAnimationActive={anim} />
            ))}
          </BarChart>
        </ResponsiveContainer>
        {note}
      </div>
    );
  }

  // Series charts
  const points = data.points.map((p) => ({ label: p.label, value: p.value }));
  if (spec.type === "pie" || spec.type === "donut") {
    const total = points.reduce((a, p) => a + (p.value ?? 0), 0) || 1;
    return (
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <div className="w-full sm:w-1/2" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={points} dataKey="value" nameKey="label" innerRadius={spec.type === "donut" ? "58%" : 0} outerRadius="88%" paddingAngle={1} isAnimationActive={anim}>
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
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
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

  const isTime = xCol?.type === "date";
  const longLabels = !isTime && spec.type === "bar" && (points.length > 6 || points.some((p) => p.label.length > 10));
  if (spec.type === "bar" && longLabels) {
    const h = Math.max(height, points.length * 28 + 20);
    return (
      <div>
        <ResponsiveContainer width="100%" height={h}>
          <BarChart data={points} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid horizontal={false} stroke="var(--color-line)" />
            <XAxis type="number" tick={AXIS} tickFormatter={fmtCompact} />
            <YAxis type="category" dataKey="label" tick={AXIS} width={120} tickFormatter={(v: string) => (v.length > 18 ? v.slice(0, 17) + "…" : v)} />
            <Tooltip {...TOOLTIP} cursor={{ fill: "var(--color-sunken)" }} formatter={(v) => [fmtY(Number(v)), data.yLabel]} />
            <Bar dataKey="value" fill={PALETTE[0]} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={anim} />
          </BarChart>
        </ResponsiveContainer>
        {note}
      </div>
    );
  }
  const common = { data: points, margin: { top: 8, right: 12, bottom: 4, left: 4 } };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--color-line)" />
      <XAxis dataKey="label" tick={AXIS} minTickGap={16} />
      <YAxis tick={AXIS} tickFormatter={fmtCompact} width={52} />
      <Tooltip {...TOOLTIP} cursor={{ fill: "var(--color-sunken)" }} formatter={(v) => [v === null || v === undefined ? "no data" : fmtY(Number(v)), data.yLabel]} />
    </>
  );
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        {spec.type === "line" ? (
          <LineChart {...common}>
            {axes}
            <Line dataKey="value" stroke={PALETTE[0]} strokeWidth={2} dot={points.length <= 24 ? { r: 2.5 } : false} connectNulls={false} isAnimationActive={anim} />
          </LineChart>
        ) : spec.type === "area" ? (
          <AreaChart {...common}>
            {axes}
            <Area dataKey="value" stroke={PALETTE[0]} fill={PALETTE[0]} fillOpacity={0.12} strokeWidth={2} isAnimationActive={anim} />
          </AreaChart>
        ) : (
          <BarChart {...common} barCategoryGap={spec.type === "histogram" ? 1 : "20%"}>
            {axes}
            <Bar dataKey="value" fill={PALETTE[0]} radius={spec.type === "histogram" ? 0 : [4, 4, 0, 0]} maxBarSize={48} isAnimationActive={anim} />
          </BarChart>
        )}
      </ResponsiveContainer>
      {note}
    </div>
  );
}
