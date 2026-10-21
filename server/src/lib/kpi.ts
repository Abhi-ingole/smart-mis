/** KPI maths. Every number shown anywhere in the app is computed here — never by the AI. */

export interface MetricRow {
  waRecipients: number;
  waDelivered: number;
  emailSent: number;
  emailOpened: number;
}

export interface Kpis {
  waSent: number;
  waDelivered: number;
  deliveryPct: number; // 0–100, 1 decimal
  emailSent: number;
  emailOpened: number;
  openPct: number; // 0–100, 1 decimal
  entries: number;
}

export type KpiKey = "waSent" | "waDelivered" | "deliveryPct" | "emailSent" | "emailOpened" | "openPct";

export const KPI_KEYS: KpiKey[] = ["waSent", "waDelivered", "deliveryPct", "emailSent", "emailOpened", "openPct"];
export const PCT_KEYS = new Set<KpiKey>(["deliveryPct", "openPct"]);

export const KPI_LABELS: Record<KpiKey, string> = {
  waSent: "WA sent",
  waDelivered: "WA delivered",
  deliveryPct: "Delivery %",
  emailSent: "Emails sent",
  emailOpened: "Emails opened",
  openPct: "Open %",
};

export const round1 = (n: number) => Math.round(n * 10) / 10;

/** Percentage of part/whole, 1 decimal; 0 when whole is 0. */
export function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return round1((part / whole) * 100);
}

/** Sum multiple entries for one day (or a range). */
export function sumRows(rows: MetricRow[]): MetricRow & { entries: number } {
  return rows.reduce<MetricRow & { entries: number }>(
    (acc, r) => ({
      waRecipients: acc.waRecipients + (r.waRecipients || 0),
      waDelivered: acc.waDelivered + (r.waDelivered || 0),
      emailSent: acc.emailSent + (r.emailSent || 0),
      emailOpened: acc.emailOpened + (r.emailOpened || 0),
      entries: acc.entries + 1,
    }),
    { waRecipients: 0, waDelivered: 0, emailSent: 0, emailOpened: 0, entries: 0 },
  );
}

export function computeKpis(rows: MetricRow[]): Kpis {
  const t = sumRows(rows);
  return {
    waSent: t.waRecipients,
    waDelivered: t.waDelivered,
    deliveryPct: pct(t.waDelivered, t.waRecipients),
    emailSent: t.emailSent,
    emailOpened: t.emailOpened,
    openPct: pct(t.emailOpened, t.emailSent),
    entries: t.entries,
  };
}

export interface KpiChange {
  key: KpiKey;
  current: number;
  previous: number | null;
  /** % change for counts, percentage-point difference for % KPIs. null = not comparable. */
  delta: number | null;
  unit: "%" | "pts";
  direction: "up" | "down" | "flat" | "none";
  words: string;
}

/** % change from previous to current, 1 decimal. null when previous is 0/missing. */
export function pctChange(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous === 0) return null;
  return round1(((current - previous) / previous) * 100);
}

export function changeFor(key: KpiKey, current: Kpis, previous: Kpis | null, prevLabel: string): KpiChange {
  const cur = current[key];
  const isPct = PCT_KEYS.has(key);
  const unit = isPct ? "pts" : "%";
  if (!previous || previous.entries === 0) {
    return { key, current: cur, previous: null, delta: null, unit, direction: "none", words: `No data for ${prevLabel}` };
  }
  const prev = previous[key];
  const delta = isPct ? round1(cur - prev) : pctChange(cur, prev);
  if (delta === null) {
    return { key, current: cur, previous: prev, delta: null, unit, direction: cur > 0 ? "up" : "flat", words: cur > 0 ? `New vs ${prevLabel} (was 0)` : `No change vs ${prevLabel}` };
  }
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const abs = Math.abs(delta);
  const amount = isPct ? `${abs} pts` : `${abs}%`;
  const words = direction === "flat" ? `No change vs ${prevLabel}` : `${direction === "up" ? "Up" : "Down"} ${amount} vs ${prevLabel}`;
  return { key, current: cur, previous: prev, delta, unit, direction, words };
}

export function allChanges(current: Kpis, previous: Kpis | null, prevLabel: string): Record<KpiKey, KpiChange> {
  return Object.fromEntries(KPI_KEYS.map((k) => [k, changeFor(k, current, previous, prevLabel)])) as Record<KpiKey, KpiChange>;
}

/** Indian number grouping: 1,23,456 */
export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-IN");
export const fmtPct = (n: number) => `${round1(n).toFixed(1)}%`;

export function fmtKpi(key: KpiKey, v: number): string {
  return PCT_KEYS.has(key) ? fmtPct(v) : fmtInt(v);
}
