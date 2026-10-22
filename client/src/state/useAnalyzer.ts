import { useCallback, useState } from "react";
import type { AnalysisProgress, DatasetRecord } from "../engine/types";
import { analyzeFile } from "./upload";
import { useDatasets } from "./datasets";

export interface Job {
  file: File;
  sheets: string[];
}

export interface AnalyzerResult {
  datasets: DatasetRecord[];
  problems: { file: string; message: string }[];
}

/** Runs analysis for several files one after another and saves the results locally. */
export function useAnalyzer() {
  const { add } = useDatasets();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [label, setLabel] = useState<string>("");

  const run = useCallback(
    async (jobs: Job[]): Promise<AnalyzerResult> => {
      setBusy(true);
      const datasets: DatasetRecord[] = [];
      const problems: AnalyzerResult["problems"] = [];
      try {
        for (const [i, job] of jobs.entries()) {
          setLabel(`${job.file.name}${jobs.length > 1 ? ` (${i + 1} of ${jobs.length})` : ""}`);
          setProgress(null);
          try {
            const r = await analyzeFile(job.file, job.sheets, (p, sheet) => {
              setProgress(p);
              if (sheet && job.sheets.length > 1) setLabel(`${job.file.name} — ${sheet}`);
            });
            datasets.push(...r.datasets);
            r.skipped.forEach((s) => problems.push({ file: `${job.file.name} — ${s.sheet}`, message: s.reason }));
          } catch (e) {
            problems.push({ file: job.file.name, message: (e as Error).message });
          }
        }
        if (datasets.length) await add(datasets);
      } catch (e) {
        problems.push({ file: "Saving", message: `Couldn't save to this browser's storage: ${(e as Error).message}` });
      } finally {
        setBusy(false);
      }
      return { datasets, problems };
    },
    [add],
  );

  return { run, busy, progress, label };
}

export const DEMO_FILES = [
  { file: "sales-orders.xlsx", title: "Sales orders", sheets: ["Orders"], blurb: "640 orders across regions, products and payment modes (Excel)." },
  { file: "hr-employees.xlsx", title: "HR employees", sheets: ["Employees"], blurb: "230 employees with departments, salaries and status (Excel)." },
  { file: "company-financials.xlsx", title: "Company financials", sheets: ["P&L Summary"], blurb: "Revenue, EBITDA, EBIT and PAT by financial year (Excel)." },
  { file: "student-marks.csv", title: "Student marks", sheets: [] as string[], blurb: "60 students × 5 subjects with results (CSV)." },
  { file: "messy-expenses.csv", title: "Messy expense register", sheets: [] as string[], blurb: "Missing values, duplicates and bad dates — try Data Quality (CSV)." },
  { file: "custom-measurements.csv", title: "Unknown custom data", sheets: [] as string[], blurb: "Columns with no business meaning — generic analysis (CSV)." },
];

export async function demoJob(name: string): Promise<Job> {
  const d = DEMO_FILES.find((x) => x.file === name)!;
  const res = await fetch(`${import.meta.env.BASE_URL}samples/${d.file}`);
  if (!res.ok) throw new Error(`Couldn't load the demo file (${res.status}).`);
  const blob = await res.blob();
  const file = new File([blob], d.file, { type: blob.type, lastModified: 1 });
  return { file, sheets: d.sheets.length ? d.sheets : [d.file.replace(/\.[^.]+$/, "")] };
}
