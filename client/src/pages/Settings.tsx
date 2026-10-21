import { useEffect, useState } from "react";
import { HardDrive, Lock, Sparkles, Trash2 } from "lucide-react";
import { useDatasets } from "../state/datasets";
import { getSetting, setSetting, storageEstimate } from "../storage/db";
import { LIMITS } from "../engine/parse";
import { Modal, PageHeader, useToast } from "../components/ui";

const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;

export default function SettingsPage() {
  const { datasets, removeAll } = useDatasets();
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [ai, setAi] = useState<{ available: boolean; provider: string | null } | null>(null);
  const [consent, setConsent] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const toast = useToast();

  useEffect(() => {
    void storageEstimate().then(setUsage);
    fetch("/api/ai/status")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setAi)
      .catch(() => setAi({ available: false, provider: null }));
    getSetting("aiConsent", false).then(setConsent).catch(() => undefined);
  }, [datasets]);

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Settings" />

      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <HardDrive className="h-4 w-4 text-accent" /> Data storage
        </h2>
        <p className="mt-2 text-sm text-ink-soft">
          <strong className="font-medium text-ink">Local-only.</strong> Spreadsheets are parsed in this browser and saved in its IndexedDB storage. They are not uploaded or synced to any server, so they won't appear on other devices or browsers.
        </p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-lg bg-sunken p-3">
            <dt className="text-xs text-ink-soft">Datasets saved</dt>
            <dd className="text-lg font-semibold">{datasets?.length ?? "—"}</dd>
          </div>
          <div className="rounded-lg bg-sunken p-3">
            <dt className="text-xs text-ink-soft">Storage used</dt>
            <dd className="text-lg font-semibold">{usage ? mb(usage.usage) : "—"}</dd>
          </div>
          <div className="rounded-lg bg-sunken p-3">
            <dt className="text-xs text-ink-soft">Available to this site</dt>
            <dd className="text-lg font-semibold">{usage ? mb(usage.quota) : "—"}</dd>
          </div>
        </dl>
        <button className="btn-danger mt-4" disabled={!datasets?.length} onClick={() => setConfirm(true)}>
          <Trash2 className="h-4 w-4" /> Delete all local data
        </button>
      </section>

      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Sparkles className="h-4 w-4 text-accent" /> AI insights (optional)
        </h2>
        <p className="mt-2 text-sm text-ink-soft">
          {ai === null ? "Checking…" : ai.available ? `Enabled on this server (${ai.provider}). The API key stays on the server.` : "Not configured on this server. All analysis, charts and reports work without it."}
        </p>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={consent}
            disabled={!ai?.available}
            onChange={(e) => {
              setConsent(e.target.checked);
              void setSetting("aiConsent", e.target.checked);
            }}
          />
          <span>Allow sending computed summaries (never raw rows) to the AI provider when I ask for an AI narrative.</span>
        </label>
      </section>

      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Lock className="h-4 w-4 text-accent" /> Limits and privacy
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
          <li>Files up to {LIMITS.maxFileBytes / 1048576} MB, {LIMITS.maxRows.toLocaleString("en-IN")} rows and {LIMITS.maxCols} columns per sheet are analysed in the browser.</li>
          <li>Exports neutralise spreadsheet formulas (cells starting with =, +, - or @) so opening them is safe.</li>
          <li>The original upload is never modified; cleaning steps are stored separately and can be undone.</li>
          <li>Deleting data here removes it from this browser only. Your files on disk aren't touched.</li>
        </ul>
      </section>

      <Modal
        open={confirm}
        title="Delete all local data?"
        onClose={() => setConfirm(false)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button
              className="btn-danger"
              onClick={async () => {
                setConfirm(false);
                await removeAll();
                toast("success", "All datasets and settings were deleted from this browser.");
              }}
            >
              Delete everything
            </button>
          </>
        }
      >
        <p>All {datasets?.length ?? 0} datasets, dashboards and settings stored in this browser will be permanently removed.</p>
      </Modal>
    </div>
  );
}
