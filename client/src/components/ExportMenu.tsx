import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileDown, FileSpreadsheet, Presentation, Sheet } from "lucide-react";

export type ExportKind = "pdf" | "xlsx" | "pptx" | "csv";

const ITEMS: { kind: ExportKind; label: string; hint: string; Icon: typeof Download }[] = [
  { kind: "pdf", label: "PDF report", hint: "KPIs, charts, insights and data quality", Icon: FileDown },
  { kind: "pptx", label: "PowerPoint", hint: "One slide per section, editable charts", Icon: Presentation },
  { kind: "xlsx", label: "Excel workbook", hint: "Summary sheets plus all rows", Icon: FileSpreadsheet },
  { kind: "csv", label: "CSV (rows)", hint: "The filtered rows only", Icon: Sheet },
];

/** One "Export" button with a short menu, instead of a row of format buttons. */
export function ExportMenu({ onExport, busy, primary = false }: { onExport: (k: ExportKind) => void; busy: ExportKind | null; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button className={primary ? "btn-primary" : "btn-secondary"} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} disabled={busy !== null}>
        <Download className="h-4 w-4" />
        {busy ? `Preparing ${ITEMS.find((i) => i.kind === busy)?.label}…` : "Export"}
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-72 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-[var(--shadow-pop)]">
          {ITEMS.map(({ kind, label, hint, Icon }) => (
            <button
              key={kind}
              role="menuitem"
              className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-sunken"
              onClick={() => {
                setOpen(false);
                onExport(kind);
              }}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-s1" />
              <span>
                <span className="block text-sm font-medium text-ink">{label}</span>
                <span className="block text-xs text-ink-faint">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
