import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Check, CheckCheck, ListChecks, Undo2 } from "lucide-react";
import { DatasetGate, DatasetSwitcher, type Loaded } from "../components/DatasetGate";
import { Alert, PageHeader, TypeBadge, TYPE_LABEL, useToast } from "../components/ui";
import type { ColType, ColumnSchema, DatasetRecord, Role, Semantic } from "../engine/types";
import { resolveAmbiguity, roleForType, semanticFor } from "../engine/infer";
import { isNumericType } from "../engine/table";
import { recommendKpis } from "../engine/kpi";
import { recommendCharts } from "../engine/charts";
import { analyzeRecord } from "../engine/pipeline";
import { certainty, explainColumn, ROLE_HINT, ROLE_LABEL, SEMANTIC_LABEL } from "../engine/explain";

export default function MappingPage() {
  return (
    <DatasetGate base="/mapping" title="Review columns">
      {(d) => <Mapping key={d.record.id} {...d} />}
    </DatasetGate>
  );
}

const TYPES: ColType[] = ["number", "currency", "percentage", "date", "category", "boolean", "text", "identifier"];
const ROLES: Role[] = ["measure", "dimension", "time", "identifier", "ignore"];
const SEMANTICS = Object.keys(SEMANTIC_LABEL) as Semantic[];
const CERT = {
  high: { label: "Clear match", cls: "bg-good-soft text-good" },
  medium: { label: "Likely", cls: "bg-accent-soft text-s1" },
  low: { label: "Please check", cls: "bg-warn-soft text-warn" },
};

