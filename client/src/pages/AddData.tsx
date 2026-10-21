import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { FileUp, Pencil, Trash2, FileSearch } from "lucide-react";
import { api, ApiError, qs } from "../lib/api";
import { addDays, fmtInt, fmtPct, prettyDate } from "../lib/format";
import { Alert, ChannelTag, Field, Modal, PageHeader, Spinner } from "../components/ui";

type FieldKey = "waRecipients" | "waDelivered" | "emailSent" | "emailOpened";
interface Entry {
  id: number;
  reportDate: string;
  campaign: string;
  waRecipients: number;
  waDelivered: number;
  emailSent: number;
  emailOpened: number;
  notes: string | null;
  waSourceFile: string | null;
  emailSourceFile: string | null;
  waExtractedJson: string | null;
  emailExtractedJson: string | null;
  updatedAt: string;
}
interface Extraction {
  channel: "wa" | "email";
  method: "rows" | "ai" | "rules" | "ai-vision" | "none";
  model?: string;
  fields: Partial<Record<FieldKey, { value: number | null; source: string | null }>>;
  warnings: string[];
  preview: string[];
}
interface Upload {
  storedName: string;
  originalName: string;
  extraction: Extraction;
}

const LABEL: Record<FieldKey, string> = {
  waRecipients: "Sent (recipients)",
  waDelivered: "Delivered",
  emailSent: "Sent",
  emailOpened: "Opened",
};
const METHOD: Record<Extraction["method"], string> = {
  rows: "Counted rows in the file",
  ai: "Read by AI, checked against the file",
  rules: "Matched by keywords",
  "ai-vision": "Read from screenshot by AI",
  none: "Not read automatically",
};

type FormState = { reportDate: string; campaign: string; notes: string } & Record<FieldKey, string>;

function todayLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const emptyForm = (date: string): FormState => ({ reportDate: date, campaign: "", notes: "", waRecipients: "", waDelivered: "", emailSent: "", emailOpened: "" });

function validateForm(f: FormState, today: string) {
  const errs: Partial<Record<keyof FormState, string>> = {};
  if (!f.reportDate) errs.reportDate = "Pick a date";
  else if (f.reportDate > today) errs.reportDate = "Date cannot be in the future";
  if (!f.campaign.trim()) errs.campaign = "Name the campaign";
  for (const k of ["waRecipients", "waDelivered", "emailSent", "emailOpened"] as FieldKey[]) {
    const v = f[k];
    if (v === "") errs[k] = "Enter a number (0 if none)";
    else if (!/^\d+$/.test(v)) errs[k] = "Whole number, not negative";
  }
  const n = (k: FieldKey) => Number(f[k] || 0);
  if (!errs.waDelivered && n("waDelivered") > n("waRecipients")) errs.waDelivered = "Can't be more than sent";
  if (!errs.emailOpened && n("emailOpened") > n("emailSent")) errs.emailOpened = "Can't be more than sent";
  return errs;
}

