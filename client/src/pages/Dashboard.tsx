import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, Download, Minus } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, qs } from "../lib/api";
import { useAuth } from "../lib/auth";
import { KPI_LABELS, fmtInt, fmtKpi, fmtPct, monthName, prettyDate, shortDate, type KpiKey } from "../lib/format";
import { Alert, PageHeader, Spinner } from "../components/ui";

interface Change {
  key: KpiKey;
  current: number;
  previous: number | null;
  delta: number | null;
  direction: "up" | "down" | "flat" | "none";
  words: string;
}
interface Point {
  date: string;
  waSent: number;
  waDelivered: number;
  deliveryPct: number;
  emailSent: number;
  emailOpened: number;
  openPct: number;
  entries: number;
}
interface DashboardData {
  today: string;
  range: { from: string; to: string };
  snapshot: {
    date: string;
    kpis: Record<KpiKey, number> & { entries: number };
    previousDate: string | null;
    changes: Record<KpiKey, Change>;
    workingDay: boolean;
    offReason: string | null;
  };
  trend: Point[];
  totals: Record<KpiKey, number>;
  targets: { month: string; hasTarget: boolean; items: { key: string; label: string; target: number; actual: number; progressPct: number; isRate: boolean }[] };
  reminder: { missing: boolean; today: string; reminderTime: string };
}

const WA = "var(--color-wa)";
const MAIL = "var(--color-mail)";

