import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeftRight,
  ChartArea,
  ChartBar,
  ChartColumn,
  ChartColumnStacked,
  ChartLine,
  ChartNoAxesColumn,
  ChartPie,
  ChartScatter,
  Check,
  Donut,
  Download,
  Grid3x3,
  LayoutDashboard,
  Maximize2,
  MoreHorizontal,
  Table2,
} from "lucide-react";
import { toPng } from "html-to-image";
import type { ChartOptions, ChartSpec, ChartType, ColumnSchema, Table } from "../engine/types";
import { AGG_LABEL, chartDataTable, compatibleTypes } from "../engine/charts";
import { isNumericType } from "../engine/table";
import { ChartView, useChartData } from "./ChartView";
import { download, toCsv } from "../export/exporters";
import { Field, Modal } from "./ui";

export const TYPE_META: Record<ChartType, { label: string; Icon: typeof ChartColumn }> = {
  column: { label: "Column", Icon: ChartColumn },
  bar: { label: "Bar", Icon: ChartBar },
  line: { label: "Line", Icon: ChartLine },
  area: { label: "Area", Icon: ChartArea },
  stacked: { label: "Stacked", Icon: ChartColumnStacked },
  pie: { label: "Pie", Icon: ChartPie },
  donut: { label: "Donut", Icon: Donut },
  treemap: { label: "Treemap", Icon: LayoutDashboard },
  heatmap: { label: "Heatmap", Icon: Grid3x3 },
  scatter: { label: "Scatter", Icon: ChartScatter },
  histogram: { label: "Histogram", Icon: ChartNoAxesColumn },
  table: { label: "Table", Icon: Table2 },
};

/** Small popover anchored to a toolbar button. */
function Popover({ open, onClose, children, width = "w-56" }: { open: boolean; onClose: () => void; children: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <button className="fixed inset-0 z-30 cursor-default" aria-label="Close menu" onClick={onClose} />
      <div className={`absolute right-0 top-9 z-40 ${width} rounded-xl border border-line bg-surface p-1.5 text-sm`} style={{ boxShadow: "var(--shadow-pop)" }} role="menu">
        {children}
      </div>
    </>
  );
}

function ToolButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`rounded-md p-1.5 transition-colors ${active ? "bg-accent-soft text-accent" : "text-ink-faint hover:bg-sunken hover:text-ink"}`} aria-label={label} title={label} aria-pressed={active} onClick={onClick}>
      {children}
    </button>
  );
}

