import type { WorkerRequest, WorkerResponse } from "../engine/worker";
import type { AnalysisProgress, DatasetRecord } from "../engine/types";

export interface SheetInfo {
  name: string;
  rows: number;
  cols: number;
  warnings: string[];
}

// One long-lived worker: it caches the last parsed file, so "inspect sheets" then
// "analyse" doesn't parse the workbook twice. Requests run one at a time.
let worker: Worker | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getWorker() {
  worker ??= new Worker(new URL("../engine/worker.ts", import.meta.url), { type: "module" });
  return worker;
}

function run<T extends WorkerResponse>(req: WorkerRequest, onProgress?: (p: AnalysisProgress, sheet?: string) => void): Promise<T> {
  const job = queue.then(
    () =>
      new Promise<T>((resolve, reject) => {
        const w = getWorker();
        w.onmessage = (e: MessageEvent<WorkerResponse>) => {
          const m = e.data;
          if (m.type === "progress") {
            onProgress?.(m.progress, m.sheet);
            return;
          }
          if (m.type === "error") reject(new Error(m.message));
          else resolve(m as T);
        };
        w.onerror = (e) => {
          w.terminate();
          worker = null;
          reject(new Error(e.message || "The analysis stopped unexpectedly (the file may be too large for this browser)."));
        };
        w.postMessage(req);
      }),
  );
  queue = job.catch(() => undefined);
  return job;
}

export async function inspectFile(file: File): Promise<SheetInfo[]> {
  const r = await run<Extract<WorkerResponse, { type: "inspected" }>>({ type: "inspect", file });
  return r.sheets;
}

export async function analyzeFile(file: File, sheets: string[], onProgress: (p: AnalysisProgress, sheet?: string) => void): Promise<{ datasets: DatasetRecord[]; skipped: { sheet: string; reason: string }[] }> {
  const r = await run<Extract<WorkerResponse, { type: "done" }>>({ type: "analyze", file, sheets }, onProgress);
  return { datasets: r.datasets, skipped: r.skipped };
}
