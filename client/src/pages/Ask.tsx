import { useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowUp, Info, LayoutDashboard, MessageSquareText, Table2, BarChart3 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DatasetGate, DatasetSwitcher, type Loaded } from "../components/DatasetGate";
import { PageHeader, useToast } from "../components/ui";
import { answerQuestion, suggestQuestions, type AskAnswer } from "../engine/ask";
import { pickMeasure } from "../engine/executive";
import { fmtCompact } from "../engine/format";
import { findTimeKey } from "../state/view";
import { allRows } from "../engine/analytics";
import type { ChartSpec } from "../engine/types";

export default function AskPage() {
  return (
    <DatasetGate base="/ask" title="Ask a question">
      {(d) => <Ask key={d.record.id} {...d} />}
    </DatasetGate>
  );
}

interface Turn {
  id: number;
  question: string;
  answer: AskAnswer;
}

const AXIS = { fontSize: 11, fill: "var(--color-ink-faint)" };

function Ask({ record, analysis, update }: Loaded) {
  const { table, profiles } = analysis;
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const timeKey = findTimeKey(record, analysis);
  const m = pickMeasure(record.dashboard.kpis, record.schema);
  const measure = record.schema.find((c) => c.key === m.key);
  const rows = useMemo(() => allRows(table), [table]);
  const suggestions = useMemo(() => suggestQuestions(table, profiles, measure, timeKey), [table, profiles, measure, timeKey]);

  const ask = (q: string) => {
    const question = q.trim();
    if (!question) return;
    const answer = answerQuestion(question, table, profiles, rows, { measure, timeKey });
    setTurns((t) => [{ id: Date.now(), question, answer }, ...t].slice(0, 20));
    setText("");
    inputRef.current?.focus();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(text);
  };

  const addToDashboard = async (a: AskAnswer) => {
    const p = a.plan;
    if (p.agg === "countDistinct") return;
    const x = p.bucket ? timeKey : p.groupBy?.key;
    if (!x) return;
    const spec: ChartSpec = {
      id: `c-ask-${Date.now().toString(36)}`,
      type: p.bucket ? "line" : "column",
      title: a.headline.length < 70 ? a.headline.replace(/\.$/, "") : `${p.understood[0]?.value} ${p.groupBy ? `by ${p.groupBy.name}` : "over time"}`,
      x,
      y: p.agg === "count" ? undefined : p.measure?.key,
      agg: p.agg === "count" ? "count" : (p.agg as ChartSpec["agg"]),
      bucket: p.bucket,
      limit: p.top?.n,
      reason: "Added from a question.",
      options: p.top ? { top: p.top.n, sort: p.top.dir === "asc" ? "value-asc" : "value-desc" } : undefined,
    };
    const charts = record.dashboard.charts;
    await update({ dashboard: { ...record.dashboard, charts: [...charts.filter((c) => c.type !== "table"), spec, ...charts.filter((c) => c.type === "table")] } });
    toast("success", "Chart added to the dashboard.");
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        eyebrow={<DatasetSwitcher base="/ask" currentId={record.id} />}
        title="Ask a question"
        description={`Ask about ${record.name} in plain English. Answers are calculated from your rows, and each one shows exactly what was calculated.`}
      />

      <form onSubmit={submit} className="card flex items-center gap-2 p-2 pl-4 focus-within:border-s1/50">
        <MessageSquareText className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
        <label htmlFor="q" className="sr-only">
          Your question
        </label>
        <input
          id="q"
          ref={inputRef}
          className="min-w-0 flex-1 bg-transparent py-2 text-[15px] text-ink outline-none placeholder:text-ink-faint"
          placeholder={suggestions[0] ? `e.g. ${suggestions[0]}` : "e.g. total amount by category"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          maxLength={200}
        />
        <button type="submit" className="btn-primary px-3" disabled={!text.trim()} aria-label="Ask">
          <ArrowUp className="h-4 w-4" />
        </button>
      </form>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button key={s} className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-ink-soft hover:border-s1/40 hover:text-ink" onClick={() => ask(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {turns.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">
          <p className="font-medium text-ink">What you can ask</p>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            <li>• Totals and averages — “average unit price”</li>
            <li>• Breakdowns — “sales by region”, “region wise sales”</li>
            <li>• Rankings — “top 5 products by quantity”</li>
            <li>• Trends — “monthly trend of revenue”</li>
            <li>• Filters — “revenue of Furniture in North”</li>
            <li>• Periods — “in March 2026”, “in FY 2025-26”, “last 3 months”</li>
            <li>• Counts — “how many customers by region”</li>
            <li>• Comparisons — “compare West and East revenue”</li>
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          {turns.map((t) => (
            <AnswerCard
              key={t.id}
              turn={t}
              onAdd={() => addToDashboard(t.answer)}
              canAdd={t.answer.ok && t.answer.plan.agg !== "countDistinct" && Boolean(t.answer.plan.groupBy || (t.answer.plan.bucket && timeKey))}
              recordId={record.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AnswerCard({ turn, onAdd, canAdd, recordId }: { turn: Turn; onAdd: () => void; canAdd: boolean; recordId: string }) {
  const a = turn.answer;
  const [asTable, setAsTable] = useState(false);
  const [added, setAdded] = useState(false);
  return (
    <article className="card overflow-hidden">
      <div className="border-b border-line bg-sunken/70 px-4 py-2 text-sm text-ink-soft">“{turn.question}”</div>
      <div className="p-4">
        <p className={`text-lg font-semibold leading-snug ${a.ok ? "text-ink" : "text-warn"}`}>{a.headline}</p>
        {a.detail && <p className="mt-1 text-sm text-ink-soft">{a.detail}</p>}

        {a.ok && a.plan.understood.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="flex items-center gap-1 text-ink-faint">
              <Info className="h-3.5 w-3.5" /> Calculated as
            </span>
            {a.plan.understood.map((u) => (
              <span key={u.label + u.value} className="rounded border border-line bg-surface px-2 py-0.5 text-ink-soft">
                <span className="text-ink-faint">{u.label}:</span> {u.value}
              </span>
            ))}
            <span className="text-ink-faint">· {a.rowsUsed.toLocaleString("en-IN")} records</span>
          </div>
        )}
        {a.plan.assumed.map((s) => (
          <p key={s} className="mt-1.5 text-xs text-warn">
            {s}
          </p>
        ))}

        {a.chart && !asTable && (
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              {a.chart.kind === "line" ? (
                <LineChart data={a.chart.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--color-line)" />
                  <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--color-line)" }} minTickGap={12} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => fmtCompact(v)} />
                  <Tooltip formatter={(v) => [a.chart!.format(v as number), ""]} contentStyle={{ borderRadius: 6, fontSize: 12 }} />
                  <Line dataKey="value" stroke="#1d4e89" strokeWidth={2} dot={a.chart.points.length <= 24 ? { r: 3 } : false} />
                </LineChart>
              ) : (
                <BarChart data={a.chart.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--color-line)" />
                  <XAxis
                    dataKey="label"
                    tick={AXIS}
                    tickLine={false}
                    axisLine={{ stroke: "var(--color-line)" }}
                    interval={0}
                    tickFormatter={(v: string) => (v.length > 12 ? v.slice(0, 11) + "…" : v)}
                  />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => fmtCompact(v)} />
                  <Tooltip formatter={(v) => [a.chart!.format(v as number), ""]} contentStyle={{ borderRadius: 6, fontSize: 12 }} cursor={{ fill: "rgba(29,78,137,0.06)" }} />
                  <Bar dataKey="value" fill="#1d4e89" radius={[2, 2, 0, 0]} maxBarSize={44} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
        {a.table && (asTable || !a.chart) && (
          <div className="mt-4 max-h-80 overflow-auto rounded-md border border-line">
            <table className="table tabular-nums">
              <thead>
                <tr>
                  {a.table.headers.map((h, i) => (
                    <th key={h} className={i ? "text-right" : ""}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {a.table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j} className={j ? "text-right" : ""}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {a.ok && (a.chart || canAdd) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {a.chart && a.table && (
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setAsTable(!asTable)}>
                {asTable ? <BarChart3 className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />} {asTable ? "Show chart" : "Show table"}
              </button>
            )}
            {canAdd &&
              (added ? (
                <Link to={`/dashboard/${recordId}`} className="btn-ghost px-2 py-1 text-xs text-good">
                  <LayoutDashboard className="h-3.5 w-3.5" /> Added — open dashboard
                </Link>
              ) : (
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => (onAdd(), setAdded(true))}>
                  <LayoutDashboard className="h-3.5 w-3.5" /> Add to dashboard
                </button>
              ))}
          </div>
        )}
      </div>
    </article>
  );
}