/** Shown on the dashboard until the column mapping has been confirmed once. */
export function MappingBanner({ record }: { record: DatasetRecord }) {
  if (record.mappingConfirmedAt) return null;
  const open = record.schema.filter((c) => !c.excluded && ((c.ambiguity && !c.ambiguity.resolved) || certainty(c) === "low")).length;
  return (
    <div className="no-print flex flex-col gap-3 rounded-lg border border-s1/20 bg-accent-soft/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-start gap-2.5 text-sm text-ink">
        <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-s1" />
        <span>
          <span className="font-medium">Check how your columns were read.</span> The figures below use our suggested type and meaning for each of the {record.schema.filter((c) => !c.excluded).length}{" "}
          columns
          {open > 0 ? ` — ${open} need${open === 1 ? "s" : ""} a closer look.` : "."}
        </span>
      </p>
      <Link to={`/mapping/${record.id}`} className="btn-primary shrink-0 py-1.5">
        Review columns <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

function Mapping({ record, analysis, update }: Loaded) {
  const [schema, setSchema] = useState<ColumnSchema[]>(record.schema);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  const set = (key: string, fn: (c: ColumnSchema) => ColumnSchema) => setSchema((s) => s.map((c) => (c.key === key ? fn(c) : c)));
  const visible = schema.filter((c) => !c.excluded);
  const confirmed = visible.filter((c) => c.confirmed).length;
  const names = schema.map((c) => c.name.trim().toLowerCase());
  const dupName = names.find((n, i) => names.indexOf(n) !== i);
  const structural = (s: ColumnSchema[]) => JSON.stringify(s.map(({ confirmed: _c, ...rest }) => rest));
  const changed = structural(schema) !== structural(record.schema);
  const order = useMemo(() => {
    const rank = { low: 0, medium: 1, high: 2 };
    return [...schema].sort((a, b) => Number(a.excluded) - Number(b.excluded) || rank[certainty(a)] - rank[certainty(b)] || a.index - b.index);
  }, [schema]);

  const confirmAll = () => setSchema((s) => s.map((c) => (c.excluded ? c : { ...c, confirmed: true, ambiguity: c.ambiguity ? { ...c.ambiguity, resolved: true } : undefined })));

  const save = async () => {
    setSaving(true);
    try {
      const final = schema.map((c) => (c.excluded ? c : { ...c, confirmed: true, ambiguity: c.ambiguity ? { ...c.ambiguity, resolved: true } : undefined }));
      const a = analyzeRecord({ ...record, schema: final });
      const patch: Parameters<typeof update>[0] = { schema: final, mappingConfirmedAt: new Date().toISOString(), domain: a.domain, qualityScore: a.quality.score };
      if (changed) {
        const custom = record.dashboard.kpis.filter((k) => k.custom);
        patch.dashboard = { kpis: [...recommendKpis(final, a.profiles, a.domain, a.table), ...custom], charts: recommendCharts(final, a.profiles, a.domain, a.table) };
      }
      await update(patch);
      toast("success", changed ? "Columns confirmed. KPIs and charts were rebuilt with your choices." : "Columns confirmed.");
      navigate(`/dashboard/${record.id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 pb-20">
      <PageHeader
        eyebrow={<DatasetSwitcher base="/mapping" currentId={record.id} />}
        title="Review columns"
        description="Each column has a suggested type, use and meaning, based on its header and values. Check the ones marked “Please check”, change anything that's wrong, then confirm."
        actions={
          <button className="btn-secondary" onClick={confirmAll}>
            <CheckCheck className="h-4 w-4" /> Accept all suggestions
          </button>
        }
      />

      <div className="card flex flex-wrap items-center gap-4 px-4 py-3">
        <div className="h-2 min-w-[10rem] flex-1 overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-s2 transition-all" style={{ width: `${visible.length ? (confirmed / visible.length) * 100 : 0}%` }} />
        </div>
        <p className="text-sm text-ink-soft">
          <span className="font-semibold text-ink">{confirmed}</span> of {visible.length} columns confirmed
        </p>
      </div>

      <div className="grid gap-3">
        {order.map((c) => {
          const p = analysis.profiles[c.key];
          const cert = certainty(c);
          const why = explainColumn(c, p);
          return (
            <article
              key={c.key}
              className={`card grid gap-4 p-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,24rem)] ${c.excluded ? "opacity-55" : ""} ${c.confirmed && !c.excluded ? "border-s2/40" : ""}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <input
                    className="input py-1.5 font-medium"
                    value={c.name}
                    maxLength={80}
                    aria-label={`Name of column ${c.originalName}`}
                    onChange={(e) => set(c.key, (col) => ({ ...col, name: e.target.value }))}
                  />
                </div>
                {c.name !== c.originalName && <p className="mt-1 text-xs text-ink-faint">Originally “{c.originalName}”</p>}
                <p className="mt-2 truncate text-xs text-ink-faint" title={p?.sample.join(", ")}>
                  e.g. {p?.sample.slice(0, 3).join(" · ") || "—"}
                </p>
                <label className="mt-2 flex items-center gap-2 text-xs text-ink-soft">
                  <input type="checkbox" checked={!c.excluded} onChange={(e) => set(c.key, (col) => ({ ...col, excluded: !e.target.checked, confirmed: false }))} /> Use this column
                </label>
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <TypeBadge type={c.type} />
                  <span className="text-sm font-medium text-ink">{c.semantic !== "none" ? SEMANTIC_LABEL[c.semantic] : TYPE_LABEL[c.type]}</span>
                  <span className="text-sm text-ink-soft">· {ROLE_LABEL[c.role]}</span>
                  {!c.excluded && (
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${c.confirmed ? "bg-good-soft text-good" : CERT[cert].cls}`}>{c.confirmed ? "Confirmed" : CERT[cert].label}</span>
                  )}
                </div>
                <ul className="mt-2 space-y-0.5 text-xs text-ink-soft">
                  {why.map((w) => (
                    <li key={w}>• {w}</li>
                  ))}
                </ul>
                {c.ambiguity && !c.ambiguity.resolved && !c.excluded && (
                  <div className="mt-3 rounded-md border border-warn/30 bg-warn-soft/60 p-2.5">
                    <p className="text-sm font-medium">{c.ambiguity.question}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {c.ambiguity.options.map((o) => (
                        <button
                          key={o.value}
                          className={`${o.value === c.ambiguity!.current ? "btn-primary" : "btn-secondary"} px-2.5 py-1 text-xs`}
                          onClick={() => set(c.key, (col) => ({ ...resolveAmbiguity(col, o.value), confirmed: true }))}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 self-start">
                <label className="text-xs text-ink-soft">
                  Type
                  <select
                    className="input mt-0.5 py-1.5"
                    value={c.type}
                    disabled={c.excluded}
                    onChange={(e) =>
                      set(c.key, (col) => {
                        const type = e.target.value as ColType;
                        return {
                          ...col,
                          type,
                          role: roleForType(type, col.role),
                          semantic: semanticFor(col.name, type),
                          percentScale: type === "percentage" ? (col.percentScale ?? "whole") : col.percentScale,
                          ambiguity: col.ambiguity ? { ...col.ambiguity, resolved: true, current: type } : undefined,
                          confirmed: true,
                        };
                      })
                    }
                  >
                    {TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-ink-soft">
                  Use as
                  <select
                    className="input mt-0.5 py-1.5"
                    value={c.role}
                    disabled={c.excluded}
                    title={ROLE_HINT[c.role]}
                    onChange={(e) => set(c.key, (col) => ({ ...col, role: e.target.value as Role, confirmed: true }))}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r} disabled={(r === "measure" && !isNumericType(c)) || (r === "time" && c.type !== "date")}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="col-span-2 text-xs text-ink-soft">
                  Meaning
                  <select
                    className="input mt-0.5 py-1.5"
                    value={c.semantic}
                    disabled={c.excluded}
                    onChange={(e) => set(c.key, (col) => ({ ...col, semantic: e.target.value as Semantic, confirmed: true }))}
                  >
                    {SEMANTICS.map((s) => (
                      <option key={s} value={s}>
                        {SEMANTIC_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </label>
                {c.type === "date" && (
                  <label className="col-span-2 text-xs text-ink-soft">
                    Date format
                    <select
                      className="input mt-0.5 py-1.5"
                      value={c.dateOrder ?? "dmy"}
                      onChange={(e) => set(c.key, (col) => ({ ...col, dateOrder: e.target.value as "dmy" | "mdy", confirmed: true }))}
                    >
                      <option value="dmy">Day / Month / Year (31-03-2026)</option>
                      <option value="mdy">Month / Day / Year (03-31-2026)</option>
                    </select>
                  </label>
                )}
                {!c.excluded && !c.confirmed && (
                  <button
                    className="btn-secondary col-span-2 py-1.5 text-xs"
                    onClick={() => set(c.key, (col) => ({ ...col, confirmed: true, ambiguity: col.ambiguity ? { ...col.ambiguity, resolved: true } : undefined }))}
                  >
                    <Check className="h-3.5 w-3.5" /> Looks right
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {dupName && <Alert kind="warn">Two columns are both named “{dupName}”. Give them different names.</Alert>}

      <div className="no-print fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 backdrop-blur lg:left-[15.5rem]">
        <div className="mx-auto flex max-w-[92rem] flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6 lg:px-8">
          <p className="text-sm text-ink-soft">{changed ? "You changed some columns — KPIs and charts will be rebuilt." : "Confirming keeps the current dashboard."}</p>
          <div className="flex gap-2">
            {changed && (
              <button className="btn-secondary" onClick={() => setSchema(record.schema)}>
                <Undo2 className="h-4 w-4" /> Undo
              </button>
            )}
            <button className="btn-primary" disabled={saving || Boolean(dupName)} onClick={save}>
              <Check className="h-4 w-4" /> {saving ? "Saving…" : "Confirm and open dashboard"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