export default function AddDataPage() {
  const today = todayLocal();
  const [form, setForm] = useState<FormState>(emptyForm(today));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [campaigns, setCampaigns] = useState<string[]>([]);
  const [uploads, setUploads] = useState<{ wa?: Upload; email?: Upload }>({});
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [duplicate, setDuplicate] = useState<Entry | null>(null);
  const [toDelete, setToDelete] = useState<Entry | null>(null);

  const errors = useMemo(() => validateForm(form, today), [form, today]);
  const hasErrors = Object.keys(errors).length > 0;

  const loadEntries = useCallback(async (date: string) => {
    setEntries(null);
    const r = await api.get<{ entries: Entry[] }>(`/api/metrics${qs({ date })}`);
    setEntries(r.entries);
  }, []);

  useEffect(() => {
    void loadEntries(form.reportDate);
  }, [form.reportDate, loadEntries]);

  useEffect(() => {
    api.get<{ campaigns: string[] }>("/api/metrics/campaigns").then((r) => setCampaigns(r.campaigns)).catch(() => undefined);
  }, []);

  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const onExtracted = (channel: "wa" | "email", u: Upload) => {
    setUploads((s) => ({ ...s, [channel]: u }));
    setForm((f) => {
      const next = { ...f };
      for (const [k, v] of Object.entries(u.extraction.fields)) if (v && v.value !== null) next[k as FieldKey] = String(v.value);
      return next;
    });
  };

  const payload = () => ({
    reportDate: form.reportDate,
    campaign: form.campaign.trim(),
    waRecipients: Number(form.waRecipients),
    waDelivered: Number(form.waDelivered),
    emailSent: Number(form.emailSent),
    emailOpened: Number(form.emailOpened),
    notes: form.notes.trim() || null,
    // Keep the source files of an entry being edited unless a new file was uploaded.
    waSourceFile: uploads.wa?.storedName ?? editingEntry?.waSourceFile ?? null,
    emailSourceFile: uploads.email?.storedName ?? editingEntry?.emailSourceFile ?? null,
    waExtractedJson: uploads.wa ? JSON.stringify({ file: uploads.wa.originalName, ...uploads.wa.extraction, preview: undefined }) : (editingEntry?.waExtractedJson ?? null),
    emailExtractedJson: uploads.email ? JSON.stringify({ file: uploads.email.originalName, ...uploads.email.extraction, preview: undefined }) : (editingEntry?.emailExtractedJson ?? null),
  });

  const resetAfterSave = (text: string) => {
    setNotice({ kind: "success", text });
    setForm(emptyForm(form.reportDate));
    setUploads({});
    setEditingId(null);
    setEditingEntry(null);
    setTouched(false);
    void loadEntries(form.reportDate);
  };

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setTouched(true);
    if (hasErrors) return;
    setSaving(true);
    setNotice(null);
    try {
      if (editingId) {
        await api.put(`/api/metrics/${editingId}`, payload());
        resetAfterSave("Entry updated.");
      } else {
        await api.post("/api/metrics", payload());
        resetAfterSave("Entry saved.");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.body?.code === "DUPLICATE") setDuplicate(err.body.existing as Entry);
      else setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const updateExisting = async () => {
    if (!duplicate) return;
    setSaving(true);
    try {
      await api.put(`/api/metrics/${duplicate.id}`, payload());
      setDuplicate(null);
      resetAfterSave("Existing entry updated.");
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
      setDuplicate(null);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (en: Entry) => {
    setEditingId(en.id);
    setEditingEntry(en);
    setUploads({});
    setForm({
      reportDate: en.reportDate,
      campaign: en.campaign,
      notes: en.notes ?? "",
      waRecipients: String(en.waRecipients),
      waDelivered: String(en.waDelivered),
      emailSent: String(en.emailSent),
      emailOpened: String(en.emailOpened),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await api.del(`/api/metrics/${toDelete.id}`);
      setNotice({ kind: "success", text: `Deleted “${toDelete.campaign}”.` });
      if (editingId === toDelete.id) {
        setEditingId(null);
    setEditingEntry(null);
        setForm(emptyForm(form.reportDate));
      }
      void loadEntries(form.reportDate);
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      setToDelete(null);
    }
  };

  const err = (k: keyof FormState) => (touched ? errors[k] : undefined);
  const deliveryPct = Number(form.waRecipients) ? (Number(form.waDelivered) / Number(form.waRecipients)) * 100 : null;
  const openPct = Number(form.emailSent) ? (Number(form.emailOpened) / Number(form.emailSent)) * 100 : null;
  const dayTotals = (entries ?? []).reduce((a, e) => ({ wa: a.wa + e.waRecipients, wd: a.wd + e.waDelivered, es: a.es + e.emailSent, eo: a.eo + e.emailOpened }), { wa: 0, wd: 0, es: 0, eo: 0 });

  return (
    <div>
      <PageHeader
        title={editingId ? "Edit entry" : "Add daily data"}
        description="Upload the vendor files and check the numbers we read, or type them in. Several campaigns on one day are added together on the dashboard."
      />

      {notice && (
        <div className="mb-4">
          <Alert kind={notice.kind} onClose={() => setNotice(null)}>
            {notice.text}
          </Alert>
        </div>
      )}

      <form onSubmit={save} noValidate className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <section className="panel grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Date" htmlFor="date" error={err("reportDate")}>
              <input id="date" type="date" max={today} className="input" value={form.reportDate} onChange={(e) => set("reportDate", e.target.value)} />
            </Field>
            <Field label="Campaign" htmlFor="campaign" error={err("campaign")} hint="Same date + same campaign updates one entry">
              <input id="campaign" list="campaigns" className="input" value={form.campaign} maxLength={100} onChange={(e) => set("campaign", e.target.value)} placeholder="e.g. Festive Offer" />
              <datalist id="campaigns">
                {campaigns.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
          </section>

          <ChannelBlock
            channel="wa"
            title="WhatsApp"
            fields={["waRecipients", "waDelivered"]}
            form={form}
            set={set}
            err={err}
            upload={uploads.wa}
            onExtracted={(u) => onExtracted("wa", u)}
            rate={deliveryPct}
            rateLabel="Delivery rate"
          />
          <ChannelBlock
            channel="email"
            title="Email"
            fields={["emailSent", "emailOpened"]}
            form={form}
            set={set}
            err={err}
            upload={uploads.email}
            onExtracted={(u) => onExtracted("email", u)}
            rate={openPct}
            rateLabel="Open rate"
          />

          <section className="panel p-5">
            <Field label="Notes (optional)" htmlFor="notes">
              <textarea id="notes" rows={2} maxLength={1000} className="input" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything the boss should know about today's numbers" />
            </Field>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn-primary" disabled={saving}>
                {saving ? "Saving…" : editingId ? "Save changes" : "Save entry"}
              </button>
              {(editingId || form.campaign || uploads.wa || uploads.email) && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setEditingId(null);
    setEditingEntry(null);
                    setUploads({});
                    setForm(emptyForm(form.reportDate));
                    setTouched(false);
                  }}
                >
                  {editingId ? "Cancel editing" : "Clear form"}
                </button>
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-3">
          <div className="panel p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">{prettyDate(form.reportDate || today)}</h2>
              <div className="flex gap-1 text-xs">
                <button type="button" className="btn-ghost px-2 py-1" onClick={() => set("reportDate", addDays(form.reportDate || today, -1))}>
                  Previous day
                </button>
                {form.reportDate < today && (
                  <button type="button" className="btn-ghost px-2 py-1" onClick={() => set("reportDate", addDays(form.reportDate, 1))}>
                    Next day
                  </button>
                )}
              </div>
            </div>
            {entries === null ? (
              <Spinner />
            ) : entries.length === 0 ? (
              <p className="py-6 text-sm text-ink-soft">Nothing entered for this day yet.</p>
            ) : (
              <>
                <ul className="mt-3 divide-y divide-line">
                  {entries.map((en) => (
                    <li key={en.id} className={`py-3 ${editingId === en.id ? "rounded bg-mail-soft/60 px-2" : ""}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">{en.campaign}</p>
                        <div className="flex shrink-0 gap-1">
                          <button type="button" className="rounded p-1 text-ink-faint hover:bg-canvas hover:text-ink" onClick={() => startEdit(en)} aria-label={`Edit ${en.campaign}`}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" className="rounded p-1 text-ink-faint hover:bg-bad-soft hover:text-down" onClick={() => setToDelete(en)} aria-label={`Delete ${en.campaign}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-ink-soft">
                        <span className="text-wa">WA</span> {fmtInt(en.waDelivered)} / {fmtInt(en.waRecipients)} · <span className="text-mail">Email</span> {fmtInt(en.emailOpened)} / {fmtInt(en.emailSent)}
                      </p>
                      {en.notes && <p className="mt-1 text-xs italic text-ink-faint">{en.notes}</p>}
                      {(en.waSourceFile || en.emailSourceFile) && (
                        <p className="mt-1 flex gap-3 text-xs">
                          {en.waSourceFile && (
                            <a className="text-wa hover:underline" href={`/api/files/${en.waSourceFile}`}>
                              WhatsApp source file
                            </a>
                          )}
                          {en.emailSourceFile && (
                            <a className="text-mail hover:underline" href={`/api/files/${en.emailSourceFile}`}>
                              Email source file
                            </a>
                          )}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
                {entries.length > 1 && (
                  <div className="mt-2 border-t border-line pt-3 text-xs text-ink-soft">
                    Day total: WA {fmtInt(dayTotals.wd)} of {fmtInt(dayTotals.wa)} delivered ({fmtPct(dayTotals.wa ? (dayTotals.wd / dayTotals.wa) * 100 : 0)}), email {fmtInt(dayTotals.eo)} of {fmtInt(dayTotals.es)} opened (
                    {fmtPct(dayTotals.es ? (dayTotals.eo / dayTotals.es) * 100 : 0)})
                  </div>
                )}
              </>
            )}
          </div>
        </aside>
      </form>

      <Modal
        open={Boolean(duplicate)}
        title="Update existing entry?"
        onClose={() => setDuplicate(null)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setDuplicate(null)}>
              Keep existing
            </button>
            <button className="btn-primary" onClick={updateExisting} disabled={saving}>
              Replace with new numbers
            </button>
          </>
        }
      >
        {duplicate && (
          <div className="space-y-3">
            <p>
              “{duplicate.campaign}” already has an entry on {prettyDate(duplicate.reportDate)}. Replace it with the numbers you just entered?
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th className="text-right">Existing</th>
                  <th className="text-right">New</th>
                </tr>
              </thead>
              <tbody>
                {(["waRecipients", "waDelivered", "emailSent", "emailOpened"] as FieldKey[]).map((k) => (
                  <tr key={k}>
                    <td className="text-ink-soft">
                      {k.startsWith("wa") ? "WhatsApp" : "Email"} {LABEL[k].toLowerCase()}
                    </td>
                    <td className="text-right">{fmtInt(duplicate[k])}</td>
                    <td className="text-right font-medium">{fmtInt(Number(form[k]))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(toDelete)}
        title="Delete entry?"
        onClose={() => setToDelete(null)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setToDelete(null)}>
              Cancel
            </button>
            <button className="btn-danger" onClick={confirmDelete}>
              Delete entry
            </button>
          </>
        }
      >
        {toDelete && (
          <p>
            “{toDelete.campaign}” on {prettyDate(toDelete.reportDate)} will be removed from the dashboard and future reports. Reports already generated keep their numbers.
          </p>
        )}
      </Modal>
    </div>
  );
}

function ChannelBlock(props: {
  channel: "wa" | "email";
  title: string;
  fields: FieldKey[];
  form: FormState;
  set: (k: keyof FormState, v: string) => void;
  err: (k: keyof FormState) => string | undefined;
  upload?: Upload;
  onExtracted: (u: Upload) => void;
  rate: number | null;
  rateLabel: string;
}) {
  const { channel, fields, form, set, err, upload, onExtracted, rate, rateLabel } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const accent = channel === "wa" ? "border-l-wa" : "border-l-mail";

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > 10 * 1024 * 1024) {
      setError("File is larger than 10 MB.");
      return;
    }
    const fd = new FormData();
    fd.append("channel", channel);
    fd.append("file", file);
    setBusy(true);
    try {
      const r = await api.post<{ file: { storedName: string; originalName: string }; extraction: Extraction }>("/api/extract", fd);
      onExtracted({ storedName: r.file.storedName, originalName: r.file.originalName, extraction: r.extraction });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const ex = upload?.extraction;

  return (
    <section className={`panel border-l-4 ${accent} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ChannelTag channel={channel === "wa" ? "wa" : "mail"} />
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            id={`file-${channel}`}
            accept=".pdf,.csv,.xlsx,.png,.jpg,.jpeg,application/pdf,text/csv,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <label htmlFor={`file-${channel}`} className={`btn-secondary cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
            <FileUp className="h-4 w-4" />
            {busy ? "Reading file…" : upload ? "Upload a different file" : channel === "wa" ? "Upload vendor report" : "Upload email stats"}
          </label>
        </div>
      </div>
      <p className="mt-1 text-xs text-ink-faint">PDF, CSV, Excel or screenshot, up to 10 MB. Phone numbers and emails are masked before anything is read by AI.</p>

      {error && (
        <div className="mt-3">
          <Alert kind="error">{error}</Alert>
        </div>
      )}

      {ex && (
        <div className="mt-3 rounded-md bg-canvas px-3 py-2.5 text-xs text-ink-soft">
          <p>
            <span className="font-medium text-ink">{upload!.originalName}</span> — {METHOD[ex.method]}
            {ex.model ? ` (${ex.model})` : ""}. Check each number before saving.
          </p>
          {ex.warnings.map((w) => (
            <p key={w} className="mt-1 text-warn">
              {w}
            </p>
          ))}
          {ex.preview.length > 0 && (
            <button type="button" className="mt-1 inline-flex items-center gap-1 text-mail hover:underline" onClick={() => setShowPreview(!showPreview)}>
              <FileSearch className="h-3.5 w-3.5" /> {showPreview ? "Hide" : "Show"} text read from the file
            </button>
          )}
          {showPreview && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-line bg-white p-2 font-sans text-[11px] leading-relaxed">{ex.preview.join("\n")}</pre>}
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {fields.map((k) => {
          const src = ex?.fields[k];
          return (
            <Field
              key={k}
              label={LABEL[k]}
              htmlFor={k}
              error={err(k)}
              hint={src?.source ? <span title={src.source}>From file: “{src.source.length > 60 ? src.source.slice(0, 60) + "…" : src.source}”</span> : ex ? "Not found in file — enter manually" : undefined}
            >
              <input
                id={k}
                inputMode="numeric"
                className={`input ${src?.value !== null && src?.value !== undefined && String(src.value) === form[k] ? "bg-wa-soft/40" : ""}`}
                value={form[k]}
                onChange={(e) => set(k, e.target.value.replace(/[^\d]/g, ""))}
                placeholder="0"
              />
            </Field>
          );
        })}
        <div>
          <p className="label">{rateLabel}</p>
          <p className={`py-2 text-lg font-semibold ${channel === "wa" ? "text-wa" : "text-mail"}`}>{rate === null ? "—" : fmtPct(rate)}</p>
        </div>
      </div>
    </section>
  );
}
