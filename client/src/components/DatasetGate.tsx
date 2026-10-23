import type { ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Database, Upload } from "lucide-react";
import { useDataset, useDatasets } from "../state/datasets";
import { Alert, EmptyState, Fingerprint, PageHeader, SkeletonDashboard } from "./ui";
import type { Analysis } from "../engine/pipeline";
import type { DatasetMeta, DatasetRecord } from "../engine/types";

export type Loaded = { record: DatasetRecord; analysis: Analysis; update: (patch: Partial<Omit<DatasetMeta, "id">>) => Promise<void> };

/**
 * Wraps dataset pages: resolves the dataset from the URL (or the active one),
 * and shows a picker / empty state / loading skeleton when needed.
 */
export function DatasetGate({ base, title, children }: { base: string; title: string; children: (d: Loaded) => ReactNode }) {
  const { id } = useParams();
  const { datasets, activeId } = useDatasets();
  const { record, analysis, state, error, update } = useDataset(id);

  if (!id) {
    if (datasets === null) return <SkeletonDashboard />;
    if (!datasets.length)
      return (
        <EmptyState
          icon={<Database className="h-5 w-5" />}
          title="No datasets yet"
          action={
            <>
              <Link to="/upload" className="btn-primary">
                <Upload className="h-4 w-4" /> Upload your data
              </Link>
              <Link to="/?demo=1" className="btn-secondary">
                Explore demo
              </Link>
            </>
          }
        >
          {title} appears here once you upload a file (Excel, CSV, JSON, PDF or a ZIP/folder). Nothing is shown until there is real data.
        </EmptyState>
      );
    if (activeId) return <Navigate to={`${base}/${activeId}`} replace />;
  }
  if (state === "loading") return <SkeletonDashboard />;
  if (state === "error") return <Alert kind="error">Couldn't open this dataset: {error}</Alert>;
  if (state === "missing" || !record || !analysis)
    return (
      <div className="space-y-4">
        <PageHeader title={title} />
        <Alert kind="warn">This dataset isn't open any more (data is cleared when the tab is closed or reloaded). Pick another one or upload the file again:</Alert>
        <DatasetPicker base={base} />
      </div>
    );
  return <>{children({ record, analysis, update })}</>;
}

export function DatasetPicker({ base }: { base: string }) {
  const { datasets } = useDatasets();
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {datasets?.map((d) => (
        <Link key={d.id} to={`${base}/${d.id}`} className="card block p-4 hover:border-accent/40">
          <p className="truncate font-medium">{d.name}</p>
          <p className="text-xs text-ink-soft">
            {d.rowCount.toLocaleString("en-IN")} rows · {d.colCount} columns
          </p>
          <Fingerprint types={d.schema.filter((c) => !c.excluded).map((c) => c.type)} className="mt-3" />
        </Link>
      ))}
    </div>
  );
}

/** Small dataset switcher for page headers. */
export function DatasetSwitcher({ base, currentId }: { base: string; currentId: string }) {
  const { datasets } = useDatasets();
  const navigate = useNavigate();
  if (!datasets || datasets.length < 2) return null;
  return (
    <label className="flex items-center gap-2 text-sm text-ink-soft">
      <span className="sr-only">Switch dataset</span>
      <select className="input w-auto max-w-[16rem] py-1.5" value={currentId} onChange={(e) => navigate(`${base}/${e.target.value}`)}>
        {datasets.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </label>
  );
}
