/**
 * Scheduled refresh and report delivery, running in this tab.
 *
 * A static website has no server, so nothing can run after the tab is closed and
 * a browser can't send email by itself. While the tab is open this runs the jobs on
 * time: it re-reads linked files, builds the report file, downloads it, and offers
 * an email draft (and a WhatsApp message) with the summary, ready to send.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Mail, MessageCircle, X } from "lucide-react";
import type { ExportKind } from "../components/ExportMenu";
import { getDataset } from "../storage/db";
import { analyzeRecord } from "../engine/pipeline";
import { allRows } from "../engine/analytics";
import { evaluateKpis } from "../engine/kpi";
import { generateInsights } from "../engine/insights";
import { fmtDate } from "../engine/format";
import type { ReportModel } from "../engine/report";
import { buildModel, makeExport, type ExportInput } from "./useExport";
import { download } from "../export/exporters";
import { refreshDataset, linkedFileName } from "./refresh";
import { useDatasets } from "./datasets";
import { findTimeKey } from "./view";

export type Frequency = "hourly" | "daily" | "weekdays" | "weekly" | "monthly";

export interface RefreshJob {
  datasetId: string;
  everyMinutes: number;
  lastRun?: string;
  lastResult?: string;
  error?: string;
}

export interface ReportJob {
  id: string;
  datasetId: string;
  format: Exclude<ExportKind, "csv">;
  recipients: string;
  subject: string;
  frequency: Frequency;
  time: string; // "18:00"
  weekday: number; // 0 = Sunday (weekly)
  monthDay: number; // 1–28 (monthly)
  refreshFirst: boolean;
  nextRun: string;
  lastRun?: string;
  error?: string;
}

export interface Delivery {
  id: string;
  jobId?: string;
  datasetName: string;
  fileName: string;
  createdAt: string;
  mailto: string;
  whatsapp: string;
}

interface SchedulerState {
  refreshJobs: RefreshJob[];
  reportJobs: ReportJob[];
  deliveries: Delivery[];
  setRefreshJob: (j: RefreshJob | null, datasetId: string) => void;
  saveReportJob: (j: ReportJob) => void;
  removeReportJob: (id: string) => void;
  runReport: (j: ReportJob) => Promise<void>;
  runRefresh: (datasetId: string) => Promise<string>;
  dismiss: (id: string) => void;
}

const Ctx = createContext<SchedulerState | null>(null);

/** Next time a job is due, after `from`. Local time. */
export function nextRunAfter(j: Pick<ReportJob, "frequency" | "time" | "weekday" | "monthDay">, from = new Date()): Date {
  const [hh, mm] = j.time.split(":").map(Number);
  if (j.frequency === "hourly") {
    const d = new Date(from);
    d.setMinutes(mm || 0, 0, 0);
    if (d <= from) d.setHours(d.getHours() + 1);
    return d;
  }
  const d = new Date(from);
  d.setHours(hh, mm, 0, 0);
  const ok = (x: Date) =>
    j.frequency === "weekdays" ? x.getDay() !== 0 && x.getDay() !== 6 : j.frequency === "weekly" ? x.getDay() === j.weekday : j.frequency === "monthly" ? x.getDate() === j.monthDay : true;
  for (let i = 0; i < 400; i++) {
    if (d > from && ok(d)) return d;
    d.setDate(d.getDate() + 1);
    d.setHours(hh, mm, 0, 0);
  }
  return d;
}

/** Short text version of the report for an email body or a WhatsApp message. */
export function summaryText(model: ReportModel, fileName?: string): string {
  const lines = [
    model.title,
    model.period ? `Period: ${fmtDate(model.period.from)} – ${fmtDate(model.period.to)}` : null,
    model.filtersNote ? `Selection: ${model.filtersNote}` : null,
    "",
    "Key figures:",
    ...model.kpis
      .filter((k) => k.value !== "—")
      .slice(0, 8)
      .map((k) => `• ${k.name}: ${k.value}${k.comparison ? ` (${k.comparison})` : ""}`),
  ];
  if (model.insights.length) lines.push("", "Highlights:", ...model.insights.slice(0, 3).map((i) => `• ${i}`));
  lines.push("", `Data quality: ${model.quality.score}/100`);
  if (fileName) lines.push("", `Full report attached: ${fileName}`);
  return lines.filter((l) => l !== null).join("\n");
}

async function inputFor(datasetId: string): Promise<ExportInput> {
  const record = await getDataset(datasetId);
  if (!record) throw new Error("This dataset isn't open any more.");
  const analysis = analyzeRecord(record);
  const rows = allRows(analysis.table);
  const timeKey = findTimeKey(record, analysis);
  const kpiValues = evaluateKpis(record.dashboard.kpis, analysis.table, rows, { quality: analysis.quality }, timeKey);
  const insights = generateInsights(analysis.table, rows, analysis.profiles, analysis.quality, analysis.domain);
  // Charts are pictures of the dashboard, so they're included only when this dataset's dashboard is on screen.
  const root = () => (window.location.pathname.includes(`/dashboard/${datasetId}`) ? document : null);
  return { record, analysis, rows, kpiValues, insights, filtersNote: null, title: `${record.name} — MIS report`, root };
}

