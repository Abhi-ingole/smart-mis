import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const ALERT = {
  info: { cls: "border-mail/25 bg-mail-soft text-ink", Icon: Info, icon: "text-mail" },
  warn: { cls: "border-warn/30 bg-warn-soft text-ink", Icon: AlertTriangle, icon: "text-warn" },
  error: { cls: "border-down/30 bg-bad-soft text-ink", Icon: XCircle, icon: "text-down" },
  success: { cls: "border-up/30 bg-wa-soft text-ink", Icon: CheckCircle2, icon: "text-up" },
};

export function Alert({ kind = "info", children, onClose, action }: { kind?: keyof typeof ALERT; children: ReactNode; onClose?: () => void; action?: ReactNode }) {
  const a = ALERT[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`flex items-start gap-3 rounded-md border px-3.5 py-3 text-sm ${a.cls}`}>
      <a.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${a.icon}`} aria-hidden />
      <div className="flex-1">{children}</div>
      {action}
      {onClose && (
        <button className="text-ink-faint hover:text-ink" onClick={onClose} aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-ink-soft" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-ink" aria-hidden />
      {label}
    </div>
  );
}

export function Modal({ open, title, children, onClose, footer }: { open: boolean; title: string; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-line bg-panel p-0 text-ink shadow-xl backdrop:bg-ink/40">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <button onClick={onClose} className="text-ink-faint hover:text-ink" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="px-5 py-4 text-sm">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
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
      {error ? <p className="mt-1 text-xs text-down">{error}</p> : hint ? <p className="mt-1 text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

export function ChannelTag({ channel }: { channel: "wa" | "mail" }) {
  return channel === "wa" ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-wa">
      <span className="h-2 w-2 rounded-full bg-wa" aria-hidden />
      WhatsApp
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-mail">
      <span className="h-2 w-2 rounded-sm bg-mail" aria-hidden />
      Email
    </span>
  );
}
