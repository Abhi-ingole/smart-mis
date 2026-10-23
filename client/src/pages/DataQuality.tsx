import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { HelpCircle, RotateCcw, Undo2, Wand2 } from "lucide-react";
import { DatasetGate, DatasetSwitcher, type Loaded } from "../components/DatasetGate";
import { Alert, Field, PageHeader, QualityRing, Tabs, TypeBadge, TYPE_LABEL, useToast } from "../components/ui";
import type { CleaningOp, ColType, ColumnSchema, Role, Semantic } from "../engine/types";
import { resolveAmbiguity, roleForType, semanticFor } from "../engine/infer";
import { applyOp, applyOps, describeOp, isNumericType } from "../engine/table";
import { recommendKpis } from "../engine/kpi";
import { recommendCharts } from "../engine/charts";
import { analyzeRecord } from "../engine/pipeline";
import { fmtNumber, fmtPercent, fmtValue } from "../engine/format";

type Tab = "overview" | "mapping" | "cleaning";

export default function DataQualityPage() {
  return (
    <DatasetGate base="/quality" title="Data quality">
      {(d) => <Quality key={d.record.id} {...d} />}
    </DatasetGate>
  );
}

function Quality(d: Loaded) {
  const [params, setParams] = useSearchParams();
  const tab = (["overview", "mapping", "cleaning"].includes(params.get("tab") ?? "") ? params.get("tab") : "overview") as Tab;
  const { record, analysis } = d;
  const open = record.schema.filter((c) => c.ambiguity && !c.ambiguity.resolved && !c.excluded).length;
  return (
    <div>
      <PageHeader
        eyebrow={<DatasetSwitcher base="/quality" currentId={record.id} />}
        title="Data quality & columns"
        description={`${record.name} — review problems, confirm what each column means, and clean the data. The original upload is always kept.`}
        actions={
          <>
            <Link to={`/mapping/${record.id}`} className="btn-secondary">
              Review columns
            </Link>
            <Link to={`/dashboard/${record.id}`} className="btn-secondary">
              Back to dashboard
            </Link>
          </>
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        tabs={[
          { id: "overview", label: `Issues (${analysis.quality.issues.length})` },
          { id: "mapping", label: <>Column table{open > 0 && <span className="ml-1.5 rounded bg-warn px-1.5 text-xs text-white">{open}</span>}</> },
          { id: "cleaning", label: `Cleaning steps (${record.ops.length})` },
        ]}
      />
      {tab === "overview" && <Issues {...d} />}
      {tab === "mapping" && <Mapping {...d} />}
      {tab === "cleaning" && <Cleaning {...d} />}
    </div>
  );
}

function Issues({ record, analysis }: Loaded) {
  const { quality, profiles, table } = analysis;
  const [showDup, setShowDup] = useState(false);
  const sev = { high: "bg-bad", medium: "bg-warn", low: "bg-ink-faint" };
  return (
    <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
      <div className="space-y-4">
        <div className="card p-5 text-center">
          <div className="flex justify-center">
            <QualityRing score={quality.score} size={96} />
          </div>
          <p className="mt-3 font-semibold">Quality score</p>
          <p className="mt-1 text-xs text-ink-soft">{quality.scoreFormula}</p>
        </div>
        <div className="card space-y-2 p-4 text-sm">
          <Row label="Completeness" value={fmtPercent(quality.completeness)} />
          <Row label="Duplicate rows" value={fmtNumber(quality.duplicateRows)} />
          <Row label="Rows analysed" value={fmtNumber(table.rows.length)} />
          <Row label="Original rows" value={fmtNumber(record.rowCount)} />
        </div>
        {record.warnings.length > 0 && (
          <div className="card p-4 text-sm">
            <p className="font-semibold">Notes from reading the file</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-ink-soft">
              {record.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="space-y-3">
        {quality.issues.length === 0 && <Alert kind="success">No data quality issues found.</Alert>}
        {quality.issues.map((i) => (
          <div key={i.id} className="card flex gap-3 p-4">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${sev[i.severity]}`} aria-label={`${i.severity} severity`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm">{i.message}</p>
              {i.suggestion && <p className="mt-1 text-xs text-ink-soft">{i.suggestion}</p>}
              {i.kind === "duplicates" && (
                <button className="mt-2 text-xs text-accent hover:underline" onClick={() => setShowDup(!showDup)}>
                  {showDup ? "Hide" : "Inspect"} duplicates
                </button>
              )}
              {i.kind === "duplicates" && showDup && (
                <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-line">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Rows (in file order)</th>
                        {table.schema.slice(0, 5).map((c) => (
                          <th key={c.key}>{c.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {quality.duplicateGroups.slice(0, 30).map((g) => (
                        <tr key={g.join("-")}>
                          <td className="whitespace-nowrap">{g.map((r) => r + 1).join(", ")}</td>
                          {table.schema.slice(0, 5).map((c) => (
                            <td key={c.key} className="max-w-[10rem] truncate">
                              {table.str[c.key][g[0]] ?? "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {i.columnKey && profiles[i.columnKey]?.numeric && i.kind === "outliers" && (
                <p className="mt-1 text-xs text-ink-faint">
                  Typical range {fmtValue(profiles[i.columnKey]!.numeric!.q1, table.schema.find((c) => c.key === i.columnKey))} – {fmtValue(profiles[i.columnKey]!.numeric!.q3, table.schema.find((c) => c.key === i.columnKey))}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between">
    <span className="text-ink-soft">{label}</span>
    <span className="font-medium">{value}</span>
  </div>
);

const TYPES: ColType[] = ["number", "currency", "percentage", "date", "category", "boolean", "text", "identifier"];
const ROLES: { value: Role; label: string }[] = [
  { value: "measure", label: "Measure (numbers to add/average)" },
  { value: "dimension", label: "Dimension (group by)" },
  { value: "time", label: "Time" },
  { value: "identifier", label: "Identifier" },
  { value: "ignore", label: "Ignore in charts" },
];
const SEMANTICS: Semantic[] = ["none", "revenue", "cost", "profit", "price", "quantity", "salary", "score", "rating", "age", "duration", "employee_id", "student_id", "order_id", "person", "customer", "product", "category", "region", "department", "status", "result", "subject", "gender", "payment", "date"];

function Mapping({ record, analysis, update }: Loaded) {
  const [schema, setSchema] = useState<ColumnSchema[]>(record.schema);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const dirty = JSON.stringify(schema) !== JSON.stringify(record.schema);
  const questions = schema.filter((c) => c.ambiguity && !c.ambiguity.resolved && !c.excluded);
  const set = (key: string, fn: (c: ColumnSchema) => ColumnSchema) => setSchema((s) => s.map((c) => (c.key === key ? fn(c) : c)));
  const names = schema.map((c) => c.name.trim().toLowerCase());
  const dupName = names.find((n, i) => names.indexOf(n) !== i);

  const save = async (rebuild: boolean) => {
    setSaving(true);
    try {
      if (rebuild) {
        const a = analyzeRecord({ ...record, schema });
        await update({ schema, dashboard: { kpis: recommendKpis(schema, a.profiles, a.domain, a.table), charts: recommendCharts(schema, a.profiles, a.domain, a.table) }, domain: a.domain, qualityScore: a.quality.score });
        toast("success", "Column settings saved and dashboard rebuilt.");
      } else {
        const a = analyzeRecord({ ...record, schema });
        await update({ schema, domain: a.domain, qualityScore: a.quality.score });
        toast("success", "Column settings saved. Existing KPIs and charts were kept.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {questions.length > 0 && (
        <div className="card border-warn/30 p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <HelpCircle className="h-4 w-4 text-warn" /> Please confirm {questions.length} column{questions.length > 1 ? "s" : ""}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">The data alone can't tell us. Until you answer, the option marked “current” is used.</p>
          <div className="mt-4 space-y-4">
            {questions.map((c) => (
              <div key={c.key} className="rounded-lg border border-line p-3">
                <p className="text-sm font-medium">{c.ambiguity!.question}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {c.ambiguity!.options.map((o) => (
                    <button key={o.value} className={o.value === c.ambiguity!.current ? "btn-primary py-1.5" : "btn-secondary py-1.5"} onClick={() => set(c.key, (col) => resolveAmbiguity(col, o.value))}>
                      {o.label}
                      {o.value === c.ambiguity!.current && <span className="text-xs opacity-80">(current)</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Use</th>
              <th>Column name</th>
              <th>Type</th>
              <th>Role</th>
              <th>Meaning</th>
              <th>Values</th>
            </tr>
          </thead>
          <tbody>
            {schema.map((c) => {
              const p = analysis.profiles[c.key];
              return (
                <tr key={c.key} className={c.excluded ? "opacity-50" : ""}>
                  <td>
                    <input type="checkbox" checked={!c.excluded} aria-label={`Include ${c.name}`} onChange={(e) => set(c.key, (col) => ({ ...col, excluded: !e.target.checked }))} />
                  </td>
                  <td className="min-w-[12rem]">
                    <input className="input py-1.5" value={c.name} maxLength={80} aria-label={`Name of column ${c.originalName}`} onChange={(e) => set(c.key, (col) => ({ ...col, name: e.target.value }))} />
                    {c.name !== c.originalName && <p className="mt-0.5 text-xs text-ink-faint">Originally “{c.originalName}”</p>}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <select
                        className="input w-auto py-1.5"
                        value={c.type}
                        aria-label={`Type of ${c.name}`}
                        onChange={(e) =>
                          set(c.key, (col) => {
                            const type = e.target.value as ColType;
                            return { ...col, type, role: roleForType(type, col.role), semantic: semanticFor(col.name, type), percentScale: type === "percentage" ? (col.percentScale ?? "whole") : col.percentScale, ambiguity: col.ambiguity ? { ...col.ambiguity, resolved: true, current: type } : undefined };
                          })
                        }
                      >
                        {TYPES.map((t) => (
                          <option key={t} value={t}>
                            {TYPE_LABEL[t]}
                          </option>
                        ))}
                      </select>
                      {c.type !== c.detectedType && <span className="text-xs text-ink-faint">was {TYPE_LABEL[c.detectedType]}</span>}
                    </div>
                    {c.type === "percentage" && (
                      <select className="input mt-1 w-auto py-1 text-xs" value={c.percentScale ?? "whole"} aria-label="Percentage scale" onChange={(e) => set(c.key, (col) => ({ ...col, percentScale: e.target.value as "whole" | "fraction" }))}>
                        <option value="whole">25 means 25%</option>
                        <option value="fraction">0.25 means 25%</option>
                      </select>
                    )}
                    {c.type === "date" && (
                      <select className="input mt-1 w-auto py-1 text-xs" value={c.dateOrder ?? "dmy"} aria-label="Date order" onChange={(e) => set(c.key, (col) => ({ ...col, dateOrder: e.target.value as "dmy" | "mdy" }))}>
                        <option value="dmy">Day/Month/Year</option>
                        <option value="mdy">Month/Day/Year</option>
                      </select>
                    )}
                  </td>
                  <td>
                    <select className="input w-auto py-1.5" value={c.role} aria-label={`Role of ${c.name}`} onChange={(e) => set(c.key, (col) => ({ ...col, role: e.target.value as Role }))}>
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value} disabled={(r.value === "measure" && !isNumericType(c)) || (r.value === "time" && c.type !== "date")}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select className="input w-auto py-1.5" value={c.semantic} aria-label={`Meaning of ${c.name}`} onChange={(e) => set(c.key, (col) => ({ ...col, semantic: e.target.value as Semantic }))}>
                      {SEMANTICS.map((s) => (
                        <option key={s} value={s}>
                          {s === "none" ? "—" : s.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="min-w-[12rem] text-xs text-ink-soft">
                    <TypeBadge type={c.detectedType} /> <span className="ml-1">{p ? `${fmtNumber(p.distinct)} distinct · ${fmtPercent(p.missingPct)} empty` : ""}</span>
                    <p className="mt-1 truncate text-ink-faint" title={p?.sample.join(", ")}>
                      e.g. {p?.sample.slice(0, 3).join(", ") || "—"}
                    </p>
                    {c.notes.map((n) => (
                      <p key={n} className="text-ink-faint">
                        {n}
                      </p>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {dupName && <Alert kind="warn">Two columns are both named “{dupName}”. Give them different names.</Alert>}
      <div className="no-print sticky bottom-4 flex flex-wrap justify-end gap-2">
        {dirty && (
          <button className="btn-secondary" onClick={() => setSchema(record.schema)}>
            <Undo2 className="h-4 w-4" /> Undo changes
          </button>
        )}
        <button className="btn-secondary" disabled={!dirty || saving || Boolean(dupName)} onClick={() => save(false)}>
          Save, keep dashboard
        </button>
        <button className="btn-primary" disabled={!dirty || saving || Boolean(dupName)} onClick={() => save(true)}>
          <Wand2 className="h-4 w-4" /> Save and rebuild dashboard
        </button>
      </div>
    </div>
  );
}

function Cleaning({ record, analysis, update }: Loaded) {
  const toast = useToast();
  const [pending, setPending] = useState<CleaningOp[]>([]);
  const [col, setCol] = useState("");
  const [method, setMethod] = useState<"value" | "mean" | "median" | "mode" | "zero" | "drop">("value");
  const [value, setValue] = useState("Unknown");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const visible = record.schema.filter((c) => !c.excluded);
  const column = record.schema.find((c) => c.key === col);

  // Preview: original → applied steps → pending steps, showing what each pending step changes.
  const base = useMemo(() => applyOps(record.rows, record.schema, record.ops), [record]);
  const previews = useMemo(() => {
    let rows = base;
    return pending.map((op) => {
      const r = applyOp(rows, record.schema, op);
      rows = r.rows;
      return r;
    });
  }, [base, pending, record.schema]);

  const stage = (op: CleaningOp) => setPending((p) => [...p, op]);
  const apply = async () => {
    const ops = [...record.ops, ...pending];
    const a = analyzeRecord({ ...record, ops });
    await update({ ops, qualityScore: a.quality.score });
    setPending([]);
    toast("success", `${pending.length} cleaning step(s) applied. The original upload is unchanged.`);
  };
  const missingCols = visible.filter((c) => (analysis.profiles[c.key]?.missing ?? 0) > 0);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        <div className="card p-5">
          <h2 className="font-semibold">Quick fixes</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => stage({ kind: "removeDuplicates" })} disabled={analysis.quality.duplicateRows === 0}>
              Remove duplicate rows ({fmtNumber(analysis.quality.duplicateRows)})
            </button>
            <button className="btn-secondary" onClick={() => stage({ kind: "trim" })}>
              Trim extra spaces (all columns)
            </button>
          </div>
        </div>
        <div className="card p-5">
          <h2 className="font-semibold">Handle missing values</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Column" htmlFor="mc">
              <select id="mc" className="input" value={col} onChange={(e) => setCol(e.target.value)}>
                <option value="">Choose…</option>
                {missingCols.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name} ({fmtNumber(analysis.profiles[c.key]!.missing)} empty)
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Action" htmlFor="mm">
              <select id="mm" className="input" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                <option value="value">Fill with a value</option>
                {column && isNumericType(column) && <option value="median">Fill with median</option>}
                {column && isNumericType(column) && <option value="mean">Fill with average</option>}
                {column && isNumericType(column) && <option value="zero">Fill with 0</option>}
                <option value="mode">Fill with most common value</option>
                <option value="drop">Remove those rows</option>
              </select>
            </Field>
            {method === "value" && (
              <Field label="Value" htmlFor="mv">
                <input id="mv" className="input" value={value} onChange={(e) => setValue(e.target.value)} />
              </Field>
            )}
          </div>
          <button
            className="btn-secondary mt-3"
            disabled={!col}
            onClick={() => stage(method === "drop" ? { kind: "dropMissingRows", columnKey: col } : { kind: "fillMissing", columnKey: col, method, value: method === "value" ? value : undefined })}
          >
            Preview this step
          </button>
          {missingCols.length === 0 && <p className="mt-2 text-sm text-ink-soft">No missing values in the included columns.</p>}
        </div>
        <div className="card p-5">
          <h2 className="font-semibold">Replace a value</h2>
          <p className="text-sm text-ink-soft">Fix spellings or merge labels, e.g. “Mumbai ” → “Mumbai”, or “N/A” → empty.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Column" htmlFor="rc">
              <select id="rc" className="input" value={col} onChange={(e) => setCol(e.target.value)}>
                <option value="">Choose…</option>
                {visible.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Find" htmlFor="rf">
              <input id="rf" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Replace with" htmlFor="rt" hint="Leave empty to clear the value">
              <input id="rt" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <button className="btn-secondary mt-3" disabled={!col || !from.trim()} onClick={() => stage({ kind: "replaceValue", columnKey: col, from, to })}>
            Preview this step
          </button>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="card p-4">
          <h2 className="font-semibold">Pending changes</h2>
          {pending.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">Nothing staged. Steps are previewed here before you apply them.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {pending.map((op, i) => {
                const r = previews[i];
                return (
                  <li key={i} className="rounded-lg border border-line p-3 text-sm">
                    <div className="flex justify-between gap-2">
                      <p className="font-medium">{describeOp(op, record.schema)}</p>
                      <button className="text-ink-faint hover:text-bad" aria-label="Undo this step" onClick={() => setPending((p) => p.filter((_, j) => j !== i))}>
                        <Undo2 className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-ink-soft">{r.removedRows ? `${fmtNumber(r.removedRows)} row(s) will be removed.` : `${fmtNumber(r.changedCells)} value(s) will change.`}</p>
                    {r.examples.slice(0, 3).map((e, k) => (
                      <p key={k} className="mt-0.5 truncate text-xs text-ink-faint">
                        Row {e.row}
                        {e.column ? ` · ${e.column}` : ""}: {e.before} → {e.after}
                      </p>
                    ))}
                  </li>
                );
              })}
            </ul>
          )}
          {pending.length > 0 && (
            <div className="mt-3 flex gap-2">
              <button className="btn-primary flex-1" onClick={apply}>
                Apply {pending.length} step{pending.length > 1 ? "s" : ""}
              </button>
              <button className="btn-secondary" onClick={() => setPending([])}>
                Discard
              </button>
            </div>
          )}
        </div>
        <div className="card p-4">
          <h2 className="font-semibold">Applied steps</h2>
          {record.ops.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">The data is exactly as uploaded.</p>
          ) : (
            <>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                {record.ops.map((op, i) => (
                  <li key={i} className="flex items-start justify-between gap-2">
                    <span>{describeOp(op, record.schema)}</span>
                    {i === record.ops.length - 1 && (
                      <button className="shrink-0 text-xs text-accent hover:underline" onClick={() => update({ ops: record.ops.slice(0, -1) })}>
                        Undo
                      </button>
                    )}
                  </li>
                ))}
              </ol>
              <button className="btn-ghost mt-3 w-full text-sm" onClick={() => update({ ops: [] })}>
                <RotateCcw className="h-4 w-4" /> Reset to original upload
              </button>
            </>
          )}
          <p className="mt-3 text-xs text-ink-faint">
            {fmtNumber(record.rowCount)} original rows → {fmtNumber(base.length)} rows after cleaning.
          </p>
        </div>
      </aside>
    </div>
  );
}
