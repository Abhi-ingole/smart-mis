import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, CalendarRange, ChevronDown, ChevronUp, Lightbulb, MessageSquareText, Plus, RotateCcw, ShieldCheck } from "lucide-react";
import { DatasetGate, DatasetSwitcher, type Loaded } from "../components/DatasetGate";
import { ChartCard, ChartEditor, KpiCard, KpiEditor } from "../components/DashboardParts";
import { FilterBar } from "../components/FilterBar";
import { MonthBars, Panel, QuarterMatrix, VarianceBars } from "../components/Executive";
import { ExportMenu } from "../components/ExportMenu";
import { QualityRing, Segmented, useToast } from "../components/ui";
import { describeFilters, EMPTY_FILTERS, findTimeKey, useView } from "../state/view";
import { useExport } from "../state/useExport";
import { useDatasets } from "../state/datasets";
import { RankedBars } from "../components/Executive";
import { groupBy } from "../engine/analytics";
import { recommendKpis } from "../engine/kpi";
import { recommendCharts } from "../engine/charts";
import { guessYearMode, monthSeries, pickDimension, pickMeasure, quarterMatrix, yearOptions, type ExecMeasure, type YearMode } from "../engine/executive";
import { fmtDate } from "../engine/format";
import { epochDayToIso } from "../engine/values";
import { isNumericType } from "../engine/table";
import { MappingBanner } from "./Mapping";
import type { Filters } from "../engine/types";

export default function DashboardPage() {
  return (
    <DatasetGate base="/dashboard" title="Dashboard">
      {(d) => <Dashboard key={d.record.id} {...d} />}
    </DatasetGate>
  );
}

const DOMAIN_TITLE: Record<string, string> = {
  sales: "Sales performance",
  hr: "People overview",
  academic: "Academic results",
  finance: "Financial overview",
  inventory: "Inventory overview",
  marketing: "Marketing performance",
  generic: "Data overview",
};
const CHARTS_SHOWN = 6;