export function ChartCard({ spec, table, rows, onChange, onRemove, wide, animate = true }: { spec: ChartSpec; table: Table; rows: number[]; onChange: (s: ChartSpec) => void; onRemove: () => void; wide?: boolean; animate?: boolean }) {
  const [menu, setMenu] = useState<null | "type" | "download" | "more">(null);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const data = useChartData(spec, table, rows);
  const isRawTable = spec.type === "table" && !spec.x;
  const types = isRawTable ? [] : compatibleTypes(spec, table.schema);
  const opt = spec.options ?? {};
  const setOpt = (o: Partial<ChartOptions>) => onChange({ ...spec, options: { ...opt, ...o } });
  const lineLike = spec.type === "line" || spec.type === "area";
  const categorical = !isRawTable && ["column", "bar", "pie", "donut", "treemap", "stacked", "heatmap"].includes(spec.type) && table.schema.find((c) => c.key === spec.x)?.type !== "date";
  const xName = table.schema.find((c) => c.key === spec.x)?.name ?? "";
  const defaultSort = /year|\bfy\b|period|quarter|month|week/i.test(xName) && !["pie", "donut", "treemap"].includes(spec.type) ? "label" : "value-desc";
  const fileName = spec.title.replace(/[^\w\- ]+/g, " ").replace(/\s+/g, " ").trim() || "chart";

  const downloadPng = async () => {
    setMenu(null);
    if (!chartRef.current) return;
    const png = await toPng(chartRef.current, { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: true });
    const a = document.createElement("a");
    a.href = png;
    a.download = `${fileName}.png`;
    a.click();
  };
  const downloadCsv = () => {
    setMenu(null);
    const t = chartDataTable(data);
    if (t) download(`${fileName}.csv`, toCsv(t.headers, t.rows), "text/csv;charset=utf-8");
    else if (data.kind === "table") download(`${fileName}.csv`, toCsv(data.columns.map((c) => c.name), data.rows), "text/csv;charset=utf-8");
  };

  return (
    <section className={`card group print-avoid flex min-w-0 flex-col p-4 ${wide ? "lg:col-span-2" : ""}`} data-chart-id={spec.id}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="panel-title min-w-0 truncate" title={`${spec.title} — ${spec.reason}`}>
          {spec.title}
        </h3>
        <div className={`no-print relative flex shrink-0 items-center gap-0.5 transition-opacity ${menu ? "opacity-100" : "opacity-40 group-focus-within:opacity-100 group-hover:opacity-100"}`}>
          {types.length > 1 && (
            <ToolButton label="Change chart type" active={menu === "type"} onClick={() => setMenu(menu === "type" ? null : "type")}>
              <ArrowLeftRight className="h-4 w-4" />
            </ToolButton>
          )}
          {!isRawTable && (
            <ToolButton label={opt.asTable ? "Show as chart" : "Show as table"} active={opt.asTable} onClick={() => setOpt({ asTable: !opt.asTable })}>
              <Table2 className="h-4 w-4" />
            </ToolButton>
          )}
          <ToolButton label="Download" active={menu === "download"} onClick={() => setMenu(menu === "download" ? null : "download")}>
            <Download className="h-4 w-4" />
          </ToolButton>
          <ToolButton label="Expand" onClick={() => setExpanded(true)}>
            <Maximize2 className="h-4 w-4" />
          </ToolButton>
          <ToolButton label="More options" active={menu === "more"} onClick={() => setMenu(menu === "more" ? null : "more")}>
            <MoreHorizontal className="h-4 w-4" />
          </ToolButton>

          <Popover open={menu === "type"} onClose={() => setMenu(null)} width="w-60">
            <div className="grid grid-cols-2 gap-1">
              {[...types, "table" as ChartType].map((t) => {
                const { label, Icon } = TYPE_META[t];
                const current = t === "table" ? opt.asTable : !opt.asTable && spec.type === t;
                return (
                  <button
                    key={t}
                    role="menuitemradio"
                    aria-checked={current}
                    className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left ${current ? "bg-accent-soft font-medium text-accent" : "hover:bg-sunken"}`}
                    onClick={() => {
                      onChange(t === "table" ? { ...spec, options: { ...opt, asTable: true } } : { ...spec, type: t, options: { ...opt, asTable: false } });
                      setMenu(null);
                    }}
                  >
                    <Icon className="h-4 w-4" /> {label}
                  </button>
                );
              })}
            </div>
          </Popover>
          <Popover open={menu === "download"} onClose={() => setMenu(null)} width="w-48">
            {!opt.asTable && !isRawTable && (
              <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-sunken" role="menuitem" onClick={downloadPng}>
                Picture (PNG)
              </button>
            )}
            <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-sunken" role="menuitem" onClick={downloadCsv}>
              Numbers (CSV)
            </button>
          </Popover>
          <Popover open={menu === "more"} onClose={() => setMenu(null)} width="w-60">
            {!isRawTable && !opt.asTable && spec.type !== "heatmap" && spec.type !== "scatter" && (
              <Toggle label="Show values on chart" checked={Boolean(opt.labels)} onChange={(v) => setOpt({ labels: v })} />
            )}
            {lineLike && !opt.asTable && <Toggle label="Show dots on line" checked={opt.dots ?? true} onChange={(v) => setOpt({ dots: v })} />}
            {categorical && (
              <>
                <p className="px-3 pb-1 pt-2 text-xs font-medium text-ink-faint">Sort</p>
                {(
                  [
                    ["value-desc", "Largest first"],
                    ["value-asc", "Smallest first"],
                    ["label", "A → Z"],
                  ] as const
                ).map(([v, l]) => (
                  <Toggle key={v} radio label={l} checked={(opt.sort ?? defaultSort) === v} onChange={() => setOpt({ sort: v })} />
                ))}
                <p className="px-3 pb-1 pt-2 text-xs font-medium text-ink-faint">Show</p>
                <div className="flex gap-1 px-2 pb-1">
                  {[5, 10, 20, 50].map((n) => (
                    <button key={n} className={`flex-1 rounded-md border px-2 py-1 text-xs ${(opt.top ?? 12) === n ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-sunken"}`} onClick={() => setOpt({ top: n })}>
                      Top {n}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="my-1 border-t border-line" />
            <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-sunken" role="menuitem" onClick={() => (setEditing(true), setMenu(null))}>
              Customise columns & title…
            </button>
            <button className="w-full rounded-lg px-3 py-2 text-left text-bad hover:bg-bad-soft" role="menuitem" onClick={() => (onRemove(), setMenu(null))}>
              Remove chart
            </button>
          </Popover>
        </div>
      </div>
      <div ref={chartRef} data-chart-capture={spec.id} {...(isRawTable ? {} : { "data-capture": "", "data-capture-title": spec.title, "data-capture-note": spec.reason })} className="bg-white">
        <ChartView spec={spec} table={table} rows={rows} data={data} animate={animate} />
      </div>
      {editing && <ChartEditor open spec={spec} schema={table.schema} onClose={() => setEditing(false)} onSave={(s) => (onChange(s), setEditing(false))} />}
      <Modal open={expanded} title={spec.title} onClose={() => setExpanded(false)} wide>
        {expanded && <ChartView spec={spec} table={table} rows={rows} data={data} height={460} />}
      </Modal>
    </section>
  );
}

function Toggle({ label, checked, onChange, radio }: { label: string; checked: boolean; onChange: (v: boolean) => void; radio?: boolean }) {
  return (
    <button role={radio ? "menuitemradio" : "menuitemcheckbox"} aria-checked={checked} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-sunken" onClick={() => onChange(!checked)}>
      {label}
      {checked && <Check className="h-4 w-4 text-accent" />}
    </button>
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
const EDITABLE_TYPES: ChartType[] = ["column", "bar", "line", "area", "stacked", "pie", "donut", "treemap", "heatmap", "scatter", "histogram", "table"];

/** Add or customise a chart. Only offers combinations that make sense for the column types. */
export function ChartEditor({ open, spec, schema, onClose, onSave }: { open: boolean; spec?: ChartSpec; schema: ColumnSchema[]; onClose: () => void; onSave: (s: ChartSpec) => void }) {
  const visible = schema.filter((c) => !c.excluded);
  const measures = visible.filter((c) => isNumericType(c));
  const dims = visible.filter((c) => c.role === "dimension" || c.type === "category" || c.type === "boolean");
  const dates = visible.filter((c) => c.type === "date");
  const [draft, setDraft] = useState<ChartSpec>(
    spec ?? { id: `ch-${Date.now().toString(36)}`, type: "column", title: "", x: dims[0]?.key ?? dates[0]?.key, y: measures[0]?.key, agg: measures[0] ? "sum" : "count", reason: "Added by you." },
  );
  const [multi, setMulti] = useState<boolean>(Boolean(spec?.measures && spec.measures.length > 1));
  const set = (p: Partial<ChartSpec>) => setDraft((d) => ({ ...d, ...p }));
  const isTable = draft.type === "table" && !draft.x;
  const kind: "category" | "numeric" | "pair" | "table" = isTable ? "table" : draft.type === "scatter" ? "pair" : draft.type === "histogram" ? "numeric" : "category";
  const canMulti = kind === "category" && ["column", "bar", "line", "area", "stacked"].includes(draft.type) && measures.length >= 2;
  const xOptions = kind === "numeric" || kind === "pair" ? measures : [...dates, ...dims];
  const name = (k?: string) => schema.find((c) => c.key === k)?.name ?? "";
  const chosen = draft.measures ?? [];
  const autoTitle = () => {
    if (isTable) return "Data preview";
    if (draft.type === "histogram") return `Distribution of ${name(draft.x)}`;
    if (draft.type === "scatter") return `${name(draft.y)} vs ${name(draft.x)}`;
    if (multi && chosen.length > 1) return `${chosen.map(name).join(", ")} by ${name(draft.x)}`;
    const m = draft.agg === "count" || !draft.y ? "Rows" : `${AGG_LABEL[draft.agg]} ${name(draft.y)}`;
    return `${m} by ${name(draft.x)}${draft.series ? ` and ${name(draft.series)}` : ""}`;
  };
  const multiOk = !multi || chosen.length >= 2;
  const valid = isTable || (draft.x && (kind !== "pair" || draft.y) && (draft.type !== "heatmap" || draft.series) && multiOk);
  const invalidShare = ["pie", "donut", "treemap", "stacked"].includes(draft.type) && !multi && !(draft.agg === "sum" || draft.agg === "count");

  const save = () => {
    const out: ChartSpec = { ...draft, title: draft.title.trim() || autoTitle() };
    if (multi && canMulti) {
      out.measures = chosen;
      out.y = undefined;
      out.series = undefined;
      if (out.agg === "count") out.agg = "sum";
    } else {
      out.measures = undefined;
      if (out.agg === "count" && kind !== "pair") out.y = undefined;
    }
    if (isTable) out.x = undefined;
    onSave(out);
  };

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
          <button className="btn-primary" disabled={!valid || invalidShare} onClick={save}>
            {spec ? "Save chart" : "Add chart"}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Chart type" htmlFor="ct">
          <select id="ct" className="input" value={draft.type} onChange={(e) => set({ type: e.target.value as ChartType, ...(e.target.value === "table" ? { x: undefined } : {}) })}>
            {EDITABLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === "table" ? "Data table (rows)" : TYPE_META[t].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title" htmlFor="cti" hint="Leave empty for an automatic title">
          <input id="cti" className="input" value={draft.title} maxLength={100} onChange={(e) => set({ title: e.target.value })} placeholder={valid ? autoTitle() : ""} />
        </Field>
        {kind !== "table" && (
          <Field label={kind === "numeric" ? "Numeric column" : kind === "pair" ? "X axis (numeric)" : "Group by (category or date)"} htmlFor="cx">
            <select id="cx" className="input" value={draft.x ?? ""} onChange={(e) => set({ x: e.target.value || undefined })}>
              <option value="">Choose…</option>
              {xOptions.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                  {c.type === "date" ? " (date)" : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
        {kind === "category" && (
          <Field label="Calculate" htmlFor="ca">
            <select id="ca" className="input" value={draft.agg} onChange={(e) => set({ agg: e.target.value as ChartSpec["agg"] })}>
              {AGG_OPTIONS.filter((a) => a.value === "count" ? !multi : measures.length > 0).map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {canMulti && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={multi} onChange={(e) => (setMulti(e.target.checked), e.target.checked && draft.agg === "count" && set({ agg: "sum" }))} />
            Compare several measures side by side (e.g. EBITDA, EBIT and PAT)
          </label>
        )}
        {multi && canMulti ? (
          <fieldset className="sm:col-span-2">
            <legend className="label">Measures to compare (2–6)</legend>
            <div className="grid gap-1.5 sm:grid-cols-3">
              {measures.map((m) => (
                <label key={m.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={chosen.includes(m.key)}
                    disabled={!chosen.includes(m.key) && chosen.length >= 6}
                    onChange={(e) => set({ measures: e.target.checked ? [...chosen, m.key] : chosen.filter((k) => k !== m.key) })}
                  />
                  <span className="truncate">{m.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : (kind === "category" && draft.agg !== "count") || kind === "pair" ? (
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
        {!multi && (draft.type === "stacked" || draft.type === "heatmap") && (
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
      {invalidShare && <p className="mt-3 text-sm text-warn">Pie, donut, treemap and stacked charts show shares of a whole, so they need “Total” or “Count”.</p>}
      {multi && chosen.length < 2 && <p className="mt-3 text-sm text-ink-soft">Pick at least two measures to compare.</p>}
    </Modal>
  );
}
