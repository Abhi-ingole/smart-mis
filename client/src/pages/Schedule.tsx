import { useRef, useState } from "react";
import { BellRing, CalendarClock, FileUp, Link2, Mail, Play, RefreshCw, Send, Trash2, Unlink } from "lucide-react";
import { DatasetGate, DatasetSwitcher, type Loaded } from "../components/DatasetGate";
import { Alert, Field, PageHeader, useToast } from "../components/ui";
import { canLinkFiles, linkedFileName, linkFile, refreshDataset, unlinkFile } from "../state/refresh";
import { nextRunAfter, prepareDelivery, useScheduler, type Frequency, type ReportJob } from "../state/scheduler";
import { useDatasets } from "../state/datasets";

export default function SchedulePage() {
  return (
    <DatasetGate base="/schedule" title="Refresh & email">
      {(d) => <Schedule key={d.record.id} {...d} />}
    </DatasetGate>
  );
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FREQ: { value: Frequency; label: string }[] = [
  { value: "weekdays", label: "Every working day (Mon–Fri)" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
  { value: "hourly", label: "Every hour" },
];
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

function Schedule({ record }: Loaded) {
  const toast = useToast();
  const { refresh } = useDatasets();
  const sch = useScheduler();
  const [linked, setLinked] = useState<string | null>(linkedFileName(record.id));
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const job = sch.refreshJobs.find((j) => j.datasetId === record.id);
  const reports = sch.reportJobs.filter((j) => j.datasetId === record.id);
  const [notifyOk, setNotifyOk] = useState(typeof Notification !== "undefined" && Notification.permission === "granted");

  const doRefresh = async (file?: File) => {
    setBusy("refresh");
    try {
      if (file) {
        const r = await refreshDataset(record.id, file);
        await refresh();
        toast("success", `Refreshed: ${r.rows.toLocaleString("en-IN")} rows from ${r.fileName}.${r.sameColumns ? "" : " The columns changed, so the dashboard was rebuilt."}`);
      } else toast("success", `Refreshed: ${await sch.runRefresh(record.id)}.`);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const link = async () => {
    try {
      const name = await linkFile(record.id);
      setLinked(name);
      toast("success", `Linked to ${name}.`);
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast("error", (e as Error).message);
    }
  };

  // New report schedule form
  const [draft, setDraft] = useState<Omit<ReportJob, "id" | "nextRun">>({
    datasetId: record.id,
    format: "pdf",
    recipients: "",
    subject: `${record.name} — MIS report`,
    frequency: "weekdays",
    time: "19:00",
    weekday: 1,
    monthDay: 1,
    refreshFirst: true,
  });
  const set = (p: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...p }));
  const nextPreview = nextRunAfter(draft);

  const sendNow = async () => {
    setBusy("send");
    try {
      const d = await prepareDelivery(record.id, draft.format, draft.recipients, draft.subject);
      window.location.href = d.mailto;
      toast("success", `${d.fileName} downloaded — attach it to the email draft.`);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        eyebrow={<DatasetSwitcher base="/schedule" currentId={record.id} />}
        title="Refresh & email"
        description="Keep this dataset up to date from its source file, and send the report on a schedule."
      />

      <Alert kind="info">
        Schedules run in this browser tab: keep the tab open (it can be in the background). Smart MIS has no server, so it can't run after the tab is closed, and browsers can't send email on their own
        — at the scheduled time the report is downloaded and an email draft is ready to send.
      </Alert>

      {/* Refresh */}
      <section className="card p-5">
        <h2 className="panel-title flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-s1" /> Data refresh
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          {record.refreshedAt ? `Last refreshed ${when(record.refreshedAt)}.` : `Loaded from ${record.fileName}.`} {record.rowCount.toLocaleString("en-IN")} rows. When the columns are unchanged, your
          dashboard, KPIs and column choices are kept.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-md border border-line p-4">
            <p className="text-sm font-medium">Linked file</p>
            {canLinkFiles() ? (
              <>
                <p className="mt-1 text-xs text-ink-soft">{linked ? `Re-reads “${linked}” from your computer each time.` : "Link the source file once; refreshes then read its latest version."}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {linked ? (
                    <>
                      <button className="btn-primary py-1.5" onClick={() => doRefresh()} disabled={busy !== null}>
                        <RefreshCw className={`h-4 w-4 ${busy === "refresh" ? "animate-spin" : ""}`} /> Refresh now
                      </button>
                      <button className="btn-secondary py-1.5" onClick={() => (unlinkFile(record.id), setLinked(null), sch.setRefreshJob(null, record.id))}>
                        <Unlink className="h-4 w-4" /> Unlink
                      </button>
                    </>
                  ) : (
                    <button className="btn-primary py-1.5" onClick={link}>
                      <Link2 className="h-4 w-4" /> Link source file
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-1 text-xs text-ink-soft">This browser can't keep a link to a file (Chrome and Edge can). Use “Refresh from a file” instead.</p>
            )}
          </div>
          <div className="rounded-md border border-line p-4">
            <p className="text-sm font-medium">Refresh from a file</p>
            <p className="mt-1 text-xs text-ink-soft">Pick the updated export (same columns) to replace the rows now.</p>
            <button className="btn-secondary mt-3 py-1.5" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
              <FileUp className="h-4 w-4" /> Choose updated file
            </button>
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt,.json,.pdf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void doRefresh(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {linked && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md bg-sunken px-4 py-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={Boolean(job)}
                onChange={(e) => sch.setRefreshJob(e.target.checked ? { datasetId: record.id, everyMinutes: 15, lastRun: new Date().toISOString() } : null, record.id)}
              />
              Refresh automatically every
            </label>
            <select className="input w-auto py-1" value={job?.everyMinutes ?? 15} disabled={!job} onChange={(e) => sch.setRefreshJob({ ...job!, everyMinutes: Number(e.target.value) }, record.id)}>
              {[5, 15, 30, 60, 180].map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`}
                </option>
              ))}
            </select>
            {job?.lastResult && <span className="text-xs text-ink-soft">Last: {job.lastResult}</span>}
            {job?.error && <span className="text-xs text-bad">{job.error}</span>}
          </div>
        )}
      </section>

      {/* Email reports */}
      <section className="card p-5">
        <h2 className="panel-title flex items-center gap-2">
          <Mail className="h-4 w-4 text-s1" /> Email report
        </h2>
        <p className="mt-1 text-sm text-ink-soft">Send the MIS report as a file, with the key figures written in the email.</p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Send to" htmlFor="to" hint="Separate addresses with commas">
            <input id="to" className="input" type="text" inputMode="email" placeholder="manager@company.com" value={draft.recipients} onChange={(e) => set({ recipients: e.target.value })} />
          </Field>
          <Field label="Subject" htmlFor="subj">
            <input id="subj" className="input" value={draft.subject} maxLength={120} onChange={(e) => set({ subject: e.target.value })} />
          </Field>
          <Field label="Format" htmlFor="fmt" hint={draft.format !== "xlsx" ? "Charts are included when this dataset's dashboard is open at send time." : undefined}>
            <select id="fmt" className="input" value={draft.format} onChange={(e) => set({ format: e.target.value as ReportJob["format"] })}>
              <option value="pdf">PDF report</option>
              <option value="xlsx">Excel workbook</option>
              <option value="pptx">PowerPoint</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Repeat" htmlFor="freq">
              <select id="freq" className="input" value={draft.frequency} onChange={(e) => set({ frequency: e.target.value as Frequency })}>
                {FREQ.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
            {draft.frequency === "weekly" ? (
              <Field label="On" htmlFor="wd">
                <select id="wd" className="input" value={draft.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </Field>
            ) : draft.frequency === "monthly" ? (
              <Field label="On day" htmlFor="md">
                <select id="md" className="input" value={draft.monthDay} onChange={(e) => set({ monthDay: Number(e.target.value) })}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label={draft.frequency === "hourly" ? "Minute past the hour" : "At"} htmlFor="tm">
              <input id="tm" type="time" className="input" value={draft.time} onChange={(e) => set({ time: e.target.value || "19:00" })} />
            </Field>
          </div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={draft.refreshFirst} onChange={(e) => set({ refreshFirst: e.target.checked })} /> Refresh from the linked file first{" "}
          {!linked && <span className="text-ink-faint">(no file linked yet)</span>}
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            className="btn-primary"
            onClick={() => {
              sch.saveReportJob({ ...draft, id: `j-${Date.now().toString(36)}`, nextRun: nextPreview.toISOString() });
              toast("success", `Scheduled. Next report: ${when(nextPreview.toISOString())}.`);
            }}
          >
            <CalendarClock className="h-4 w-4" /> Schedule
          </button>
          <button className="btn-secondary" onClick={sendNow} disabled={busy !== null}>
            <Send className="h-4 w-4" /> {busy === "send" ? "Preparing…" : "Send now"}
          </button>
          {!notifyOk && typeof Notification !== "undefined" && (
            <button className="btn-ghost" onClick={async () => setNotifyOk((await Notification.requestPermission()) === "granted")}>
              <BellRing className="h-4 w-4" /> Notify me when a report is ready
            </button>
          )}
          <span className="text-xs text-ink-faint">Next run would be {when(nextPreview.toISOString())}</span>
        </div>

        {reports.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Schedule</th>
                  <th>To</th>
                  <th>Format</th>
                  <th>Next</th>
                  <th>Last</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {reports.map((j) => (
                  <tr key={j.id}>
                    <td>
                      {FREQ.find((f) => f.value === j.frequency)?.label}
                      {j.frequency === "weekly" && `, ${WEEKDAYS[j.weekday]}`}
                      {j.frequency === "monthly" && `, day ${j.monthDay}`} · {j.time}
                    </td>
                    <td className="max-w-[14rem] truncate">{j.recipients || <span className="text-ink-faint">(choose when sending)</span>}</td>
                    <td className="uppercase">{j.format}</td>
                    <td>{when(j.nextRun)}</td>
                    <td>
                      {when(j.lastRun)}
                      {j.error && <span className="block text-xs text-bad">{j.error}</span>}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <button className="btn-ghost px-2 py-1" title="Run now" aria-label="Run now" onClick={() => sch.runReport(j)}>
                        <Play className="h-4 w-4" />
                      </button>
                      <button className="btn-ghost px-2 py-1 text-bad" title="Delete schedule" aria-label="Delete schedule" onClick={() => sch.removeReportJob(j.id)}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
