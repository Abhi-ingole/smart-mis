import { useState } from "react";
import { Link } from "react-router-dom";
import { Download, FileDown, FileText, Lightbulb, Plus, RotateCcw, ShieldCheck } from "lucide-react";
import { toJpeg } from "html-to-image";
import { DatasetGate, DatasetSwitcher, type Loaded } from "../components/DatasetGate";
import { ChartCard, ChartEditor, KpiCard, KpiEditor } from "../components/DashboardParts";
import { FilterBar } from "../components/FilterBar";
import { Alert, Fingerprint, PageHeader, QualityRing, useToast } from "../components/ui";
import { describeFilters, EMPTY_FILTERS, useView } from "../state/view";
import { recommendKpis } from "../engine/kpi";
import { recommendCharts } from "../engine/charts";
import { download, reportPdf, reportWorkbook, tableCsv } from "../export/exporters";
import { buildReport } from "../engine/report";
import type { Filters } from "../engine/types";

export default function DashboardPage() {
  return (
    <DatasetGate base="/dashboard" title="Auto dashboards">
      {(d) => <Dashboard key={d.record.id} {...d} />}
    </DatasetGate>
  );
}

function Dashboard({ record, analysis, update }: Loaded) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [addKpi, setAddKpi] = useState(false);
  const [addChart, setAddChart] = useState(0);
  const toast = useToast();
  const { rows, kpiValues, insights } = useView(record, analysis, filters);
  const { table, profiles, quality, domain } = analysis;
  const dash = record.dashboard;
  const questions = record.schema.filter((c) => c.ambiguity && !c.ambiguity.resolved && !c.excluded);

  const save = (patch: Partial<typeof dash>) => update({ dashboard: { ...dash, ...patch } });
  const regenerate = async () => {
    await save({ kpis: recommendKpis(record.schema, profiles, domain, table), charts: recommendCharts(record.schema, profiles, domain, table) });
    toast("success", "Dashboard rebuilt from the current columns and types.");
  };
  const [pdfBusy, setPdfBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  /** PDF of exactly what is on screen: KPIs, every chart in its chosen type, insights, quality. */
  const exportPdf = async () => {
    setPdfBusy(true);
    setCapturing(true); // re-render charts without animation so the captured picture is complete
    await new Promise((r) => setTimeout(r, 1600));
    try {
      const images: { title: string; png: string; width: number; height: number }[] = [];
      for (const c of dash.charts) {
        if (c.type === "table" && !c.x) continue; // raw rows go to the appendix instead
        const node = document.querySelector<HTMLElement>(`[data-chart-capture="${CSS.escape(c.id)}"]`);
        if (!node) continue;
        const png = await toJpeg(node, { pixelRatio: 1.6, quality: 0.88, backgroundColor: "#ffffff", cacheBust: true });
        images.push({ title: c.title, png, width: node.offsetWidth, height: node.offsetHeight });
      }
      const model = buildReport({ meta: record, title: `${record.name} — Dashboard`, table, rows, profiles, quality, dashboard: dash, kpiValues, insights, filtersNote: describeFilters(filters, record), appendixRows: 50 });
      const blob = await reportPdf(model, images, new Set(["summary", "kpis", "trends", "categories", "exceptions", "quality", "insights", "recommendations", "appendix"]));
      download(`${record.name.replace(/[^\w\- ]+/g, " ").replace(/\s+/g, " ").trim() || "dashboard"} - dashboard.pdf`, blob, "application/pdf");
      toast("success", `PDF downloaded with ${images.length} chart${images.length === 1 ? "" : "s"}.`);
    } catch (e) {
      toast("error", `Couldn't create the PDF: ${(e as Error).message}`);
    } finally {
      setCapturing(false);
      setPdfBusy(false);
    }
  };
  const exportExcel = () => {
    const model = buildReport({ meta: record, table, rows, profiles, quality, dashboard: dash, kpiValues, insights, filtersNote: describeFilters(filters, record) });
    download(`${record.name}.xlsx`, reportWorkbook(model, table, rows), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<DatasetSwitcher base="/dashboard" currentId={record.id} />}
        title={record.name}
        description={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>{record.rowCount.toLocaleString("en-IN")} rows</span>
            <span>{record.schema.filter((c) => !c.excluded).length} columns</span>
            <span>{domain.domain === "generic" ? "General data — descriptive statistics" : `Looks like ${domain.label.toLowerCase()} data (${domain.evidence.slice(0, 3).join(", ")})`}</span>
            <span className="text-ink-faint">Not saved — cleared when you close this tab</span>
          </div>
        }
        actions={
          <>
            <Link to={`/quality/${record.id}`} className="btn-secondary" title="Data quality score">
              <QualityRing score={quality.score} size={26} /> Quality
            </Link>
            <button className="btn-secondary" onClick={() => download(`${record.name}.csv`, tableCsv(table, rows), "text/csv;charset=utf-8")}>
              <Download className="h-4 w-4" /> CSV
            </button>
            <button className="btn-secondary" onClick={exportPdf} disabled={pdfBusy}>
              <FileDown className="h-4 w-4" /> {pdfBusy ? "Preparing…" : "PDF"}
            </button>
            <button className="btn-secondary" onClick={exportExcel}>
              <Download className="h-4 w-4" /> Excel
            </button>
            <Link to={`/report/${record.id}`} className="btn-primary">
              <FileText className="h-4 w-4" /> MIS report
            </Link>
          </>
        }
      />
      <Fingerprint types={record.schema.filter((c) => !c.excluded).map((c) => c.type)} />

      {questions.length > 0 && (
        <Alert
          kind="warn"
          action={
            <Link to={`/quality/${record.id}?tab=mapping`} className="btn-secondary shrink-0 px-2.5 py-1 text-xs">
              Answer now
            </Link>
          }
        >
          {questions.length} column{questions.length > 1 ? "s are" : " is"} ambiguous ({questions.slice(0, 3).map((c) => c.name).join(", ")}). We used a sensible default, but please confirm so the numbers are right.
        </Alert>
      )}

      <FilterBar table={table} profiles={profiles} filters={filters} onChange={setFilters} shown={rows.length} total={table.rows.length} />

      <section aria-label="Key performance indicators">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-soft">Key figures</h2>
          <div className="no-print flex gap-1">
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setAddKpi(true)}>
              <Plus className="h-3.5 w-3.5" /> Add KPI
            </button>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={regenerate} title="Recreate KPIs and charts from the current column settings">
              <RotateCcw className="h-3.5 w-3.5" /> Rebuild dashboard
            </button>
          </div>
        </div>
        {dash.kpis.length === 0 ? (
          <p className="card p-4 text-sm text-ink-soft">No KPIs. Use “Add KPI” or “Rebuild dashboard”.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

      <div className="grid gap-5 xl:grid-cols-[1fr_20rem]">
        <section aria-label="Charts" className="min-w-0">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink-soft">Charts</h2>
            <button className="no-print btn-ghost px-2 py-1 text-xs" onClick={() => setAddChart((n) => n + 1)}>
              <Plus className="h-3.5 w-3.5" /> Add chart
            </button>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {dash.charts.map((c) => (
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
        </section>

        <aside className="space-y-3" aria-label="Insights">
          <div className="card p-4 xl:sticky xl:top-6">
            <h2 className="flex items-center gap-2 font-semibold">
              <Lightbulb className="h-4 w-4 text-accent" /> Insights
            </h2>
            <p className="mt-0.5 text-xs text-ink-faint">Calculated from the {filtersActiveText(rows.length, table.rows.length)}.</p>
            {insights.observations.length === 0 ? (
              <p className="mt-3 text-sm text-ink-soft">Not enough data for automatic insights.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {insights.observations.slice(0, 5).map((o) => (
                  <li key={o.id} className="border-l-2 border-accent/40 pl-3 text-sm leading-relaxed">
                    {o.text}
                  </li>
                ))}
              </ul>
            )}
            <Link to={`/insights/${record.id}`} className="mt-4 inline-flex text-sm text-accent hover:underline">
              All insights and recommendations
            </Link>
          </div>
          <div className="card p-4">
            <h2 className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="h-4 w-4 text-accent" /> Data quality
            </h2>
            <div className="mt-3 flex items-center gap-3">
              <QualityRing score={quality.score} />
              <p className="text-sm text-ink-soft">
                {quality.issues.length === 0 ? "No issues found." : `${quality.issues.length} issue${quality.issues.length > 1 ? "s" : ""} to review${quality.duplicateRows ? `, including ${quality.duplicateRows} duplicate rows` : ""}.`}
              </p>
            </div>
          </div>
        </aside>
      </div>

      <KpiEditor open={addKpi} schema={record.schema} onClose={() => setAddKpi(false)} onSave={(k) => (save({ kpis: [...dash.kpis, k] }), setAddKpi(false))} />
      {addChart > 0 && <ChartEditor key={addChart} open schema={record.schema} onClose={() => setAddChart(0)} onSave={(s) => (save({ charts: [...dash.charts.filter((c) => c.type !== "table"), s, ...dash.charts.filter((c) => c.type === "table")] }), setAddChart(0))} />}
    </div>
  );
}

const filtersActiveText = (shown: number, total: number) => (shown === total ? `${total.toLocaleString("en-IN")} rows` : `${shown.toLocaleString("en-IN")} filtered rows`);
