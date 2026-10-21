import { useMemo, useRef, useState } from "react";
import { Download, FileDown, Printer } from "lucide-react";
import { toJpeg } from "html-to-image";
import { DatasetGate, DatasetSwitcher, type Loaded } from "../components/DatasetGate";
import { Alert, PageHeader, useToast } from "../components/ui";
import { FilterBar } from "../components/FilterBar";
import { ChartView } from "../components/ChartView";
import { describeFilters, EMPTY_FILTERS, useView } from "../state/view";
import { buildReport, REPORT_SECTIONS, type SectionId } from "../engine/report";
import { download, reportPdf, reportWorkbook, tableCsv } from "../export/exporters";
import { fmtDate } from "../engine/format";
import type { Filters } from "../engine/types";

export default function ReportBuilderPage() {
  return (
    <DatasetGate base="/report" title="Report builder">
      {(d) => <Builder key={d.record.id} {...d} />}
    </DatasetGate>
  );
}

function Builder({ record, analysis }: Loaded) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [title, setTitle] = useState(`${record.name} — MIS Report`);
  const [include, setInclude] = useState<Set<SectionId>>(new Set(REPORT_SECTIONS.map((s) => s.id)));
  const [appendixRows, setAppendixRows] = useState(50);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const { rows, kpiValues, insights } = useView(record, analysis, filters);
  const filtersNote = describeFilters(filters, record);
  const model = useMemo(
    () => buildReport({ meta: record, title, table: analysis.table, rows, profiles: analysis.profiles, quality: analysis.quality, dashboard: record.dashboard, kpiValues, insights, filtersNote, appendixRows }),
    [record, title, analysis, rows, kpiValues, insights, filtersNote, appendixRows],
  );
  const on = (id: SectionId) => include.has(id);
  const fileBase = model.title.replace(/[^\w\- ]+/g, "").trim() || "MIS report";

  const exportPdf = async () => {
    setBusy("pdf");
    setError(null);
    try {
      const images: { title: string; png: string; width: number; height: number }[] = [];
      if (on("trends")) {
        const nodes = previewRef.current?.querySelectorAll<HTMLElement>("[data-report-chart]") ?? [];
        for (const n of nodes) {
          const png = await toJpeg(n, { pixelRatio: 1.6, quality: 0.88, backgroundColor: "#ffffff", cacheBust: true });
          images.push({ title: n.dataset.title ?? "", png, width: n.offsetWidth, height: n.offsetHeight });
        }
      }
      const blob = await reportPdf(model, images, include);
      download(`${fileBase}.pdf`, blob, "application/pdf");
      toast("success", "PDF report downloaded.");
    } catch (e) {
      setError(`Couldn't create the PDF: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const exportExcel = () => {
    download(`${fileBase}.xlsx`, reportWorkbook(model, analysis.table, rows), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    toast("success", "Excel report downloaded.");
  };

  return (
    <div className="space-y-5">
      <div className="no-print">
        <PageHeader
          eyebrow={<DatasetSwitcher base="/report" currentId={record.id} />}
          title="MIS report builder"
          description="The report uses the same calculations as the dashboard. Choose sections, apply filters, then export."
          actions={
            <>
              <button className="btn-secondary" onClick={() => window.print()}>
                <Printer className="h-4 w-4" /> Print
              </button>
              <button className="btn-secondary" onClick={() => download(`${fileBase} - data.csv`, tableCsv(analysis.table, rows), "text/csv;charset=utf-8")}>
                <Download className="h-4 w-4" /> CSV data
              </button>
              <button className="btn-secondary" onClick={exportExcel}>
                <Download className="h-4 w-4" /> Excel report
              </button>
              <button className="btn-primary" onClick={exportPdf} disabled={busy !== null}>
                <FileDown className="h-4 w-4" /> {busy === "pdf" ? "Preparing PDF…" : "PDF report"}
              </button>
            </>
          }
        />
        {error && (
          <div className="mb-4">
            <Alert kind="error">{error}</Alert>
          </div>
        )}
        <FilterBar table={analysis.table} profiles={analysis.profiles} filters={filters} onChange={setFilters} shown={rows.length} total={analysis.table.rows.length} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[17rem_1fr]">
        <aside className="no-print card h-fit space-y-4 p-4 xl:sticky xl:top-6">
          <div>
            <label className="label" htmlFor="rt">
              Report title
            </label>
            <input id="rt" className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <fieldset>
            <legend className="label">Sections</legend>
            <div className="space-y-1.5">
              {REPORT_SECTIONS.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={include.has(s.id)}
                    onChange={(e) =>
                      setInclude((x) => {
                        const n = new Set(x);
                        if (e.target.checked) n.add(s.id);
                        else n.delete(s.id);
                        return n;
                      })
                    }
                  />
                  {s.title}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label className="label" htmlFor="ar">
              Appendix rows
            </label>
            <select id="ar" className="input" value={appendixRows} onChange={(e) => setAppendixRows(Number(e.target.value))}>
              {[25, 50, 100, 250].map((n) => (
                <option key={n} value={n}>
                  First {n} rows
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-faint">All rows are included in the Excel export.</p>
          </div>
        </aside>

        <article ref={previewRef} className="print-page card mx-auto w-full min-w-0 max-w-4xl space-y-8 overflow-hidden bg-white p-6 sm:p-10">
          <header className="border-b-2 border-accent pb-5">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{model.title}</h1>
            <p className="mt-2 text-sm text-ink-soft">Reporting period: {model.periodNote}</p>
            <p className="text-xs text-ink-faint">Generated {fmtDate(model.generatedAt.slice(0, 10))} · Smart MIS</p>
            {model.filtersNote && <p className="mt-1 text-xs text-warn">Filters applied: {model.filtersNote}</p>}
          </header>

          {on("summary") && (
            <Section n="Executive summary">
              <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
                {model.executiveSummary.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </Section>
          )}
          {on("overview") && (
            <Section n="Dataset overview">
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
                {model.overview.map((o) => (
                  <div key={o.label} className="contents">
                    <dt className="text-ink-soft">{o.label}</dt>
                    <dd>{o.value}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}
          {on("kpis") && (
            <Section n="Key performance indicators">
              <div className="grid gap-3 sm:grid-cols-2">
                {model.kpis.map((k) => (
                  <div key={k.name} className="print-avoid rounded-lg border border-line p-3">
                    <p className="text-xs text-ink-soft">{k.name}</p>
                    <p className="text-xl font-semibold">{k.value}</p>
                    {k.comparison && <p className="text-xs text-ink-soft">{k.comparison}</p>}
                    <p className="mt-1 text-[11px] text-ink-faint">{k.formula}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}
          {on("trends") && model.charts.length > 0 && (
            <Section n="Trends and visual analysis">
              <div className="space-y-6">
                {model.charts.map((c) => (
                  <div key={c.id} className="print-avoid">
                    <p className="mb-2 text-sm font-semibold">{c.title}</p>
                    <div data-report-chart data-title={c.title} className="bg-white">
                      <ChartView spec={c} table={analysis.table} rows={rows} height={240} animate={false} />
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}
          {on("categories") && model.categories.length > 0 && (
            <Section n="Category analysis">
              <div className="grid gap-5 md:grid-cols-2">
                {model.categories.map((c) => (
                  <div key={c.title} className="print-avoid">
                    <p className="mb-2 text-sm font-semibold">{c.title}</p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-line text-left text-xs text-ink-soft">
                          <th className="py-1.5 font-medium">{c.dimension}</th>
                          <th className="py-1.5 text-right font-medium">{c.measure}</th>
                          <th className="py-1.5 text-right font-medium">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.rows.map((r) => (
                          <tr key={r.label} className="border-b border-line/60">
                            <td className="py-1.5">{r.label}</td>
                            <td className="py-1.5 text-right">{r.value}</td>
                            <td className="py-1.5 text-right text-ink-soft">{r.share}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </Section>
          )}
          {on("exceptions") && (
            <Section n="Exceptions and anomalies">
              <List items={model.exceptions} empty="No notable exceptions were found by the automatic checks." />
            </Section>
          )}
          {on("quality") && (
            <Section n="Data quality summary">
              <p className="text-sm">
                Quality score <strong>{model.quality.score}/100</strong>. <span className="text-ink-soft">{model.quality.formula}.</span>
              </p>
              <List items={model.quality.issues.map((i) => `${i.severity === "high" ? "High: " : i.severity === "medium" ? "Medium: " : "Low: "}${i.message}`)} empty="No data quality issues were found." />
            </Section>
          )}
          {on("insights") && (
            <Section n="Key insights">
              <List items={model.insights} empty="Not enough data for automatic insights." />
            </Section>
          )}
          {on("recommendations") && (
            <Section n="Recommendations">
              <List items={model.recommendations} empty="No evidence-based recommendations for this dataset." />
            </Section>
          )}
          {on("appendix") && (
            <Section n={`Detailed data appendix (first ${model.appendix.rows.length} of ${model.appendix.total.toLocaleString("en-IN")} rows)`}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-line text-left text-ink-soft">
                      {model.appendix.headers.map((h) => (
                        <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {model.appendix.rows.map((r, i) => (
                      <tr key={i} className="border-b border-line/60">
                        {r.map((v, j) => (
                          <td key={j} className="max-w-[10rem] truncate px-2 py-1">
                            {v ?? "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
        </article>
      </div>
    </div>
  );
}

function Section({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{n}</h2>
      {children}
    </section>
  );
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-ink-soft">{empty}</p>;
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
      {items.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  );
}
