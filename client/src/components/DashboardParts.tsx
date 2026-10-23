import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Info, Minus, Pencil, Trash2 } from "lucide-react";
import type { Agg, ColumnSchema, KpiDef, KpiValue } from "../engine/types";
import { isNumericType } from "../engine/table";
import { fmtNumber, fmtPercent } from "../engine/format";
import { Field, Modal } from "./ui";

export { ChartCard, ChartEditor } from "./ChartCard";

/** Tiny trend line for a KPI (one point per period). */
function Sparkline({ points }: { points: { label: string; value: number | null }[] }) {
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (vals.length < 3) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const w = 120;
  const h = 32;
  const step = w / (points.length - 1);
  const y = (v: number) => (max === min ? h / 2 : h - 3 - ((v - min) / (max - min)) * (h - 6));
  let d = "";
  points.forEach((p, i) => {
    if (p.value === null) return;
    d += `${d ? "L" : "M"}${(i * step).toFixed(1)},${y(p.value).toFixed(1)}`;
  });
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="my-2 h-7 w-full" preserveAspectRatio="none" role="img" aria-label={`Trend over ${points.length} periods, ${points[0].label} to ${last.label}`}>
      <title>{points.map((p) => `${p.label}: ${p.value ?? "—"}`).join("\n")}</title>
      <path d={`${d}L${w},${h}L0,${h}Z`} fill="var(--color-s1)" opacity={0.07} />
      <path d={d} fill="none" stroke="var(--color-s1)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      {last.value !== null && <circle cx={w} cy={y(last.value)} r={2.2} fill="var(--color-s1)" />}
    </svg>
  );
}

export function KpiCard({ def, value, onRemove, onRename }: { def: KpiDef; value?: KpiValue; onRemove?: () => void; onRename?: (name: string) => void }) {
  const [info, setInfo] = useState(false);
  const c = value?.comparison;
  const Icon = c?.direction === "up" ? ArrowUpRight : c?.direction === "down" ? ArrowDownRight : Minus;
  const tone = c?.direction === "up" ? "text-good" : c?.direction === "down" ? "text-bad" : "text-ink-faint";
  return (
    <div className="card group relative flex flex-col px-4 pb-3 pt-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-xs font-medium uppercase tracking-wide text-ink-soft" title={def.name}>
          {def.name}
        </p>
        <div className="no-print -mr-1 -mt-1 flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
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
      <p className="mt-2 break-words text-[1.6rem] font-semibold leading-tight tracking-tight text-ink">{value?.display ?? "—"}</p>
      {value?.trend && <Sparkline points={value.trend} />}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-2 text-xs">
        {c ? (
          <>
            <span className="truncate text-ink-faint" title={c.label}>
              {c.label}
            </span>
            <span className={`flex shrink-0 items-center gap-0.5 font-semibold ${tone}`}>
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {c.changePct === null ? (c.direction === "flat" ? "0%" : "new") : fmtPercent(Math.abs(c.changePct))}
            </span>
          </>
        ) : (
          <span className="text-ink-faint">{"\u00a0"}</span>
        )}
      </div>
      {info && value && (
        <div className="mt-2 space-y-1 rounded-md bg-sunken p-2.5 text-xs text-ink-soft">
          <p>
            <span className="font-medium text-ink">Formula:</span> {value.formula}
          </p>
          {value.sourceColumns.length > 0 && (
            <p>
              <span className="font-medium text-ink">Columns:</span> {value.sourceColumns.join(", ")}
            </p>
          )}
          {c && (
            <p>
              <span className="font-medium text-ink">Previous:</span> {fmtNumber(c.previous)} ({c.label})
            </p>
          )}
          <p>{def.description}</p>
        </div>
      )}
    </div>
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
