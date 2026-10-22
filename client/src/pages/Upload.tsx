import { useRef, useState, type DragEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, FileSpreadsheet, FolderOpen, Lock, Trash2, UploadCloud } from "lucide-react";
import { LIMITS, SUPPORTED_EXTS } from "../engine/parse";
import { collect, itemsFromDrop, itemsFromInput, type Collected } from "../state/collect";
import { inspectFile, type SheetInfo } from "../state/upload";
import { useAnalyzer, type AnalyzerResult } from "../state/useAnalyzer";
import { AnalysisProgress } from "../components/AnalysisProgress";
import { Alert, Fingerprint, PageHeader } from "../components/ui";

interface Pending {
  file: File;
  status: "inspecting" | "ready" | "error";
  error?: string;
  sheets: SheetInfo[];
  selected: string[];
}

const ACCEPT = ".xlsx,.xls,.xlsm,.csv,.tsv,.txt,.json,.pdf,.zip";
// Non-standard attributes that make a file input pick a whole folder.
const FOLDER_ATTRS = { webkitdirectory: "", directory: "" } as Record<string, string>;
const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default function UploadPage() {
  const [pending, setPending] = useState<Pending[]>([]);
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState<AnalyzerResult | null>(null);
  const [skipped, setSkipped] = useState<Collected["skipped"]>([]);
  const [collecting, setCollecting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const { run, busy, progress, label } = useAnalyzer();
  const navigate = useNavigate();

  const addFiles = async (list: FileList | File[]) => {
    setResult(null);
    const files = [...list];
    const fresh: Pending[] = files.map((file) => {
      const ext = (file.name.split(".").pop() ?? "").toLowerCase();
      if (!SUPPORTED_EXTS.includes(ext)) return { file, status: "error", error: "Not a supported file type. Use Excel, CSV, JSON, PDF, or a ZIP/folder of them.", sheets: [], selected: [] };
      if (file.size > LIMITS.maxFileBytes) return { file, status: "error", error: `Too large (${fmtSize(file.size)}). The in-browser limit is ${LIMITS.maxFileBytes / 1048576} MB.`, sheets: [], selected: [] };
      if (file.size === 0) return { file, status: "error", error: "The file is empty.", sheets: [], selected: [] };
      return { file, status: "inspecting", sheets: [], selected: [] };
    });
    setPending((p) => [...p, ...fresh]);
    for (const item of fresh.filter((f) => f.status === "inspecting")) {
      try {
        const sheets = await inspectFile(item.file);
        const withData = sheets.filter((s) => s.rows > 0).map((s) => s.name);
        setPending((p) => p.map((x) => (x.file === item.file ? { ...x, status: withData.length ? "ready" : "error", error: withData.length ? undefined : "No sheet in this file has data rows.", sheets, selected: withData } : x)));
      } catch (e) {
        setPending((p) => p.map((x) => (x.file === item.file ? { ...x, status: "error", error: (e as Error).message } : x)));
      }
    }
  };

  /** Unpacks folders and ZIPs, then inspects every readable file. */
  const addItems = async (items: Promise<Parameters<typeof collect>[0]> | Parameters<typeof collect>[0]) => {
    setCollecting(true);
    try {
      const c = await collect(await items);
      setSkipped(c.skipped);
      if (c.files.length) await addFiles(c.files);
      else if (!c.skipped.length) setSkipped([{ reason: "Nothing readable was found", names: [] }]);
    } finally {
      setCollecting(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    // Read the dropped entries now — the browser clears them once this handler returns.
    if (e.dataTransfer.items.length || e.dataTransfer.files.length) void addItems(itemsFromDrop(e.dataTransfer));
  };

  const ready = pending.filter((p) => p.status === "ready" && p.selected.length);
  const inspecting = collecting || pending.some((p) => p.status === "inspecting");

  const start = async () => {
    const r = await run(ready.map((p) => ({ file: p.file, sheets: p.selected })));
    setPending([]);
    setSkipped([]);
    setResult(r);
    if (r.datasets.length === 1 && !r.problems.length) navigate(`/dashboard/${r.datasets[0].id}`);
  };

  if (busy) return <AnalysisProgress progress={progress} fileLabel={label} />;

  return (
    <div className="space-y-6">
      <PageHeader title="Upload data" description="Excel, CSV, JSON or PDF tables — or drop a whole folder or ZIP and every readable file inside is scanned. For workbooks with more than one sheet, choose the sheets to analyse." />

      {result && (
        <div className="space-y-3">
          {result.datasets.length > 0 && (
            <div className="card p-5">
              <p className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-5 w-5 text-good" /> {result.datasets.length} dataset{result.datasets.length > 1 ? "s" : ""} ready
              </p>
              <ul className="mt-3 divide-y divide-line">
                {result.datasets.map((d) => {
                  const questions = d.schema.filter((c) => c.ambiguity && !c.ambiguity.resolved).length;
                  return (
                    <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{d.name}</p>
                        <p className="text-xs text-ink-soft">
                          {d.rowCount.toLocaleString("en-IN")} rows · {d.colCount} columns · {d.domain.domain === "generic" ? "general data" : d.domain.label}
                          {questions > 0 && <span className="text-warn"> · {questions} column{questions > 1 ? "s" : ""} need your confirmation</span>}
                        </p>
                        <Fingerprint types={d.schema.map((c) => c.type)} className="mt-2 max-w-xs" />
                      </div>
                      <div className="flex gap-2">
                        {questions > 0 && (
                          <Link className="btn-secondary" to={`/quality/${d.id}?tab=mapping`}>
                            Confirm columns
                          </Link>
                        )}
                        <Link className="btn-primary" to={`/dashboard/${d.id}`}>
                          Open dashboard
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {result.problems.map((p, i) => (
            <Alert key={i} kind="error">
              <strong className="font-medium">{p.file}:</strong> {p.message}
            </Alert>
          ))}
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={`card flex flex-col items-center border-2 border-dashed px-6 py-14 text-center transition-colors ${drag ? "border-accent bg-accent-soft" : "border-line-strong"}`}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <UploadCloud className="h-7 w-7" />
        </div>
        <p className="mt-4 text-lg font-semibold">Drag and drop files, folders or ZIPs here</p>
        <p className="mt-1 text-sm text-ink-soft">or</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button className="btn-primary" onClick={() => inputRef.current?.click()}>
            Choose files
          </button>
          <button className="btn-secondary" onClick={() => folderRef.current?.click()}>
            <FolderOpen className="h-4 w-4" /> Choose a folder
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          aria-label="Choose files"
          onChange={(e) => {
            if (e.target.files?.length) void addItems(itemsFromInput(e.target.files));
            e.target.value = "";
          }}
        />
        <input
          ref={folderRef}
          type="file"
          multiple
          {...FOLDER_ATTRS}
          className="sr-only"
          aria-label="Choose a folder"
          onChange={(e) => {
            if (e.target.files?.length) void addItems(itemsFromInput(e.target.files));
            e.target.value = "";
          }}
        />
        {collecting && <p className="mt-4 text-sm text-accent">Scanning folders and ZIP files…</p>}
        <p className="mt-5 text-xs text-ink-faint">
          .xlsx · .xls · .csv · .json · .pdf · .zip · folders — up to {LIMITS.maxFileBytes / 1048576} MB and {LIMITS.maxRows.toLocaleString("en-IN")} rows per sheet
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-faint">
          <Lock className="h-3.5 w-3.5" /> Files are read in your browser and never uploaded to a server.
        </p>
      </div>

      {skipped.length > 0 && (
        <Alert kind="info">
          <span className="block font-medium">Some files were left out:</span>
          {skipped.map((s) => (
            <span key={s.reason} className="mt-1 block text-sm">
              {s.reason}
              {s.names.length > 0 && ` (${s.names.length}): ${s.names.slice(0, 4).join(", ")}${s.names.length > 4 ? ` and ${s.names.length - 4} more` : ""}`}
            </span>
          ))}
        </Alert>
      )}

      {pending.length > 0 && (
        <div className="card divide-y divide-line">
          {pending.map((p, idx) => (
            <div key={idx} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <FileSpreadsheet className={`mt-0.5 h-5 w-5 shrink-0 ${p.status === "error" ? "text-bad" : "text-accent"}`} />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.file.name}</p>
                    <p className="text-xs text-ink-soft">
                      {fmtSize(p.file.size)}
                      {p.status === "inspecting" && " · reading sheets…"}
                      {p.status === "ready" && ` · ${p.sheets.length} sheet${p.sheets.length > 1 ? "s" : ""}`}
                    </p>
                    {p.status === "error" && <p className="mt-1 text-sm text-bad">{p.error}</p>}
                  </div>
                </div>
                <button className="rounded p-1 text-ink-faint hover:bg-bad-soft hover:text-bad" aria-label={`Remove ${p.file.name}`} onClick={() => setPending((x) => x.filter((_, i) => i !== idx))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {p.status === "ready" && (
                <fieldset className="mt-3 ml-8">
                  <legend className="sr-only">Sheets to analyse in {p.file.name}</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {p.sheets.map((s) => (
                      <label key={s.name} className={`flex items-start gap-2 rounded-lg border p-2.5 text-sm ${s.rows ? "border-line" : "border-dashed border-line text-ink-faint"}`}>
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          disabled={!s.rows}
                          checked={p.selected.includes(s.name)}
                          onChange={(e) =>
                            setPending((x) => x.map((q, i) => (i === idx ? { ...q, selected: e.target.checked ? [...q.selected, s.name] : q.selected.filter((n) => n !== s.name) } : q)))
                          }
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{s.name}</span>
                          <span className="text-xs text-ink-soft">{s.rows ? `${s.rows.toLocaleString("en-IN")} rows · ${s.cols} columns` : "Empty — nothing to analyse"}</span>
                          {s.warnings.slice(0, 2).map((w) => (
                            <span key={w} className="mt-0.5 block text-xs text-warn">
                              {w}
                            </span>
                          ))}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-sunken p-4">
            <p className="text-sm text-ink-soft">
              {ready.reduce((a, p) => a + p.selected.length, 0)} sheet(s) selected — each becomes its own dataset and dashboard.
            </p>
            <button className="btn-primary" disabled={!ready.length || inspecting} onClick={start}>
              Analyse and build dashboards
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