export default function DashboardPage() {
  const { can } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [day, setDay] = useState("");

  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .get<DashboardData>(`/api/dashboard${qs({ from, to, date: day })}`)
      .then((d) => {
        if (!alive) return;
        setData(d);
        if (!from) setFrom(d.range.from);
        if (!to) setTo(d.range.to);
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, day]);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return <Spinner label="Loading dashboard…" />;

  const s = data.snapshot;
  const daysWithData = data.trend.filter((p) => p.entries > 0).map((p) => p.date).reverse();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={
          <>
            Showing <strong className="font-medium text-ink">{prettyDate(s.date)}</strong>
            {s.previousDate ? <> compared with {prettyDate(s.previousDate)}, the previous working day.</> : "."}
          </>
        }
        actions={
          <>
            <a className="btn-secondary" href={`/api/metrics/export${qs({ from: data.range.from, to: data.range.to, format: "csv" })}`}>
              <Download className="h-4 w-4" /> CSV
            </a>
            <a className="btn-secondary" href={`/api/metrics/export${qs({ from: data.range.from, to: data.range.to, format: "xlsx" })}`}>
              <Download className="h-4 w-4" /> Excel
            </a>
          </>
        }
      />

      {data.reminder.missing && (
        <Alert
          kind="warn"
          action={
            can("edit") ? (
              <Link to="/add" className="btn-secondary shrink-0 px-2.5 py-1 text-xs">
                Add today's data
              </Link>
            ) : undefined
          }
        >
          Today's numbers haven't been entered yet and it's past {data.reminder.reminderTime}. The automatic report can't go out without them.
        </Alert>
      )}

      <div className="panel flex flex-wrap items-end gap-3 p-3">
        <label className="text-xs text-ink-soft">
          From
          <input type="date" className="input mt-1 w-auto" value={from} max={to || data.today} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-xs text-ink-soft">
          To
          <input type="date" className="input mt-1 w-auto" value={to} min={from} max={data.today} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="text-xs text-ink-soft">
          Day shown in cards
          <select className="input mt-1 w-auto" value={day || s.date} onChange={(e) => setDay(e.target.value)}>
            {!daysWithData.includes(s.date) && <option value={s.date}>{prettyDate(s.date)} (no data)</option>}
            {daysWithData.map((d) => (
              <option key={d} value={d}>
                {prettyDate(d)}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex gap-1">
          {[7, 30, 90].map((n) => (
            <button
              key={n}
              className="btn-ghost px-2.5 py-1.5 text-xs"
              onClick={() => {
                const d = new Date(`${data.today}T12:00:00Z`);
                d.setUTCDate(d.getUTCDate() - (n - 1));
                setFrom(d.toISOString().slice(0, 10));
                setTo(data.today);
                setDay("");
              }}
            >
              Last {n} days
            </button>
          ))}
        </div>
      </div>

      {s.kpis.entries === 0 && (
        <Alert kind="info">
          No data for {prettyDate(s.date)}
          {s.offReason ? ` (${s.offReason.toLowerCase()})` : ""}.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <KpiGroup channel="wa" keys={["waSent", "waDelivered", "deliveryPct"]} snap={s} />
        <KpiGroup channel="mail" keys={["emailSent", "emailOpened", "openPct"]} snap={s} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TrendChart title="WhatsApp, daily" points={data.trend} bar="waSent" line="waDelivered" barLabel="Sent" lineLabel="Delivered" color={WA} />
        <TrendChart title="Email, daily" points={data.trend} bar="emailSent" line="emailOpened" barLabel="Sent" lineLabel="Opened" color={MAIL} />
      </div>

      <section className="panel p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">{monthName(data.targets.month)}: target vs actual</h2>
          <p className="text-xs text-ink-soft">Month to date, up to {shortDate(s.date)}</p>
        </div>
        {!data.targets.hasTarget ? (
          <p className="mt-3 text-sm text-ink-soft">
            No target set for this month.{" "}
            {can("admin") && (
              <Link to="/settings?tab=targets" className="text-mail hover:underline">
                Set monthly targets
              </Link>
            )}
          </p>
        ) : (
          <div className="mt-4 grid gap-x-10 gap-y-5 md:grid-cols-2">
            {data.targets.items.map((t) => {
              const wa = t.key.startsWith("wa") || t.key === "deliveryPct";
              const width = Math.min(100, t.progressPct);
              return (
                <div key={t.key}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-ink-soft">{t.label}</span>
                    <span>
                      <span className="font-semibold">{t.isRate ? fmtPct(t.actual) : fmtInt(t.actual)}</span>
                      <span className="text-ink-faint"> / {t.isRate ? fmtPct(t.target) : fmtInt(t.target)}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuenow={t.progressPct} aria-valuemin={0} aria-valuemax={100} aria-label={t.label}>
                    <div className="h-full rounded-full" style={{ width: `${width}%`, background: wa ? WA : MAIL }} />
                  </div>
                  <p className="mt-1 text-xs text-ink-faint">{t.isRate ? (t.actual >= t.target ? "Meeting the target rate" : `${(Math.round((t.target - t.actual) * 10) / 10).toFixed(1)} pts below target`) : `${t.progressPct}% of target`}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel p-5">
        <h2 className="text-base font-semibold">Selected range totals</h2>
        <p className="text-xs text-ink-soft">
          {prettyDate(data.range.from)} to {prettyDate(data.range.to)}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {(["waSent", "waDelivered", "deliveryPct", "emailSent", "emailOpened", "openPct"] as KpiKey[]).map((k) => (
            <div key={k}>
              <dt className="text-xs text-ink-soft">{KPI_LABELS[k]}</dt>
              <dd className="text-lg font-semibold">{fmtKpi(k, data.totals[k])}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function KpiGroup({ channel, keys, snap }: { channel: "wa" | "mail"; keys: KpiKey[]; snap: DashboardData["snapshot"] }) {
  const color = channel === "wa" ? "text-wa" : "text-mail";
  return (
    <section className={`panel overflow-hidden border-t-4 ${channel === "wa" ? "border-t-wa" : "border-t-mail"}`} aria-label={channel === "wa" ? "WhatsApp" : "Email"}>
      <h2 className={`px-5 pt-4 text-sm font-semibold ${color}`}>{channel === "wa" ? "WhatsApp" : "Email"}</h2>
      <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {keys.map((k) => {
          const c = snap.changes[k];
          const Icon = c.direction === "up" ? ArrowUpRight : c.direction === "down" ? ArrowDownRight : Minus;
          const tone = c.direction === "up" ? "text-up" : c.direction === "down" ? "text-down" : "text-ink-faint";
          return (
            <div key={k} className="px-5 py-4">
              <p className="text-sm text-ink-soft">{KPI_LABELS[k]}</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight">{fmtKpi(k, snap.kpis[k])}</p>
              <p className={`mt-1 flex items-center gap-1 text-xs font-medium ${tone}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {c.words}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TrendChart({ title, points, bar, line, barLabel, lineLabel, color }: { title: string; points: Point[]; bar: keyof Point; line: keyof Point; barLabel: string; lineLabel: string; color: string }) {
  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="flex gap-4 text-xs text-ink-soft">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm opacity-30" style={{ background: color }} /> {barLabel}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4" style={{ background: color }} /> {lineLabel}
          </span>
        </div>
      </div>
      <div className="mt-4 h-60">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: "var(--color-ink-faint)" }} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} tick={{ fontSize: 11, fill: "var(--color-ink-faint)" }} tickLine={false} axisLine={false} width={44} />
            <Tooltip
              cursor={{ fill: "var(--color-canvas)" }}
              contentStyle={{ borderRadius: 6, border: "1px solid var(--color-line)", fontSize: 12 }}
              labelFormatter={(d) => prettyDate(String(d))}
              formatter={(v, name) => [fmtInt(Number(v)), name]}
            />
            <Bar dataKey={bar as string} name={barLabel} fill={color} fillOpacity={0.25} radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            <Line dataKey={line as string} name={lineLabel} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
