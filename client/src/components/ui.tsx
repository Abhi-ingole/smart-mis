import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import type { ColType } from "../engine/types";

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-sm text-ink-soft">{eyebrow}</div>}
        <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <div className="mt-1 max-w-3xl text-sm text-ink-soft">{description}</div>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const ALERT = {
  info: { cls: "border-accent/20 bg-accent-soft", Icon: Info, icon: "text-accent" },
  warn: { cls: "border-warn/25 bg-warn-soft", Icon: AlertTriangle, icon: "text-warn" },
  error: { cls: "border-bad/25 bg-bad-soft", Icon: XCircle, icon: "text-bad" },
  success: { cls: "border-good/25 bg-good-soft", Icon: CheckCircle2, icon: "text-good" },
};

export function Alert({ kind = "info", children, onClose, action }: { kind?: keyof typeof ALERT; children: ReactNode; onClose?: () => void; action?: ReactNode }) {
  const a = ALERT[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`flex items-start gap-3 rounded-lg border px-3.5 py-3 text-sm text-ink ${a.cls}`}>
      <a.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${a.icon}`} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
      {onClose && (
        <button className="text-ink-faint hover:text-ink" onClick={onClose} aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function Modal({ open, title, children, onClose, footer, wide }: { open: boolean; title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={`m-auto max-h-[88vh] ${wide ? "w-[min(56rem,calc(100vw-2rem))]" : "w-[min(32rem,calc(100vw-2rem))]"} overflow-hidden rounded-xl border border-line bg-surface p-0 text-ink backdrop:bg-ink/40`}
      style={{ boxShadow: "var(--shadow-pop)" }}
    >
      {open && (
        <div className="flex max-h-[88vh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-base font-semibold">{title}</h2>
            <button onClick={onClose} className="rounded p-1 text-ink-faint hover:bg-sunken hover:text-ink" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4 text-sm">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line bg-sunken px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-bad">{error}</p> : hint ? <p className="mt-1 text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">{icon}</div>}
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <div className="mt-1 max-w-md text-sm text-ink-soft">{children}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function SkeletonDashboard() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-8 w-72" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card space-y-3 p-4">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-7 w-32" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="card p-4">
            <div className="skeleton h-4 w-40" />
            <div className="skeleton mt-4 h-56 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export const TYPE_LABEL: Record<ColType, string> = {
  number: "Number",
  currency: "Money",
  percentage: "Percent",
  date: "Date",
  category: "Category",
  boolean: "Yes / No",
  text: "Text",
  identifier: "ID",
};

export const TYPE_COLOR: Record<ColType, string> = {
  number: "var(--color-t-number)",
  currency: "var(--color-t-currency)",
  percentage: "var(--color-t-percentage)",
  date: "var(--color-t-date)",
  category: "var(--color-t-category)",
  boolean: "var(--color-t-boolean)",
  text: "var(--color-t-text)",
  identifier: "var(--color-t-identifier)",
};

export function TypeBadge({ type }: { type: ColType }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-white px-1.5 py-0.5 text-xs text-ink-soft">
      <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLOR[type] }} aria-hidden />
      {TYPE_LABEL[type]}
    </span>
  );
}

/** The dataset's "type fingerprint": one segment per column, coloured by type. */
export function Fingerprint({ types, className = "" }: { types: ColType[]; className?: string }) {
  const counts = types.reduce<Record<string, number>>((a, t) => ((a[t] = (a[t] ?? 0) + 1), a), {});
  const summary = Object.entries(counts)
    .map(([t, n]) => `${n} ${TYPE_LABEL[t as ColType].toLowerCase()}`)
    .join(", ");
  return (
    <div className={`flex h-1.5 w-full gap-px overflow-hidden rounded-full ${className}`} role="img" aria-label={`Columns: ${summary}`} title={summary}>
      {types.map((t, i) => (
        <span key={i} className="h-full flex-1" style={{ background: TYPE_COLOR[t] }} />
      ))}
    </div>
  );
}

export function QualityRing({ score, size = 44 }: { score: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const color = score >= 85 ? "var(--color-good)" : score >= 65 ? "var(--color-warn)" : "var(--color-bad)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Data quality ${score} out of 100`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth="5" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5" strokeDasharray={`${(score / 100) * c} ${c}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.3} fontWeight="600" fill="var(--color-ink)">
        {score}
      </text>
    </svg>
  );
}

// ── Toasts ──────────────────────────────────────────────────
type Toast = { id: number; kind: "success" | "error" | "info"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="no-print fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="animate-rise">
            <Alert kind={t.kind === "info" ? "info" : t.kind} onClose={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              {t.text}
            </Alert>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${value === t.id ? "border-accent font-medium text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Pill toggle for switching between views of the same data. */
export function Segmented<T extends string>({ value, onChange, options, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[]; size?: "sm" | "md" }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-sunken p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`rounded-[5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs"} ${value === o.value ? "bg-side text-white shadow-sm" : "text-ink-soft hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