export async function prepareDelivery(datasetId: string, format: Exclude<ExportKind, "csv">, recipients: string, subject: string, jobId?: string): Promise<Delivery> {
  const input = await inputFor(datasetId);
  const { name, blob } = await makeExport(format, input);
  download(name, blob, blob.type);
  const text = summaryText(buildModel(input), name);
  const to = recipients
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))
    .join(",");
  const body = text.length > 1800 ? text.slice(0, 1790) + "…" : text;
  return {
    id: `d-${Date.now().toString(36)}`,
    jobId,
    datasetName: input.record.name,
    fileName: name,
    createdAt: new Date().toISOString(),
    mailto: `mailto:${to}?subject=${encodeURIComponent(subject || input.record.name)}&body=${encodeURIComponent(body)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
  };
}

function notify(title: string, body: string) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(title, { body });
  } catch {
    /* notifications unavailable */
  }
}

export function SchedulerProvider({ children }: { children: ReactNode }) {
  const { refresh } = useDatasets();
  const [refreshJobs, setRefreshJobs] = useState<RefreshJob[]>([]);
  const [reportJobs, setReportJobs] = useState<ReportJob[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const running = useRef(new Set<string>());

  const runRefresh = useCallback(
    async (datasetId: string) => {
      const key = `r:${datasetId}`;
      if (running.current.has(key)) return "Already refreshing.";
      running.current.add(key);
      try {
        const r = await refreshDataset(datasetId);
        const msg = `${r.rows.toLocaleString("en-IN")} rows from ${r.fileName}${r.rows !== r.before ? ` (was ${r.before.toLocaleString("en-IN")})` : ""}${r.sameColumns ? "" : " — columns changed, dashboard rebuilt"}`;
        setRefreshJobs((js) => js.map((j) => (j.datasetId === datasetId ? { ...j, lastRun: new Date().toISOString(), lastResult: msg, error: undefined } : j)));
        await refresh();
        return msg;
      } catch (e) {
        const error = (e as Error).message;
        setRefreshJobs((js) => js.map((j) => (j.datasetId === datasetId ? { ...j, lastRun: new Date().toISOString(), error } : j)));
        throw e;
      } finally {
        running.current.delete(key);
      }
    },
    [refresh],
  );

  const runReport = useCallback(
    async (j: ReportJob) => {
      const key = `j:${j.id}`;
      if (running.current.has(key)) return;
      running.current.add(key);
      try {
        if (j.refreshFirst && linkedFileName(j.datasetId)) await runRefresh(j.datasetId).catch(() => undefined);
        const d = await prepareDelivery(j.datasetId, j.format, j.recipients, j.subject, j.id);
        setDeliveries((ds) => [d, ...ds].slice(0, 5));
        notify("Report ready", `${d.fileName} was downloaded. Open Smart MIS to send it.`);
        setReportJobs((js) => js.map((x) => (x.id === j.id ? { ...x, lastRun: d.createdAt, error: undefined, nextRun: nextRunAfter(x).toISOString() } : x)));
      } catch (e) {
        setReportJobs((js) => js.map((x) => (x.id === j.id ? { ...x, error: (e as Error).message, nextRun: nextRunAfter(x).toISOString() } : x)));
      } finally {
        running.current.delete(key);
      }
    },
    [runRefresh],
  );

  // One clock for every job.
  const latest = useRef({ refreshJobs, reportJobs, runReport, runRefresh });
  latest.current = { refreshJobs, reportJobs, runReport, runRefresh };
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      for (const j of latest.current.refreshJobs) {
        const last = j.lastRun ? Date.parse(j.lastRun) : 0;
        if (now - last >= j.everyMinutes * 60_000) void latest.current.runRefresh(j.datasetId).catch(() => undefined);
      }
      for (const j of latest.current.reportJobs) if (Date.parse(j.nextRun) <= now) void latest.current.runReport(j);
    };
    const t = window.setInterval(tick, 20_000);
    return () => window.clearInterval(t);
  }, []);

  const value: SchedulerState = {
    refreshJobs,
    reportJobs,
    deliveries,
    setRefreshJob: (j, datasetId) => setRefreshJobs((js) => [...js.filter((x) => x.datasetId !== datasetId), ...(j ? [j] : [])]),
    saveReportJob: (j) => setReportJobs((js) => [...js.filter((x) => x.id !== j.id), j]),
    removeReportJob: (id) => setReportJobs((js) => js.filter((x) => x.id !== id)),
    runReport,
    runRefresh,
    dismiss: (id) => setDeliveries((ds) => ds.filter((d) => d.id !== id)),
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {deliveries.length > 0 && (
        <div className="no-print fixed bottom-4 right-4 z-40 w-[22rem] max-w-[calc(100vw-2rem)] space-y-2" aria-live="polite">
          {deliveries.slice(0, 2).map((d) => (
            <div key={d.id} className="rounded-lg border border-line bg-surface p-3.5 shadow-[var(--shadow-pop)]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">Report ready to send</p>
                  <p className="truncate text-xs text-ink-soft" title={d.fileName}>
                    {d.fileName} is in your downloads
                  </p>
                </div>
                <button className="rounded p-1 text-ink-faint hover:bg-sunken" aria-label="Dismiss" onClick={() => value.dismiss(d.id)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2.5 flex gap-2">
                <a className="btn-primary flex-1 py-1.5 text-xs" href={d.mailto}>
                  <Mail className="h-3.5 w-3.5" /> Email draft
                </a>
                <a className="btn-secondary flex-1 py-1.5 text-xs" href={d.whatsapp} target="_blank" rel="noreferrer">
                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                </a>
              </div>
              <p className="mt-2 text-[11px] text-ink-faint">Attach the downloaded file to the email before sending.</p>
            </div>
          ))}
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useScheduler() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useScheduler outside provider");
  return v;
}