function Dashboard({ record, analysis, update }: Loaded) {
  const { table, profiles, quality, domain } = analysis;
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [addKpi, setAddKpi] = useState(false);
  const [addChart, setAddChart] = useState(0);
  const [allCharts, setAllCharts] = useState(false);
  const toast = useToast();
  const { datasets } = useDatasets();
  const dash = record.dashboard;
  const timeKey = findTimeKey(record, analysis);

  // Year selection (calendar or Apr–Mar financial year)
  const [yearMode, setYearMode] = useState<YearMode>(() =>
    timeKey
      ? guessYearMode(
          table,
          Array.from({ length: table.rows.length }, (_, i) => i),
          timeKey,
          record.schema,
        )
      : "calendar",
  );
  const [periodId, setPeriodId] = useState<string | null>(null);
  const baseView = useView(record, analysis, filters, null);
  const periods = useMemo(() => (timeKey ? yearOptions(table, baseView.allRows, timeKey, yearMode) : []), [table, baseView.allRows, timeKey, yearMode]);
  const period = periodId === "all" ? null : (periods.find((p) => p.id === periodId) ?? (periods.length > 1 ? periods[0] : null));
  const view = useView(record, analysis, filters, period);
  const { rows, kpiValues, insights } = view;

  // What the executive visuals show
  const [measureKey, setMeasureKey] = useState<string | null>(null);
  const [dimKey, setDimKey] = useState<string | null>(null);
  const measures = record.schema.filter((c) => !c.excluded && c.role === "measure" && isNumericType(c));
  const measure: ExecMeasure = useMemo(() => {
    if (measureKey === "__count") return { agg: "count", name: "Records" };
    const c = measures.find((m) => m.key === measureKey);
    return c ? { key: c.key, agg: c.type === "percentage" || c.semantic === "score" || c.semantic === "rating" ? "avg" : "sum", name: c.name } : pickMeasure(dash.kpis, record.schema);
  }, [measureKey, measures, dash.kpis, record.schema]);
  const measureCol = record.schema.find((c) => c.key === measure.key);
  const dims = record.schema.filter((c) => !c.excluded && c.role === "dimension" && (profiles[c.key]?.distinct ?? 0) >= 2 && (profiles[c.key]?.distinct ?? 0) <= 200);
  const dim = dimKey ?? pickDimension(record.schema, profiles);
  const dimCol = record.schema.find((c) => c.key === dim);

  // A second breakdown beside the matrix, on a different column (e.g. Region next to Category).
  const rankDim = dims.filter((d) => d.key !== dim).sort((a, b) => (profiles[a.key]?.distinct ?? 0) - (profiles[b.key]?.distinct ?? 0))[0];
  const ranked = useMemo(() => {
    if (!rankDim) return null;
    const g = groupBy(table, rows, rankDim.key, measure.agg === "count" ? undefined : measure.key, measure.agg === "count" ? "count" : measure.agg);
    return { items: g.slice(0, 8).map((x) => ({ key: x.key, value: x.value })), total: g.reduce((s, x) => s + x.value, 0), count: g.length };
  }, [table, rows, rankDim, measure]);

  const months = useMemo(() => (timeKey ? monthSeries(table, baseView.allRows, timeKey, measure, period, yearMode) : []), [table, baseView.allRows, timeKey, measure, period, yearMode]);
  const matrixPeriod = period ?? periods[0] ?? null;
  const matrix = useMemo(
    () => (timeKey && dim && matrixPeriod ? quarterMatrix(table, baseView.allRows, timeKey, dim, measure, matrixPeriod) : null),
    [table, baseView.allRows, timeKey, dim, measure, matrixPeriod],
  );

  // Monthly and quarterly views only make sense with at least two months of data.
  const showExec = Boolean(timeKey) && months.filter((p) => p.rows > 0).length >= 2;
  const hasRight = Boolean(matrix && matrixPeriod && dimCol) || Boolean(ranked && rankDim && ranked.items.length > 1);

  const range = useMemo(() => {
    if (!timeKey) return null;
    const t = table.num[timeKey];
    let min = Infinity;
    let max = -Infinity;
    for (const i of rows) {
      const d = t[i];
      if (d === null || d === undefined) continue;
      if (d < min) min = d;
      if (d > max) max = d;
    }
    return Number.isFinite(min) ? { from: fmtDate(epochDayToIso(min)), to: fmtDate(epochDayToIso(max)) } : null;
  }, [table, rows, timeKey]);

  const save = (patch: Partial<typeof dash>) => update({ dashboard: { ...dash, ...patch } });
  const regenerate = async () => {
    await save({ kpis: recommendKpis(record.schema, profiles, domain, table), charts: recommendCharts(record.schema, profiles, domain, table) });
    toast("success", "Dashboard rebuilt from the current column settings.");
  };

  const filtersNote = [period ? period.label : null, describeFilters(filters, record)].filter(Boolean).join("; ") || null;
  const { run, busy, capturing } = useExport(() => ({
    record,
    analysis,
    rows,
    kpiValues,
    insights,
    filtersNote,
    title: domain.domain === "generic" ? `${record.name} — MIS report` : `${record.name} — ${DOMAIN_TITLE[domain.domain]}`,
  }));

  const repeatsExec = (c: (typeof dash.charts)[number]) =>
    showExec && c.x === timeKey && (c.type === "line" || c.type === "area" || c.type === "column") && (c.y ?? null) === (measure.key ?? null) && !c.series;
  const visibleCharts = [...dash.charts.filter((c) => !(c.type === "table" && !c.x) && !repeatsExec(c)), ...dash.charts.filter((c) => repeatsExec(c))];
  const tableCharts = dash.charts.filter((c) => c.type === "table" && !c.x);
  const shownCharts = allCharts || capturing ? visibleCharts : visibleCharts.slice(0, CHARTS_SHOWN);
  const pretty = record.name
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const titleText = domain.domain === "generic" ? pretty : (DOMAIN_TITLE[domain.domain] ?? pretty);

  return (
    <div className="space-y-5">
      {/* Report header */}
      <header className="card flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-side text-white">
            <BarChart3 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-faint">
              {(datasets?.length ?? 0) > 1 ? <DatasetSwitcher base="/dashboard" currentId={record.id} compact /> : <span className="truncate">{record.name}</span>}
            </div>
            <h1 className="truncate text-xl font-semibold tracking-tight text-ink">{titleText}</h1>
            <p className="text-xs text-ink-soft">
              {rows.length.toLocaleString("en-IN")} records
              {range && ` · ${range.from} – ${range.to}`}
              {period && ` · ${period.label}`}
            </p>
          </div>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          {showExec && periods.length > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-line bg-sunken px-2 py-1">
              <CalendarRange className="h-4 w-4 text-ink-faint" aria-hidden />
              <label className="sr-only" htmlFor="yr">
                Year
              </label>
              <select id="yr" className="bg-transparent py-1 text-sm font-medium text-ink outline-none" value={period?.id ?? "all"} onChange={(e) => setPeriodId(e.target.value)}>
                <option value="all">All years</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <Segmented
                size="sm"
                value={yearMode}
                onChange={(m) => (setYearMode(m), setPeriodId(null))}
                options={[
                  { value: "fiscal", label: "FY", title: "Financial year, April to March" },
                  { value: "calendar", label: "Calendar" },
                ]}
              />
            </div>
          )}
          <Link to={`/ask/${record.id}`} className="btn-secondary">
            <MessageSquareText className="h-4 w-4" /> Ask a question
          </Link>
          <ExportMenu onExport={run} busy={busy} primary />
        </div>
      </header>

      <MappingBanner record={record} />

      <FilterBar table={table} profiles={profiles} filters={filters} onChange={setFilters} shown={baseView.allRows.length} total={table.rows.length} />

      {/* KPIs */}
      <section aria-label="Key figures">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="section-title">Key figures</h2>
          <div className="no-print flex gap-1">
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setAddKpi(true)}>
              <Plus className="h-3.5 w-3.5" /> Add KPI
            </button>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={regenerate} title="Recreate KPIs and charts from the current column settings">
              <RotateCcw className="h-3.5 w-3.5" /> Rebuild
            </button>
          </div>
        </div>
        {dash.kpis.length === 0 ? (
          <p className="card p-4 text-sm text-ink-soft">No KPIs. Use “Add KPI” or “Rebuild”.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {dash.kpis.map((k) => (
              <KpiCard
                key={k.id}
                def={k}
                value={kpiValues.find((v) => v.id === k.id)}
                onRemove={() => save({ kpis: dash.kpis.filter((x) => x.id !== k.id) })}
                onRename={(name) => save({ kpis: dash.kpis.map((x) => (x.id === k.id ? { ...x, name } : x)) })}
              />
            ))}
          </div>
        )}
      </section>

      {/* Executive visuals */}
      {showExec && (
        <section aria-label="Performance over time" className="grid gap-4 xl:grid-cols-12">
          <div className={`min-w-0 space-y-4 ${hasRight ? "xl:col-span-5" : "xl:col-span-12"}`}>
            <Panel
              title={`${measure.agg === "count" ? "Records" : measure.name} by month`}
              subtitle={period ? `${period.label}, coloured by quarter` : "Coloured by quarter"}
              right={
                <select
                  className="input no-print w-auto max-w-[11rem] py-1 text-xs"
                  aria-label="Measure"
                  value={measureKey ?? measure.key ?? "__count"}
                  onChange={(e) => setMeasureKey(e.target.value)}
                >
                  {measures.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.name}
                    </option>
                  ))}
                  <option value="__count">Number of records</option>
                </select>
              }
            >
              <div data-capture="" data-capture-title={`${measure.name} by month`} data-capture-note={period?.label} className="bg-white">
                <MonthBars points={months} measure={measure} col={measureCol} mode={yearMode} animate={!capturing} />
              </div>
            </Panel>
            <Panel title="Change over time" subtitle={`${measure.name}, month by month`}>
              <div data-capture="" data-capture-title={`${measure.name}: change by month`} className="bg-white">
                <VarianceBars points={months} measure={measure} col={measureCol} animate={!capturing} />
              </div>
            </Panel>
          </div>
          {hasRight && (
            <div className="flex min-w-0 flex-col gap-4 xl:col-span-7">
              {matrix && matrixPeriod && dimCol ? (
                <Panel
                  title={`${measure.name} by ${dimCol.name} and quarter`}
                  subtitle={`${matrixPeriod.label}${matrix.rows.length >= 10 ? ` · top ${matrix.rows.length - 1} plus others` : ""}`}
                  right={
                    <select className="input no-print w-auto max-w-[11rem] py-1 text-xs" aria-label="Rows" value={dim} onChange={(e) => setDimKey(e.target.value)}>
                      {dims.map((d) => (
                        <option key={d.key} value={d.key}>
                          By {d.name}
                        </option>
                      ))}
                    </select>
                  }
                >
                  <div data-capture="" data-capture-title={`${measure.name} by ${dimCol.name} and quarter`} data-capture-note={matrixPeriod.label} className="bg-white">
                    <QuarterMatrix rows={matrix.rows} total={matrix.total} mode={yearMode} measure={measure} col={measureCol} dimName={dimCol.name} />
                  </div>
                </Panel>
              ) : null}
              {ranked && rankDim && ranked.items.length > 1 && (
                <Panel
                  className="flex-1"
                  title={`${measure.agg === "count" ? "Records" : measure.name} by ${rankDim.name}`}
                  subtitle={`${period ? period.label : "All years"}${ranked.count > ranked.items.length ? ` · top ${ranked.items.length} of ${ranked.count}` : ""}`}
                >
                  <div data-capture="" data-capture-title={`${measure.name} by ${rankDim.name}`} className="bg-white">
                    <RankedBars items={ranked.items} measure={measure} col={measureCol} total={ranked.total} />
                  </div>
                </Panel>
              )}
            </div>
          )}
        </section>
      )}

      {/* Detailed analysis */}
      <div className="grid gap-5 xl:grid-cols-[1fr_20rem]">
        <section aria-label="Charts" className="min-w-0">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="section-title">Detailed analysis</h2>
            <button className="no-print btn-ghost px-2 py-1 text-xs" onClick={() => setAddChart((n) => n + 1)}>
              <Plus className="h-3.5 w-3.5" /> Add chart
            </button>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {[...shownCharts, ...tableCharts].map((c) => (
              <ChartCard
                key={c.id}
                spec={c}
                table={table}
                rows={rows}
                wide={(c.type === "table" && !c.x) || c.type === "heatmap" || (c.measures?.length ?? 0) > 2}
                animate={!capturing}
                onChange={(s) => save({ charts: dash.charts.map((x) => (x.id === c.id ? s : x)) })}
                onRemove={() => save({ charts: dash.charts.filter((x) => x.id !== c.id) })}
              />
            ))}
          </div>
          {visibleCharts.length > CHARTS_SHOWN && (
            <button className="no-print btn-ghost mt-3 w-full border border-dashed border-line" onClick={() => setAllCharts(!allCharts)}>
              {allCharts ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {allCharts ? "Show fewer charts" : `Show all ${visibleCharts.length} charts`}
            </button>
          )}
        </section>

        <aside className="space-y-3" aria-label="Insights">
          <div className="card p-4 xl:sticky xl:top-6">
            <h2 className="panel-title flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-s3" /> Highlights
            </h2>
            <p className="mt-0.5 text-xs text-ink-faint">
              From {rows.length.toLocaleString("en-IN")} records{period ? ` in ${period.label}` : ""}.
            </p>
            {insights.observations.length === 0 ? (
              <p className="mt-3 text-sm text-ink-soft">No notable patterns in this selection.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {insights.observations.slice(0, 5).map((o) => (
                  <li key={o.id} className="py-2.5 text-sm leading-relaxed text-ink first:pt-0">
                    {o.text}
                  </li>
                ))}
              </ul>
            )}
            <Link to={`/insights/${record.id}`} className="mt-2 inline-flex text-sm font-medium text-s1 hover:underline">
              All insights →
            </Link>
          </div>
          <Link to={`/quality/${record.id}`} className="card flex items-center gap-3 p-4 hover:border-line-strong">
            <QualityRing score={quality.score} />
            <div>
              <p className="panel-title flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-s2" /> Data quality
              </p>
              <p className="text-sm text-ink-soft">
                {quality.issues.length === 0
                  ? "No issues found."
                  : `${quality.issues.length} item${quality.issues.length > 1 ? "s" : ""} to review${quality.duplicateRows ? `, ${quality.duplicateRows} duplicate rows` : ""}.`}
              </p>
            </div>
          </Link>
        </aside>
      </div>

      <KpiEditor open={addKpi} schema={record.schema} onClose={() => setAddKpi(false)} onSave={(k) => (save({ kpis: [...dash.kpis, k] }), setAddKpi(false))} />
      {addChart > 0 && (
        <ChartEditor
          key={addChart}
          open
          schema={record.schema}
          onClose={() => setAddChart(0)}
          onSave={(s) => (save({ charts: [...dash.charts.filter((c) => c.type !== "table"), s, ...dash.charts.filter((c) => c.type === "table")] }), setAddChart(0))}
        />
      )}
    </div>
  );
}
