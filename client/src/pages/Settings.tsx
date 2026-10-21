import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDateTime, fmtInt, monthName, prettyDate } from "../lib/format";
import { Alert, Field, Modal, PageHeader, Spinner } from "../components/ui";

interface Settings {
  timezone: string;
  autoSendEnabled: boolean;
  autoSendTime: string;
  reminderTime: string;
  reportEmails: string[];
  reportWhatsapp: string[];
  workRules: { weekdaysOff: number[]; saturdaysOff: number[] };
  allowImageAi: boolean;
  logo: string | null;
}

const TABS = [
  { id: "company", label: "Company" },
  { id: "schedule", label: "Schedule & recipients" },
  { id: "targets", label: "Monthly targets" },
  { id: "calendar", label: "Working days & holidays" },
  { id: "users", label: "Users" },
  { id: "activity", label: "Activity log" },
] as const;
type TabId = (typeof TABS)[number]["id"];

type Flash = { kind: "success" | "error"; text: string } | null;

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get("tab"))?.id ?? "company") as TabId;
  const [data, setData] = useState<{ company: { name: string }; settings: Settings } | null>(null);
  const [flash, setFlash] = useState<Flash>(null);

  const load = () => api.get<{ company: { name: string }; settings: Settings }>("/api/settings").then(setData);
  useEffect(() => {
    void load();
  }, []);

  const save = async (patch: Record<string, unknown>, msg = "Saved.") => {
    setFlash(null);
    try {
      await api.put("/api/settings", patch);
      await load();
      setFlash({ kind: "success", text: msg });
    } catch (e) {
      setFlash({ kind: "error", text: (e as Error).message });
    }
  };

  return (
    <div>
      <PageHeader title="Settings" description="Only admins can see this page. Every change is recorded in the activity log." />
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === t.id ? "border-ink font-medium text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
            onClick={() => {
              setFlash(null);
              setParams({ tab: t.id });
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {flash && (
        <div className="mb-4">
          <Alert kind={flash.kind} onClose={() => setFlash(null)}>
            {flash.text}
          </Alert>
        </div>
      )}
      {!data ? (
        <Spinner />
      ) : (
        <>
          {tab === "company" && <CompanyTab data={data} save={save} reload={load} setFlash={setFlash} />}
          {tab === "schedule" && <ScheduleTab s={data.settings} save={save} setFlash={setFlash} />}
          {tab === "targets" && <TargetsTab setFlash={setFlash} />}
          {tab === "calendar" && <CalendarTab s={data.settings} save={save} setFlash={setFlash} />}
          {tab === "users" && <UsersTab setFlash={setFlash} />}
          {tab === "activity" && <ActivityTab />}
        </>
      )}
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="panel mb-6 grid gap-6 p-5 lg:grid-cols-[16rem_1fr]">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

// ── Company ─────────────────────────────────────────────────
function CompanyTab({ data, save, reload, setFlash }: { data: { company: { name: string }; settings: Settings }; save: (p: Record<string, unknown>, m?: string) => Promise<void>; reload: () => Promise<unknown>; setFlash: (f: Flash) => void }) {
  const { refresh } = useAuth();
  const [name, setName] = useState(data.company.name);
  const [busy, setBusy] = useState(false);

  const uploadLogo = async (file?: File) => {
    if (!file) return;
    if (file.size > 500 * 1024) return setFlash({ kind: "error", text: "Logo must be 500 KB or smaller." });
    const fd = new FormData();
    fd.append("file", file);
    setBusy(true);
    try {
      await api.post("/api/settings/logo", fd);
      await reload();
      setFlash({ kind: "success", text: "Logo updated." });
    } catch (e) {
      setFlash({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section title="Company name" description="Shown on the dashboard, report card and emails.">
        <form
          className="flex max-w-lg gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await save({ companyName: name.trim() }, "Company name saved.");
            await refresh();
          }}
        >
          <input className="input" value={name} minLength={2} maxLength={100} onChange={(e) => setName(e.target.value)} aria-label="Company name" />
          <button className="btn-primary" disabled={name.trim().length < 2 || name.trim() === data.company.name}>
            Save
          </button>
        </form>
      </Section>
      <Section title="Logo" description="PNG or JPG, up to 500 KB. A square logo works best.">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-md border border-line bg-canvas">{data.settings.logo ? <img src={data.settings.logo} alt="Company logo" className="max-h-14 max-w-14 object-contain" /> : <span className="text-xs text-ink-faint">None</span>}</div>
          <label className={`btn-secondary cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
            {busy ? "Uploading…" : "Upload logo"}
            <input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" className="sr-only" onChange={(e) => uploadLogo(e.target.files?.[0])} />
          </label>
          {data.settings.logo && (
            <button
              className="btn-ghost"
              onClick={async () => {
                await api.del("/api/settings/logo");
                await reload();
                setFlash({ kind: "success", text: "Logo removed." });
              }}
            >
              Remove
            </button>
          )}
        </div>
      </Section>
      <Section title="Screenshots and AI" description="Text from PDFs and spreadsheets is masked (phone numbers, emails) before AI reads it. Images can't be masked that way.">
        <label className="flex max-w-xl items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={data.settings.allowImageAi} onChange={(e) => save({ allowImageAi: e.target.checked }, e.target.checked ? "Screenshot reading turned on." : "Screenshot reading turned off.")} />
          <span>
            Let AI read uploaded screenshots
            <span className="block text-ink-soft">Only turn this on if your screenshots never show phone numbers, email addresses or names. When off, enter numbers from screenshots by hand.</span>
          </span>
        </label>
      </Section>
    </>
  );
}

// ── Schedule & recipients ───────────────────────────────────
function ScheduleTab({ s, save, setFlash }: { s: Settings; save: (p: Record<string, unknown>, m?: string) => Promise<void>; setFlash: (f: Flash) => void }) {
  const [enabled, setEnabled] = useState(s.autoSendEnabled);
  const [sendTime, setSendTime] = useState(s.autoSendTime);
  const [reminder, setReminder] = useState(s.reminderTime);
  const [emails, setEmails] = useState(s.reportEmails.join("\n"));
  const [phones, setPhones] = useState(s.reportWhatsapp.join("\n"));
  const [testing, setTesting] = useState(false);

  const split = (v: string) =>
    v
      .split(/[\n,;]+/)
      .map((x) => x.trim())
      .filter(Boolean);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save({ autoSendEnabled: enabled, autoSendTime: sendTime, reminderTime: reminder, reportEmails: split(emails), reportWhatsapp: split(phones) }, "Schedule and recipients saved.");
  };

  return (
    <form onSubmit={submit}>
      <Section title="Automatic report" description={`On working days, the report is built and emailed at this time (${s.timezone}). If no data was entered, admins get a "data missing" email instead.`}>
        <div className="grid max-w-lg gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Send the report automatically
          </label>
          <Field label="Send at" htmlFor="sendTime">
            <input id="sendTime" type="time" className="input" value={sendTime} onChange={(e) => setSendTime(e.target.value)} disabled={!enabled} required />
          </Field>
          <Field label="Remind if data is missing after" htmlFor="reminder" hint="Shows a banner on the dashboard">
            <input id="reminder" type="time" className="input" value={reminder} onChange={(e) => setReminder(e.target.value)} required />
          </Field>
        </div>
      </Section>
      <Section title="Report recipients" description="One per line. WhatsApp numbers need the country code, e.g. 919812345678.">
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <Field label="Email addresses" htmlFor="emails">
            <textarea id="emails" rows={4} className="input" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="boss@company.com" />
          </Field>
          <Field label="WhatsApp numbers" htmlFor="phones" hint="Used for the Open in WhatsApp buttons">
            <textarea id="phones" rows={4} className="input" value={phones} onChange={(e) => setPhones(e.target.value)} placeholder="919812345678" />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-primary">Save schedule and recipients</button>
          <button
            type="button"
            className="btn-secondary"
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              try {
                const r = await api.post<{ to: string[] }>("/api/settings/test-email");
                setFlash({ kind: "success", text: `Test email sent to ${r.to.join(", ")}.` });
              } catch (e) {
                setFlash({ kind: "error", text: (e as Error).message });
              } finally {
                setTesting(false);
              }
            }}
          >
            {testing ? "Sending…" : "Send a test email"}
          </button>
        </div>
      </Section>
    </form>
  );
}

// ── Targets ─────────────────────────────────────────────────
interface Target {
  id: number;
  month: string;
  waRecipients: number;
  waDelivered: number;
  emailSent: number;
  emailOpened: number;
  deliveryPct: number;
  openPct: number;
}
const TARGET_FIELDS: { key: keyof Omit<Target, "id" | "month">; label: string; pct?: boolean }[] = [
  { key: "waRecipients", label: "WA sent" },
  { key: "waDelivered", label: "WA delivered" },
  { key: "deliveryPct", label: "Delivery %", pct: true },
  { key: "emailSent", label: "Emails sent" },
  { key: "emailOpened", label: "Emails opened" },
  { key: "openPct", label: "Open %", pct: true },
];

function TargetsTab({ setFlash }: { setFlash: (f: Flash) => void }) {
  const [targets, setTargets] = useState<Target[] | null>(null);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const blank = { month: thisMonth, waRecipients: "", waDelivered: "", emailSent: "", emailOpened: "", deliveryPct: "", openPct: "" };
  const [form, setForm] = useState<Record<string, string>>(blank);

  const load = () => api.get<{ targets: Target[] }>("/api/targets").then((r) => setTargets(r.targets));
  useEffect(() => {
    void load();
  }, []);

  const edit = (t: Target) => setForm({ month: t.month, ...Object.fromEntries(TARGET_FIELDS.map((f) => [f.key, String(t[f.key])])) });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const body = Object.fromEntries(TARGET_FIELDS.map((f) => [f.key, Number(form[f.key] || 0)]));
      await api.put(`/api/targets/${form.month}`, body);
      setFlash({ kind: "success", text: `Targets for ${monthName(form.month)} saved.` });
      setForm(blank);
      void load();
    } catch (err) {
      setFlash({ kind: "error", text: (err as Error).message });
    }
  };

  return (
    <>
      <Section title="Set targets" description="Totals for the whole month. Rates are percentages (0–100). Saving a month that exists replaces it.">
        <form onSubmit={submit} className="grid max-w-3xl gap-4 sm:grid-cols-3">
          <Field label="Month" htmlFor="month">
            <input id="month" type="month" className="input" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} required />
          </Field>
          {TARGET_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} htmlFor={f.key}>
              <input
                id={f.key}
                inputMode={f.pct ? "decimal" : "numeric"}
                className="input"
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value.replace(f.pct ? /[^\d.]/g : /\D/g, "") })}
                placeholder="0"
              />
            </Field>
          ))}
          <div className="flex items-end sm:col-span-3">
            <button className="btn-primary">Save targets</button>
          </div>
        </form>
      </Section>
      <section className="panel overflow-x-auto">
        {targets === null ? (
          <div className="px-4">
            <Spinner />
          </div>
        ) : targets.length === 0 ? (
          <p className="p-5 text-sm text-ink-soft">No targets yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                {TARGET_FIELDS.map((f) => (
                  <th key={f.key} className="text-right">
                    {f.label}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap font-medium">{monthName(t.month)}</td>
                  {TARGET_FIELDS.map((f) => (
                    <td key={f.key} className="text-right">
                      {f.pct ? `${t[f.key]}%` : fmtInt(t[f.key])}
                    </td>
                  ))}
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => edit(t)}>
                      Edit
                    </button>
                    <button
                      className="btn-ghost px-2 py-1 text-xs text-down"
                      onClick={async () => {
                        await api.del(`/api/targets/${t.month}`);
                        setFlash({ kind: "success", text: `Targets for ${monthName(t.month)} deleted.` });
                        void load();
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

// ── Working days & holidays ─────────────────────────────────
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const NTH = ["1st", "2nd", "3rd", "4th", "5th"];

function CalendarTab({ s, save, setFlash }: { s: Settings; save: (p: Record<string, unknown>, m?: string) => Promise<void>; setFlash: (f: Flash) => void }) {
  const [weekdaysOff, setWeekdaysOff] = useState<number[]>(s.workRules.weekdaysOff);
  const [saturdaysOff, setSaturdaysOff] = useState<number[]>(s.workRules.saturdaysOff);
  const [holidays, setHolidays] = useState<{ id: number; date: string; name: string }[] | null>(null);
  const [hDate, setHDate] = useState("");
  const [hName, setHName] = useState("");

  const load = () => api.get<{ holidays: { id: number; date: string; name: string }[] }>("/api/holidays").then((r) => setHolidays(r.holidays));
  useEffect(() => {
    void load();
  }, []);
  const toggle = (arr: number[], v: number) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v].sort());

  return (
    <>
      <Section title="Weekly offs" description="Reports aren't sent and 'previous working day' comparisons skip these days.">
        <div className="space-y-4">
          <fieldset>
            <legend className="label">Always off</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {WEEKDAYS.map((d, i) => (
                <label key={d} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={weekdaysOff.includes(i)} onChange={() => setWeekdaysOff(toggle(weekdaysOff, i))} /> {d}
                </label>
              ))}
            </div>
          </fieldset>
          {!weekdaysOff.includes(6) && (
            <fieldset>
              <legend className="label">Saturdays off</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {NTH.map((n, i) => (
                  <label key={n} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={saturdaysOff.includes(i + 1)} onChange={() => setSaturdaysOff(toggle(saturdaysOff, i + 1))} /> {n} Saturday
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <button className="btn-primary" onClick={() => save({ workRules: { weekdaysOff, saturdaysOff } }, "Working-day rules saved.")}>
            Save working days
          </button>
        </div>
      </Section>
      <Section title="Holidays" description="Company holidays are skipped like weekly offs.">
        <form
          className="flex max-w-xl flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.post("/api/holidays", { date: hDate, name: hName.trim() });
              setHDate("");
              setHName("");
              setFlash({ kind: "success", text: "Holiday added." });
              void load();
            } catch (err) {
              setFlash({ kind: "error", text: (err as Error).message });
            }
          }}
        >
          <label className="text-xs text-ink-soft">
            Date
            <input type="date" className="input mt-1 w-auto" value={hDate} onChange={(e) => setHDate(e.target.value)} required />
          </label>
          <label className="flex-1 text-xs text-ink-soft">
            Name
            <input className="input mt-1" value={hName} maxLength={100} onChange={(e) => setHName(e.target.value)} placeholder="e.g. Diwali" required />
          </label>
          <button className="btn-primary" disabled={!hDate || !hName.trim()}>
            Add holiday
          </button>
        </form>
        {holidays === null ? (
          <Spinner />
        ) : holidays.length === 0 ? (
          <p className="mt-4 text-sm text-ink-soft">No holidays added.</p>
        ) : (
          <ul className="mt-4 max-w-xl divide-y divide-line rounded-md border border-line">
            {holidays.map((h) => (
              <li key={h.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{prettyDate(h.date)}</span> <span className="text-ink-soft">— {h.name}</span>
                </span>
                <button
                  className="rounded p-1 text-ink-faint hover:bg-bad-soft hover:text-down"
                  aria-label={`Delete ${h.name}`}
                  onClick={async () => {
                    await api.del(`/api/holidays/${h.id}`);
                    void load();
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

// ── Users ───────────────────────────────────────────────────
interface UserRow {
  id: number;
  name: string;
  email: string;
  role: "admin" | "member" | "viewer";
  active: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
}

function UsersTab({ setFlash }: { setFlash: (f: Flash) => void }) {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [form, setForm] = useState({ name: "", email: "", role: "member", password: "" });
  const [resetFor, setResetFor] = useState<UserRow | null>(null);
  const [newPw, setNewPw] = useState("");

  const load = () => api.get<{ users: UserRow[] }>("/api/users").then((r) => setUsers(r.users));
  useEffect(() => {
    void load();
  }, []);

  const act = async (fn: () => Promise<unknown>, text: string) => {
    try {
      await fn();
      setFlash({ kind: "success", text });
      void load();
    } catch (e) {
      setFlash({ kind: "error", text: (e as Error).message });
    }
  };

  return (
    <>
      <Section title="Add a user" description="Admins manage everything. Members add data and send reports. Viewers can only look.">
        <form
          className="grid max-w-3xl gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api.post("/api/users", form);
              setForm({ name: "", email: "", role: "member", password: "" });
            }, `Added ${form.email}. Share the password with them privately.`);
          }}
        >
          <Field label="Name" htmlFor="uname">
            <input id="uname" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Email" htmlFor="uemail">
            <input id="uemail" type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </Field>
          <Field label="Role" htmlFor="urole">
            <select id="urole" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
          </Field>
          <Field label="Temporary password" htmlFor="upw" hint="At least 8 characters. Ask them to change it after logging in.">
            <input id="upw" type="password" autoComplete="new-password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
          </Field>
          <div className="sm:col-span-2">
            <button className="btn-primary" disabled={!form.name || !form.email || form.password.length < 8}>
              Add user
            </button>
          </div>
        </form>
      </Section>
      <section className="panel overflow-x-auto">
        {users === null ? (
          <div className="px-4">
            <Spinner />
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last login</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.active ? "" : "text-ink-faint"}>
                  <td>
                    <p className="font-medium">
                      {u.name}
                      {u.id === me?.id && <span className="ml-1 text-xs font-normal text-ink-faint">(you)</span>}
                    </p>
                    <p className="text-xs text-ink-soft">{u.email}</p>
                  </td>
                  <td>
                    <select
                      className="input w-auto py-1"
                      value={u.role}
                      aria-label={`Role for ${u.name}`}
                      onChange={(e) => act(() => api.patch(`/api/users/${u.id}`, { role: e.target.value }), `${u.name} is now ${e.target.value}.`)}
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </td>
                  <td>{!u.active ? "Deactivated" : u.lockedUntil && new Date(u.lockedUntil) > new Date() ? <span className="text-warn">Locked</span> : "Active"}</td>
                  <td className="whitespace-nowrap text-ink-soft">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never"}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setResetFor(u)}>
                      Reset password
                    </button>
                    {u.id !== me?.id && (
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => act(() => api.patch(`/api/users/${u.id}`, { active: !u.active }), u.active ? `${u.name} deactivated.` : `${u.name} reactivated.`)}>
                        {u.active ? "Deactivate" : "Reactivate"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <Modal
        open={Boolean(resetFor)}
        title={`Reset password for ${resetFor?.name ?? ""}`}
        onClose={() => {
          setResetFor(null);
          setNewPw("");
        }}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setResetFor(null)}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={newPw.length < 8}
              onClick={() => {
                const u = resetFor!;
                void act(() => api.post(`/api/users/${u.id}/reset-password`, { password: newPw }), `Password reset for ${u.name}. They've been logged out everywhere.`);
                setResetFor(null);
                setNewPw("");
              }}
            >
              Reset password
            </button>
          </>
        }
      >
        <Field label="New password" htmlFor="resetpw" hint="At least 8 characters. This also unlocks the account.">
          <input id="resetpw" type="password" autoComplete="new-password" className="input" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
        </Field>
      </Modal>
    </>
  );
}

// ── Activity log ────────────────────────────────────────────
function ActivityTab() {
  const [rows, setRows] = useState<{ id: number; action: string; entity: string; entityId: string | null; userName: string | null; ip: string | null; createdAt: string }[] | null>(null);
  useEffect(() => {
    api.get<{ entries: NonNullable<typeof rows> }>("/api/audit?limit=200").then((r) => setRows(r.entries));
  }, []);
  if (!rows) return <Spinner />;
  return (
    <section className="panel overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>What</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-ink-soft">{fmtDateTime(r.createdAt)}</td>
              <td>{r.userName ?? <span className="text-ink-faint">System</span>}</td>
              <td>
                {r.action.replace(/_/g, " ")} <span className="text-ink-soft">{r.entity.replace(/_/g, " ")}</span>
                {r.entityId && <span className="text-ink-faint"> #{r.entityId}</span>}
              </td>
              <td className="text-ink-faint">{r.ip ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
