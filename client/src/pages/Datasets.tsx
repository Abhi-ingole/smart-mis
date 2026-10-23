import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Database, Eye, GitMerge, Pencil, Search, Trash2, Upload } from "lucide-react";
import { useDatasets } from "../state/datasets";
import { getDataset, saveDataset } from "../storage/db";
import { planJoin, type JoinPlan } from "../engine/merge";
import { analyzeSheet } from "../engine/pipeline";
import type { DatasetMeta, DatasetRecord } from "../engine/types";
import { cellText } from "../engine/values";
import { Alert, EmptyState, Field, Fingerprint, Modal, PageHeader, QualityRing, useToast } from "../components/ui";

const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default function DatasetsPage() {
  const { datasets, remove, rename, refresh } = useDatasets();
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState<DatasetRecord | null>(null);
  const [toDelete, setToDelete] = useState<DatasetMeta | null>(null);
  const [merging, setMerging] = useState(false);
  const toast = useToast();
  const shown = useMemo(() => (datasets ?? []).filter((d) => `${d.name} ${d.fileName} ${d.sheetName}`.toLowerCase().includes(q.toLowerCase())), [datasets, q]);

  if (datasets && datasets.length === 0)
    return (
      <EmptyState
        icon={<Database className="h-5 w-5" />}
        title="Your dataset library is empty"
        action={
          <Link to="/upload" className="btn-primary">
            <Upload className="h-4 w-4" /> Upload data
          </Link>
        }
      >
        Each uploaded sheet appears here while this tab is open. Nothing is saved.
      </EmptyState>
    );

  return (
    <div className="space-y-5">
      <PageHeader
        title="My datasets"
        description="Open in this tab only — nothing is saved, and these are cleared when you close or reload the page. Original uploads are kept unchanged; cleaning and column edits are stored as separate steps."
        actions={
          <>
            <button className="btn-secondary" disabled={(datasets?.length ?? 0) < 2} onClick={() => setMerging(true)}>
              <GitMerge className="h-4 w-4" /> Combine datasets
            </button>
            <Link to="/upload" className="btn-primary">
              <Upload className="h-4 w-4" /> Upload
            </Link>
          </>
        }
      />
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-faint" />
        <input className="input pl-9" placeholder="Search datasets" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search datasets" />
      </div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Dataset</th>
              <th>Rows</th>
              <th>Columns</th>
              <th>Quality</th>
              <th>Source</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((d) => (
              <tr key={d.id}>
                <td className="min-w-[14rem]">
                  <Link to={`/dashboard/${d.id}`} className="font-medium hover:text-accent">
                    {d.name}
                  </Link>
                  <p className="text-xs text-ink-faint">{d.domain.domain === "generic" ? "General data" : d.domain.label}</p>
                  <Fingerprint types={d.schema.filter((c) => !c.excluded).map((c) => c.type)} className="mt-1.5 max-w-[14rem]" />
                </td>
                <td>{d.rowCount.toLocaleString("en-IN")}</td>
                <td>{d.colCount}</td>
                <td>
                  <QualityRing score={d.qualityScore} size={32} />
                </td>
                <td className="text-xs text-ink-soft">
                  {d.fileName}
                  {d.kind !== "csv" && d.sheetName ? ` · ${d.sheetName}` : ""}
                  <br />
                  {fmtSize(d.sizeBytes)} · local
                </td>
                <td className="whitespace-nowrap text-xs text-ink-soft">{new Date(d.updatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
                <td className="whitespace-nowrap text-right">
                  <button className="rounded p-1.5 text-ink-faint hover:bg-sunken hover:text-ink" aria-label={`Preview ${d.name}`} onClick={async () => setPreview(await getDataset(d.id))}>
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    className="rounded p-1.5 text-ink-faint hover:bg-sunken hover:text-ink"
                    aria-label={`Rename ${d.name}`}
                    onClick={async () => {
                      const n = window.prompt("Dataset name", d.name);
                      if (n && n.trim()) await rename(d.id, n);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button className="rounded p-1.5 text-ink-faint hover:bg-bad-soft hover:text-bad" aria-label={`Delete ${d.name}`} onClick={() => setToDelete(d)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-ink-soft">
                  No datasets match “{q}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={Boolean(preview)} title={preview ? `Preview — ${preview.name}` : "Preview"} onClose={() => setPreview(null)} wide>
        {preview && (
          <div className="overflow-auto rounded-lg border border-line" style={{ maxHeight: "60vh" }}>
            <table className="table">
              <thead>
                <tr>
                  {preview.headers.map((h) => (
                    <th key={h} className="whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j} className="max-w-[14rem] truncate">
                        {cellText(c) ?? <span className="text-ink-faint">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {preview && <p className="mt-2 text-xs text-ink-faint">First {Math.min(50, preview.rows.length)} of {preview.rows.length.toLocaleString("en-IN")} original rows (before any cleaning).</p>}
      </Modal>

      <Modal
        open={Boolean(toDelete)}
        title="Delete dataset?"
        onClose={() => setToDelete(null)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setToDelete(null)}>
              Cancel
            </button>
            <button
              className="btn-danger"
              onClick={async () => {
                const d = toDelete!;
                setToDelete(null);
                await remove(d.id);
                toast("success", `Deleted “${d.name}” from this browser.`);
              }}
            >
              Delete
            </button>
          </>
        }
      >
        <p>
          “{toDelete?.name}” and its dashboard will be removed from this browser. Your original file on your computer isn't affected.
        </p>
      </Modal>

      {merging && datasets && <MergeDialog datasets={datasets} onClose={() => setMerging(false)} onCreated={async () => (setMerging(false), await refresh(), toast("success", "Combined dataset created."))} />}
    </div>
  );
}

function MergeDialog({ datasets, onClose, onCreated }: { datasets: DatasetMeta[]; onClose: () => void; onCreated: () => void }) {
  const [leftId, setLeftId] = useState(datasets[0].id);
  const [rightId, setRightId] = useState(datasets[1].id);
  const [plan, setPlan] = useState<JoinPlan>({ leftKey: "", rightKey: "", type: "left" });
  const [preview, setPreview] = useState<ReturnType<typeof planJoin> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = datasets.find((d) => d.id === leftId)!;
  const right = datasets.find((d) => d.id === rightId)!;

  const check = async () => {
    setError(null);
    setBusy(true);
    try {
      const [l, r] = await Promise.all([getDataset(leftId), getDataset(rightId)]);
      if (!l || !r) throw new Error("Dataset not found.");
      setPreview(planJoin(l, r, plan));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const name = `${left.name} + ${right.name}`;
      const rec = analyzeSheet({ name, headers: preview.headers, rows: preview.rows, warnings: preview.warnings }, { fileName: `${name}.merged`, kind: "csv", sizeBytes: 0 });
      await saveDataset({ ...rec, name, kind: "merged", sheetName: `${plan.type} join on ${left.schema.find((c) => c.key === plan.leftKey)?.name}` });
      onCreated();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      wide
      title="Combine two datasets"
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-secondary" disabled={!plan.leftKey || !plan.rightKey || leftId === rightId || busy} onClick={check}>
            Check match
          </button>
          <button className="btn-primary" disabled={!preview || busy || preview.resultRows === 0 || preview.resultRows > 300000} onClick={create}>
            Create combined dataset
          </button>
        </>
      }
    >
      <p className="mb-4 text-ink-soft">Matching column names don't guarantee the data belongs together. Choose the columns that identify the same thing in both datasets, then check the match before combining. The originals stay unchanged.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Main dataset" htmlFor="ml">
          <select id="ml" className="input" value={leftId} onChange={(e) => (setLeftId(e.target.value), setPlan({ ...plan, leftKey: "" }), setPreview(null))}>
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Dataset to add" htmlFor="mr">
          <select id="mr" className="input" value={rightId} onChange={(e) => (setRightId(e.target.value), setPlan({ ...plan, rightKey: "" }), setPreview(null))}>
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Key column in ${left.name}`} htmlFor="mlk">
          <select id="mlk" className="input" value={plan.leftKey} onChange={(e) => (setPlan({ ...plan, leftKey: e.target.value }), setPreview(null))}>
            <option value="">Choose…</option>
            {left.schema.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Matching column in ${right.name}`} htmlFor="mrk">
          <select id="mrk" className="input" value={plan.rightKey} onChange={(e) => (setPlan({ ...plan, rightKey: e.target.value }), setPreview(null))}>
            <option value="">Choose…</option>
            {right.schema.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Keep" htmlFor="mt">
          <select id="mt" className="input" value={plan.type} onChange={(e) => (setPlan({ ...plan, type: e.target.value as JoinPlan["type"] }), setPreview(null))}>
            <option value="left">All rows of the main dataset (left join)</option>
            <option value="inner">Only rows that match (inner join)</option>
          </select>
        </Field>
      </div>
      {leftId === rightId && <p className="mt-3 text-sm text-warn">Choose two different datasets.</p>}
      {error && (
        <div className="mt-3">
          <Alert kind="error">{error}</Alert>
        </div>
      )}
      {preview && (
        <div className="mt-5 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Match rate" value={`${preview.matchRate.toFixed(1)}%`} />
            <Stat label="Matched rows" value={`${preview.matchedLeftRows.toLocaleString("en-IN")} of ${preview.leftRows.toLocaleString("en-IN")}`} />
            <Stat label="Result rows" value={preview.resultRows.toLocaleString("en-IN")} />
          </div>
          {preview.warnings.map((w) => (
            <Alert key={w} kind="warn">
              {w}
            </Alert>
          ))}
          <div className="overflow-auto rounded-lg border border-line" style={{ maxHeight: 220 }}>
            <table className="table">
              <thead>
                <tr>
                  {preview.headers.map((h) => (
                    <th key={h} className="whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j} className="max-w-[10rem] truncate">
                        {cellText(c) ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-sunken p-3">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
