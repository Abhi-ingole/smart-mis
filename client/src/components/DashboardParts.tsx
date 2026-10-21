import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Info, Minus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { Agg, ChartSpec, ChartType, ColumnSchema, KpiDef, KpiValue, Table } from "../engine/types";
import { compatibleTypes } from "../engine/charts";
import { isNumericType } from "../engine/table";
import { fmtPercent } from "../engine/format";
import { ChartView } from "./ChartView";
import { Field, Modal } from "./ui";

export function KpiCard({ def, value, onRemove, onRename }: { def: KpiDef; value?: KpiValue; onRemove?: () => void; onRename?: (name: string) => void }) {
  const [info, setInfo] = useState(false);
  const c = value?.comparison;
  const Icon = c?.direction === "up" ? ArrowUpRight : c?.direction === "down" ? ArrowDownRight : Minus;
  return (
    <div className="card group relative flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-ink-soft" title={def.name}>
          {def.name}
        </p>
        <div className="no-print flex shrink-0 gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
          <button className="rounded p-1 text-ink-faint hover:bg-sunken hover:text-ink" aria-label={`How ${def.name} is calculated`} aria-expanded={info} onClick={() => setInfo(!info)}>
            <Info className="h-3.5 w-3.5" />
          </button>
          {onRename && (
            <button
              className="rounded p-1 text-ink-faint hover:bg-sunken hover:text-ink"
              aria-label={`Rename ${def.name}`}
              onClick={() => {
                const n = window.prompt("KPI name", def.name);
                if (n && n.trim()) onRename(n.trim().slice(0, 80));
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {onRemove && (
            <button className="rounded p-1 text-ink-faint hover:bg-bad-soft hover:text-bad" aria-label={`Remove ${def.name}`} onClick={onRemove}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <p className="mt-1.5 break-words text-2xl font-semibold tracking-tight">{value?.display ?? "—"}</p>
      {c && (
        <p className={`mt-1 flex items-center gap-1 text-xs font-medium ${c.direction === "up" ? "text-good" : c.direction === "down" ? "text-bad" : "text-ink-faint"}`}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {c.changePct === null ? (c.direction === "flat" ? "No change" : "Changed from 0") : `${c.direction === "up" ? "Up" : c.direction === "down" ? "Down" : "No change"} ${c.direction === "flat" ? "" : fmtPercent(Math.abs(c.changePct))}`}
          <span className="font-normal text-ink-faint">· {c.label}</span>
        </p>
      )}
      {info && value && (
        <div className="mt-3 space-y-1 rounded-lg bg-sunken p-2.5 text-xs text-ink-soft">
          <p>
            <span className="font-medium text-ink">Formula:</span> {value.formula}
          </p>
          {value.sourceColumns.length > 0 && (
            <p>
              <span className="font-medium text-ink">Columns:</span> {value.sourceColumns.join(", ")}
            </p>
          )}
          <p>{def.description}</p>
        </div>
      )}
    </div>
  );
}

const AGG_OPTIONS: { value: ChartSpec["agg"]; label: string }[] = [
  { value: "sum", label: "Total" },
  { value: "avg", label: "Average" },
  { value: "count", label: "Count of rows" },
  { value: "median", label: "Median" },
  { value: "min", label: "Minimum" },
  { value: "max", label: "Maximum" },
];
const TYPE_NAMES: Record<ChartType, string> = { bar: "Bar", line: "Line", area: "Area", pie: "Pie", donut: "Donut", scatter: "Scatter", histogram: "Histogram", stacked: "Stacked bar", heatmap: "Heatmap", table: "Table" };

export function ChartCard({ spec, table, rows, onChange, onRemove, wide }: { spec: ChartSpec; table: Table; rows: number[]; onChange: (s: ChartSpec) => void; onRemove: () => void; wide?: boolean }) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const types = compatibleTypes(spec, table.schema);
  return (
    <section className={`card print-avoid flex min-w-0 flex-col p-4 ${wide ? "lg:col-span-2" : ""}`} data-chart-id={spec.id}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold" title={spec.title}>
            {spec.title}
          </h3>
          <p className="truncate text-xs text-ink-faint" title={spec.reason}>
            {spec.reason}
          </p>
        </div>
        <div className="no-print relative flex shrink-0 items-center gap-1">
          {types.length > 1 && (
            <select className="input w-auto py-1 text-xs" value={spec.type} aria-label="Chart type" onChange={(e) => onChange({ ...spec, type: e.target.value as ChartType })}>
              {types.map((t) => (
                <option key={t} value={t}>
                  {TYPE_NAMES[t]}
                </option>
              ))}
            </select>
          )}
          <button className="rounded p-1.5 text-ink-faint hover:bg-sunken hover:text-ink" aria-label="Chart options" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menu && (
            <>
              <button className="fixed inset-0 z-30 cursor-default" aria-label="Close menu" onClick={() => setMenu(false)} />
              <div className="absolute right-0 top-8 z-40 w-44 rounded-xl border border-line bg-surface p-1 text-sm" style={{ boxShadow: "var(--shadow-pop)" }}>
                <button className="w-full rounded px-3 py-2 text-left hover:bg-sunken" onClick={() => (setEditing(true), setMenu(false))}>
                  Customise chart
                </button>
                <button className="w-full rounded px-3 py-2 text-left text-bad hover:bg-bad-soft" onClick={() => (onRemove(), setMenu(false))}>
                  Remove chart
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <ChartView spec={spec} table={table} rows={rows} />
      <ChartEditor open={editing} spec={spec} schema={table.schema} onClose={() => setEditing(false)} onSave={(s) => (onChange(s), setEditing(false))} />
    </section>
  );
}

/** Add or customise a chart. Only offers combinations that make sense for the column types. */
export function ChartEditor({ open, spec, schema, onClose, onSave }: { open: boolean; spec?: ChartSpec; schema: ColumnSchema[]; onClose: () => void; onSave: (s: ChartSpec) => void }) {
  const visible = schema.filter((c) => !c.excluded);
  const measures = visible.filter((c) => isNumericType(c));
  const dims = visible.filter((c) => c.role === "dimension" || c.type === "category" || c.type === "boolean");
  const dates = visible.filter((c) => c.type === "date");
  const [draft, setDraft] = useState<ChartSpec>(
    spec ?? { id: `ch-${Date.now().toString(36)}`, type: "bar", title: "", x: dims[0]?.key ?? dates[0]?.key, y: measures[0]?.key, agg: measures[0] ? "sum" : "count", reason: "Added by you." },
  );
  const set = (p: Partial<ChartSpec>) => setDraft((d) => ({ ...d, ...p }));
  const kind: "category" | "time" | "numeric" | "pair" | "table" =
    draft.type === "table" ? "table" : draft.type === "scatter" ? "pair" : draft.type === "histogram" ? "numeric" : draft.type === "line" || draft.type === "area" ? "time" : "category";
  const xOptions = kind === "time" ? dates : kind === "numeric" || kind === "pair" ? measures : [...dims, ...dates];
  const name = (k?: string) => schema.find((c) => c.key === k)?.name ?? "";
  const autoTitle = () => {
    if (draft.type === "table") return "Data preview";
    if (draft.type === "histogram") return `Distribution of ${name(draft.x)}`;
    if (draft.type === "scatter") return `${name(draft.y)} vs ${name(draft.x)}`;
    const m = draft.agg === "count" || !draft.y ? "Rows" : `${AGG_OPTIONS.find((a) => a.value === draft.agg)?.label} ${name(draft.y)}`;
    return `${m} by ${name(draft.x)}${draft.series ? ` and ${name(draft.series)}` : ""}`;
  };
  const valid = kind === "table" || (draft.x && (kind !== "pair" || draft.y) && (!["stacked", "heatmap"].includes(draft.type) || draft.series));
  const invalidShare = (draft.type === "pie" || draft.type === "donut" || draft.type === "stacked") && !(draft.agg === "sum" || draft.agg === "count");

  return (
    <Modal
      open={open}
      title={spec ? "Customise chart" : "Add a chart"}
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!valid || invalidShare} onClick={() => onSave({ ...draft, title: draft.title.trim() || autoTitle(), y: draft.agg === "count" && kind !== "pair" ? undefined : draft.y })}>
            {spec ? "Save chart" : "Add chart"}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Chart type" htmlFor="ct">
          <select id="ct" className="input" value={draft.type} onChange={(e) => set({ type: e.target.value as ChartType, x: undefined, series: undefined })}>
            {(Object.keys(TYPE_NAMES) as ChartType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_NAMES[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title" htmlFor="cti" hint="Leave empty for an automatic title">
          <input id="cti" className="input" value={draft.title} maxLength={100} onChange={(e) => set({ title: e.target.value })} placeholder={autoTitle()} />
        </Field>
        {kind !== "table" && (
          <Field label={kind === "time" ? "Date column" : kind === "numeric" ? "Numeric column" : kind === "pair" ? "X axis (numeric)" : "Group by"} htmlFor="cx">
            <select id="cx" className="input" value={draft.x ?? ""} onChange={(e) => set({ x: e.target.value || undefined })}>
              <option value="">Choose…</option>
              {xOptions.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {(kind === "category" || kind === "time") && (
          <Field label="Calculate" htmlFor="ca">
            <select id="ca" className="input" value={draft.agg} onChange={(e) => set({ agg: e.target.value as ChartSpec["agg"] })}>
              {AGG_OPTIONS.filter((a) => a.value === "count" || measures.length).map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {((kind === "category" || kind === "time") && draft.agg !== "count") || kind === "pair" ? (
          <Field label={kind === "pair" ? "Y axis (numeric)" : "Of column"} htmlFor="cy">
            <select id="cy" className="input" value={draft.y ?? ""} onChange={(e) => set({ y: e.target.value || undefined })}>
              <option value="">Choose…</option>
              {measures.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {(draft.type === "stacked" || draft.type === "heatmap") && (
          <Field label="Split by" htmlFor="cs">
            <select id="cs" className="input" value={draft.series ?? ""} onChange={(e) => set({ series: e.target.value || undefined })}>
              <option value="">Choose…</option>
              {dims.filter((c) => c.key !== draft.x).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {invalidShare && <p className="mt-3 text-sm text-warn">Pie, donut and stacked charts show shares of a whole, so they need “Total” or “Count”.</p>}
    </Modal>
  );
}

const KPI_AGGS: { value: Agg; label: string; needs: "none" | "any" | "numeric" }[] = [
  { value: "count", label: "Count of rows", needs: "none" },
  { value: "countDistinct", label: "Count of different values", needs: "any" },
  { value: "sum", label: "Total (sum)", needs: "numeric" },
  { value: "avg", label: "Average", needs: "numeric" },
  { value: "median", label: "Median", needs: "numeric" },
  { value: "min", label: "Minimum", needs: "numeric" },
  { value: "max", label: "Maximum", needs: "numeric" },
  { value: "missingPct", label: "% missing", needs: "any" },
  { value: "share", label: "% of rows matching a value", needs: "any" },
];

export function KpiEditor({ open, schema, onClose, onSave }: { open: boolean; schema: ColumnSchema[]; onClose: () => void; onSave: (k: KpiDef) => void }) {
  const visible = schema.filter((c) => !c.excluded);
  const [agg, setAgg] = useState<Agg>("sum");
  const [col, setCol] = useState("");
  const [name, setName] = useState("");
  const [fCol, setFCol] = useState("");
  const [fVal, setFVal] = useState("");
  const meta = KPI_AGGS.find((a) => a.value === agg)!;
  const options = meta.needs === "numeric" ? visible.filter(isNumericType) : visible;
  const column = schema.find((c) => c.key === col);
  const filterCol = schema.find((c) => c.key === (agg === "share" ? col : fCol));
  const valid = meta.needs === "none" || (col && (agg !== "share" || fVal.trim()));
  const autoName = () => {
    if (agg === "count") return fCol && fVal ? `Rows where ${filterCol?.name} = ${fVal}` : "Rows";
    if (agg === "share") return `% ${column?.name} = ${fVal}`;
    return `${meta.label.replace(" (sum)", "")} ${column?.name ?? ""}`.trim();
  };
  const save = () => {
    const filter = agg === "share" ? { columnKey: col, values: [fVal.trim()] } : fCol && fVal.trim() ? { columnKey: fCol, values: [fVal.trim()] } : undefined;
    const format: KpiDef["format"] = agg === "share" || agg === "missingPct" ? "percent" : column?.type === "currency" && !["countDistinct", "count"].includes(agg) ? "currency" : column?.type === "percentage" && !["countDistinct", "count"].includes(agg) ? "percent" : agg === "avg" || agg === "median" ? "decimal" : "number";
    onSave({ id: `k-custom-${Date.now().toString(36)}`, name: name.trim() || autoName(), agg, columnKey: meta.needs === "none" ? undefined : col, filter, format, description: "Custom KPI added by you.", custom: true });
    setName("");
    setCol("");
    setFCol("");
    setFVal("");
  };
  return (
    <Modal
      open={open}
      title="Add a KPI"
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!valid} onClick={save}>
            Add KPI
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Calculation" htmlFor="ka">
          <select id="ka" className="input" value={agg} onChange={(e) => (setAgg(e.target.value as Agg), setCol(""))}>
            {KPI_AGGS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
        {meta.needs !== "none" && (
          <Field label="Column" htmlFor="kc">
            <select id="kc" className="input" value={col} onChange={(e) => setCol(e.target.value)}>
              <option value="">Choose…</option>
              {options.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {agg === "share" ? (
          <Field label="Value to match" htmlFor="kv" hint="Exact value, not case-sensitive">
            <input id="kv" className="input" value={fVal} onChange={(e) => setFVal(e.target.value)} placeholder="e.g. Pass" />
          </Field>
        ) : (
          <>
            <Field label="Only rows where (optional)" htmlFor="kf">
              <select id="kf" className="input" value={fCol} onChange={(e) => setFCol(e.target.value)}>
                <option value="">All rows</option>
                {visible.filter((c) => c.role === "dimension").map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            {fCol && (
              <Field label="equals" htmlFor="kfv">
                <input id="kfv" className="input" value={fVal} onChange={(e) => setFVal(e.target.value)} placeholder="Value" />
              </Field>
            )}
          </>
        )}
        <Field label="Name" htmlFor="kn" hint="Leave empty for an automatic name">
          <input id="kn" className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={valid ? autoName() : ""} />
        </Field>
      </div>
    </Modal>
  );
}
