import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { Copy, FileDown, ImageDown, Mail, MessageCircle, RefreshCw, Send } from "lucide-react";
import { toPng } from "html-to-image";
import { api, qs } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDateTime, fmtInt, fmtPct, prettyDate, type KpiKey } from "../lib/format";
import { Alert, PageHeader, Spinner } from "../components/ui";

interface Change {
  direction: "up" | "down" | "flat" | "none";
  words: string;
}
interface ReportData {
  companyName: string;
  date: string;
  prettyDate: string;
  kpis: Record<KpiKey, number> & { entries: number };
  changes: Record<KpiKey, Change>;
  previousLabel: string;
  campaigns: { campaign: string; waRecipients: number; waDelivered: number; emailSent: number; emailOpened: number }[];
  summarySource: "ai" | "template";
  summaryModel?: string;
}
interface Report {
  id: number;
  reportDate: string;
  kind: "manual" | "auto";
  data: ReportData;
  summary: string;
  whatsappText: string;
  waLinks: { number: string; url: string }[];
  sentVia: string | null;
  sentTo: string | null;
  createdAt: string;
}
interface HistoryRow {
  id: number;
  reportDate: string;
  kind: string;
  summary: string;
  sentVia: string | null;
  sentTo: string | null;
  createdAt: string;
}

function todayLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const SENT_LABEL: Record<string, string> = { email: "Email", whatsapp_link: "WhatsApp link", whatsapp_api: "WhatsApp API" };

