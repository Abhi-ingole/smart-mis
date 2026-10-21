import { Check, Loader2 } from "lucide-react";
import { STAGES } from "../engine/pipeline";
import type { AnalysisProgress as P } from "../engine/types";

/** Real progress: each stage is ticked only when the worker reports it finished. */
export function AnalysisProgress({ progress, fileLabel }: { progress: P | null; fileLabel?: string }) {
  const current = progress ? (progress.stage === "done" ? STAGES.length : STAGES.findIndex((s) => s.stage === progress.stage)) : 0;
  return (
    <div className="card p-6" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">Analysing your data</h2>
        {fileLabel && <p className="truncate text-sm text-ink-soft">{fileLabel}</p>}
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${Math.round((current / STAGES.length) * 100)}%` }} />
      </div>
      <ol className="mt-5 grid gap-2 sm:grid-cols-2">
        {STAGES.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s.stage} className={`flex items-center gap-2.5 text-sm ${done ? "text-ink" : active ? "font-medium text-accent" : "text-ink-faint"}`}>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${done ? "border-good bg-good text-white" : active ? "border-accent" : "border-line"}`}>
                {done ? <Check className="h-3 w-3" /> : active ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              </span>
              {s.label}
              {active && progress?.detail && <span className="truncate text-xs font-normal text-ink-faint">· {progress.detail}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
