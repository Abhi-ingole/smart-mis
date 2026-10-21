import { useMemo, useState } from "react";
import { ChevronDown, Filter, X } from "lucide-react";
import type { ColumnProfile, Filters, Table } from "../engine/types";
import { filtersActive } from "../state/view";

export function FilterBar({ table, profiles, filters, onChange, shown, total }: { table: Table; profiles: Record<string, ColumnProfile>; filters: Filters; onChange: (f: Filters) => void; shown: number; total: number }) {
  const dims = useMemo(
    () =>
      table.schema
        .filter((c) => !c.excluded && c.role === "dimension" && (profiles[c.key]?.distinct ?? 0) >= 2 && (profiles[c.key]?.distinct ?? 0) <= 500)
        .sort((a, b) => (profiles[a.key]?.distinct ?? 0) - (profiles[b.key]?.distinct ?? 0))
        .slice(0, 5),
    [table.schema, profiles],
  );
  const time = table.schema.find((c) => !c.excluded && c.type === "date" && profiles[c.key]?.dateRange);
  const range = time ? profiles[time.key]!.dateRange! : null;
  if (!dims.length && !time) return null;

  return (
    <div className="card no-print flex flex-wrap items-center gap-2 p-3">
      <Filter className="ml-1 h-4 w-4 text-ink-faint" aria-hidden />
      {dims.map((d) => (
        <MultiSelect
          key={d.key}
          label={d.name}
          options={valuesOf(table, d.key)}
          selected={filters.categories[d.key] ?? []}
          onChange={(v) => onChange({ ...filters, categories: { ...filters.categories, [d.key]: v } })}
        />
      ))}
      {time && range && (
        <div className="flex items-center gap-1.5 text-sm">
          <label className="sr-only" htmlFor="df">
            {time.name} from
          </label>
          <input id="df" type="date" className="input w-auto py-1.5" min={range.min} max={range.max} value={filters.dateFrom ?? ""} onChange={(e) => onChange({ ...filters, dateColumn: time.key, dateFrom: e.target.value || undefined })} />
          <span className="text-ink-faint">to</span>
          <label className="sr-only" htmlFor="dt">
            {time.name} to
          </label>
          <input id="dt" type="date" className="input w-auto py-1.5" min={range.min} max={range.max} value={filters.dateTo ?? ""} onChange={(e) => onChange({ ...filters, dateColumn: time.key, dateTo: e.target.value || undefined })} />
        </div>
      )}
      {filtersActive(filters) && (
        <button className="btn-ghost px-2 py-1.5 text-xs" onClick={() => onChange({ categories: {} })}>
          <X className="h-3.5 w-3.5" /> Clear filters
        </button>
      )}
      <span className="ml-auto text-xs text-ink-soft">
        {shown === total ? `All ${total.toLocaleString("en-IN")} rows` : `${shown.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} rows`}
      </span>
    </div>
  );
}

function valuesOf(table: Table, key: string): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const v of table.str[key]) if (v !== null) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
}

function MultiSelect({ label, options, selected, onChange }: { label: string; options: { value: string; count: number }[]; selected: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const shown = options.filter((o) => o.value.toLowerCase().includes(q.toLowerCase())).slice(0, 200);
  return (
    <div className="relative">
      <button className={`btn-secondary px-2.5 py-1.5 text-sm ${selected.length ? "border-accent/50 bg-accent-soft text-accent" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="max-w-[9rem] truncate">{label}</span>
        {selected.length > 0 && <span className="rounded bg-accent px-1.5 text-xs text-white">{selected.length}</span>}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-30 cursor-default" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-40 mt-1 w-64 rounded-xl border border-line bg-surface p-2" style={{ boxShadow: "var(--shadow-pop)" }}>
            {options.length > 8 && <input className="input mb-2 py-1.5" placeholder={`Search ${label}`} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />}
            <div className="max-h-64 overflow-y-auto">
              {shown.map((o) => (
                <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-sunken">
                  <input type="checkbox" checked={selected.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...selected, o.value] : selected.filter((s) => s !== o.value))} />
                  <span className="min-w-0 flex-1 truncate" title={o.value}>
                    {o.value}
                  </span>
                  <span className="text-xs text-ink-faint">{o.count.toLocaleString("en-IN")}</span>
                </label>
              ))}
            </div>
            {selected.length > 0 && (
              <button className="btn-ghost mt-1 w-full py-1 text-xs" onClick={() => onChange([])}>
                Clear {label}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