export default function ReportsPage() {
  const { can } = useAuth();
  const [date, setDate] = useState(todayLocal());
  const [report, setReport] = useState<Report | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [caps, setCaps] = useState<{ ai: boolean; email: boolean; whatsappApi: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(() => {
    api.get<{ reports: HistoryRow[] }>(`/api/reports${qs({ limit: 30 })}`).then((r) => setHistory(r.reports));
  }, []);

  const openReport = useCallback(async (id: number) => {
    const r = await api.get<{ report: Report; logo: string | null }>(`/api/reports/${id}`);
    setReport(r.report);
    setLogo(r.logo);
    setDate(r.report.reportDate);
  }, []);

  useEffect(() => {
    loadHistory();
    api.get<typeof caps>("/api/reports/capabilities").then(setCaps);
  }, [loadHistory]);

  // When the date changes, show the latest stored report for it (if any).
  useEffect(() => {
    let alive = true;
    api.get<{ reports: HistoryRow[] }>(`/api/reports${qs({ date, limit: 1 })}`).then(async (r) => {
      if (!alive) return;
      if (r.reports[0]) await openReport(r.reports[0].id);
      else setReport(null);
    });
    return () => {
      alive = false;
    };
  }, [date, openReport]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const generate = () =>
    run("generate", async () => {
      const r = await api.post<{ report: Report; logo: string | null }>("/api/reports", { date });
      setReport(r.report);
      setLogo(r.logo);
      loadHistory();
      setNotice({ kind: "success", text: r.report.data.summarySource === "ai" ? "Report ready. Summary written by AI from the calculated numbers." : "Report ready. Summary uses the standard template." });
    });

  const renderPng = async () => {
    if (!cardRef.current) throw new Error("Report card not ready.");
    return toPng(cardRef.current, { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: true });
  };

  const download = (url: string, name: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  };

  const mark = async (via: string) => {
    if (report && can("edit")) await api.post(`/api/reports/${report.id}/shared`, { via }).catch(() => undefined);
  };

  const copyText = () =>
    run("copy", async () => {
      await navigator.clipboard.writeText(report!.whatsappText);
      void mark("copy");
      setNotice({ kind: "success", text: "WhatsApp text copied. Paste it into the chat." });
    });

  const openWhatsapp = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
    void mark("whatsapp_link").then(loadHistory);
  };

  const downloadPng = () =>
    run("png", async () => {
      download(await renderPng(), `mis-report-${report!.reportDate}.png`);
      void mark("png");
    });

  const downloadPdf = () =>
    run("pdf", async () => {
      const png = await renderPng();
      const { jsPDF } = await import("jspdf");
      const img = new Image();
      img.src = png;
      await img.decode();
      const w = img.width / 2;
      const h = img.height / 2;
      const pdf = new jsPDF({ orientation: w > h ? "l" : "p", unit: "pt", format: [w + 48, h + 48] });
      pdf.addImage(png, "PNG", 24, 24, w, h);
      pdf.save(`mis-report-${report!.reportDate}.pdf`);
      void mark("pdf");
    });

  const sendEmail = () =>
    run("email", async () => {
      let image: string | undefined;
      try {
        image = await renderPng();
      } catch {
        image = undefined; // server sends the HTML version alone
      }
      const r = await api.post<{ to: string[] }>(`/api/reports/${report!.id}/email`, image ? { image } : {});
      setNotice({ kind: "success", text: `Emailed to ${r.to.join(", ")}.` });
      loadHistory();
    });

  const sendWaApi = () =>
    run("waapi", async () => {
      const r = await api.post<{ results: { to: string; ok: boolean; error?: string }[] }>(`/api/reports/${report!.id}/whatsapp`);
      const ok = r.results.filter((x) => x.ok).length;
      const failed = r.results.filter((x) => !x.ok);
      setNotice({ kind: failed.length ? "error" : "success", text: `Sent to ${ok} number(s).${failed.length ? ` Failed: ${failed.map((f) => `${f.to} (${f.error})`).join(", ")}` : ""}` });
      loadHistory();
    });

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Pick a day, generate the report card, then share it on WhatsApp or by email." />

      <div className="panel flex flex-wrap items-end gap-3 p-3">
        <label className="text-xs text-ink-soft">
          Report date
          <input type="date" className="input mt-1 w-auto" value={date} max={todayLocal()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        {can("edit") && (
          <button className="btn-primary" onClick={generate} disabled={busy !== null}>
            <RefreshCw className={`h-4 w-4 ${busy === "generate" ? "animate-spin" : ""}`} />
            {busy === "generate" ? "Generating…" : report ? "Regenerate report" : "Generate report"}
          </button>
        )}
        {caps && !caps.ai && <p className="text-xs text-ink-faint">AI is off (no Groq key) — summaries use the standard template.</p>}
      </div>

      {notice && (
        <Alert kind={notice.kind} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}

      {report ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,44rem)_1fr]">
          <div className="overflow-x-auto">
            <ReportCard ref={cardRef} report={report} logo={logo} />
          </div>
          <aside className="space-y-4">
            <div className="panel space-y-2 p-4">
              <h2 className="text-sm font-semibold">Share</h2>
              <button className="btn-secondary w-full justify-start" onClick={copyText} disabled={busy !== null}>
                <Copy className="h-4 w-4" /> Copy WhatsApp text
              </button>
              {report.waLinks.map((l) => (
                <button key={l.number || "any"} className="btn-secondary w-full justify-start" onClick={() => openWhatsapp(l.url)}>
                  <MessageCircle className="h-4 w-4 text-wa" /> Open in WhatsApp{l.number ? ` (+${l.number})` : ""}
                </button>
              ))}
              <button className="btn-secondary w-full justify-start" onClick={downloadPng} disabled={busy !== null}>
                <ImageDown className="h-4 w-4" /> {busy === "png" ? "Preparing…" : "Download PNG"}
              </button>
              <button className="btn-secondary w-full justify-start" onClick={downloadPdf} disabled={busy !== null}>
                <FileDown className="h-4 w-4" /> {busy === "pdf" ? "Preparing…" : "Download PDF"}
              </button>
              {can("edit") && (
                <button className="btn-secondary w-full justify-start" onClick={sendEmail} disabled={busy !== null || (caps !== null && !caps.email)} title={caps && !caps.email ? "Email isn't configured on the server" : undefined}>
                  <Mail className="h-4 w-4 text-mail" /> {busy === "email" ? "Sending…" : "Send email now"}
                </button>
              )}
              {can("edit") && caps?.whatsappApi && (
                <button className="btn-secondary w-full justify-start" onClick={sendWaApi} disabled={busy !== null}>
                  <Send className="h-4 w-4 text-wa" /> {busy === "waapi" ? "Sending…" : "Send via WhatsApp API"}
                </button>
              )}
              {caps && !caps.email && <p className="text-xs text-ink-faint">Email sending needs GMAIL_USER and GMAIL_APP_PASSWORD in the server's .env.</p>}
            </div>
            <details className="panel p-4 text-sm">
              <summary className="cursor-pointer font-semibold">WhatsApp message text</summary>
              <pre className="mt-3 whitespace-pre-wrap font-sans text-xs leading-relaxed text-ink-soft">{report.whatsappText}</pre>
            </details>
            <p className="text-xs text-ink-faint">
              Generated {fmtDateTime(report.createdAt)} ({report.kind === "auto" ? "automatic" : "manual"}).
              {report.data.summarySource === "ai" ? ` Summary by ${report.data.summaryModel}; every number in it was checked against the calculated KPIs.` : " Summary from the standard template."}
            </p>
          </aside>
        </div>
      ) : (
        <div className="panel p-8 text-center text-sm text-ink-soft">
          No report for {prettyDate(date)} yet.{can("edit") ? " Generate one to see the card." : " Ask a member or admin to generate it."}
        </div>
      )}

      <section className="panel">
        <h2 className="border-b border-line px-4 py-3 text-base font-semibold">History</h2>
        {history === null ? (
          <div className="px-4">
            <Spinner />
          </div>
        ) : history.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-soft">No reports generated yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Report date</th>
                  <th>Type</th>
                  <th>Sent via</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className={report?.id === h.id ? "bg-mail-soft/50" : ""}>
                    <td className="whitespace-nowrap">{prettyDate(h.reportDate)}</td>
                    <td className="capitalize">{h.kind}</td>
                    <td>{h.sentVia ? h.sentVia.split(",").map((v) => SENT_LABEL[v] ?? v).join(", ") : <span className="text-ink-faint">Not sent</span>}</td>
                    <td className="whitespace-nowrap text-ink-soft">{fmtDateTime(h.createdAt)}</td>
                    <td className="text-right">
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => openReport(h.id)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {busy === "generate" && !report && <Spinner label="Calculating KPIs and writing the summary…" />}
    </div>
  );
}

/** The branded card — this exact element becomes the PNG/PDF. Inline-safe styles only. */
const ReportCard = forwardRef<HTMLDivElement, { report: Report; logo: string | null }>(function ReportCard({ report, logo }, ref) {
  const d = report.data;
  const k = d.kpis;
  const row = (label: string, value: string, change: Change) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-line py-2.5 last:border-0">
      <span className="text-sm text-ink-soft">{label}</span>
      <span className="text-right">
        <span className="block text-xl font-semibold tracking-tight text-ink">{value}</span>
        <span className={`block text-[11px] font-medium ${change.direction === "up" ? "text-up" : change.direction === "down" ? "text-down" : "text-ink-faint"}`}>
          {change.direction === "up" ? "▲ " : change.direction === "down" ? "▼ " : ""}
          {change.words}
        </span>
      </span>
    </div>
  );
  return (
    <div ref={ref} className="w-[44rem] min-w-[44rem] overflow-hidden rounded-xl border border-line bg-white text-ink">
      <div className="flex items-center justify-between gap-4 bg-rail px-7 py-5 text-white">
        <div className="flex items-center gap-3">
          {logo ? <img src={logo} alt="" className="h-10 w-10 rounded bg-white object-contain p-0.5" /> : <img src="/favicon.svg" alt="" className="h-10 w-10" />}
          <div>
            <p className="text-lg font-semibold leading-tight">{d.companyName}</p>
            <p className="text-xs text-white/60">Daily MIS report</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium">{d.prettyDate}</p>
          <p className="text-xs text-white/60">Compared with {d.previousLabel}</p>
        </div>
      </div>

      <div className="grid grid-cols-2">
        <div className="border-r border-line px-7 py-5">
          <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-wa">
            <span className="h-2.5 w-2.5 rounded-full bg-wa" /> WhatsApp
          </p>
          {row("Sent", fmtInt(k.waSent), d.changes.waSent)}
          {row("Delivered", fmtInt(k.waDelivered), d.changes.waDelivered)}
          {row("Delivery rate", fmtPct(k.deliveryPct), d.changes.deliveryPct)}
        </div>
        <div className="px-7 py-5">
          <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-mail">
            <span className="h-2.5 w-2.5 rounded-sm bg-mail" /> Email
          </p>
          {row("Sent", fmtInt(k.emailSent), d.changes.emailSent)}
          {row("Opened", fmtInt(k.emailOpened), d.changes.emailOpened)}
          {row("Open rate", fmtPct(k.openPct), d.changes.openPct)}
        </div>
      </div>

      <div className="border-t border-line bg-canvas/60 px-7 py-5">
        <p className="text-sm font-semibold">Summary</p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{report.summary}</p>
      </div>

      {d.campaigns.length > 1 && (
        <div className="border-t border-line px-7 py-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-faint">
                <th className="pb-1 font-medium">Campaign</th>
                <th className="pb-1 text-right font-medium">WA sent</th>
                <th className="pb-1 text-right font-medium">Delivered</th>
                <th className="pb-1 text-right font-medium">Emails</th>
                <th className="pb-1 text-right font-medium">Opened</th>
              </tr>
            </thead>
            <tbody>
              {d.campaigns.map((c) => (
                <tr key={c.campaign}>
                  <td className="py-0.5">{c.campaign}</td>
                  <td className="py-0.5 text-right">{fmtInt(c.waRecipients)}</td>
                  <td className="py-0.5 text-right">{fmtInt(c.waDelivered)}</td>
                  <td className="py-0.5 text-right">{fmtInt(c.emailSent)}</td>
                  <td className="py-0.5 text-right">{fmtInt(c.emailOpened)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-line px-7 py-2.5 text-[10px] text-ink-faint">Figures calculated from entered data · Smart MIS</p>
    </div>
  );
});
