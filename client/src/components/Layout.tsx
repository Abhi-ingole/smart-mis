import { useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { BarChart3, Database, FileText, Gauge, Home, Lightbulb, Lock, Menu, Settings, ShieldCheck, Upload, X } from "lucide-react";
import { useDatasets } from "../state/datasets";

export function Layout({ children }: { children: ReactNode }) {
  const { activeId, datasets } = useDatasets();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const active = datasets?.find((d) => d.id === activeId);
  const scoped = (base: string) => (activeId ? `${base}/${activeId}` : base);

  const NAV = [
    { to: "/", label: "Overview", Icon: Home, end: true },
    { to: "/upload", label: "Upload Data", Icon: Upload },
    { to: "/datasets", label: "My Datasets", Icon: Database },
    { to: scoped("/dashboard"), match: "/dashboard", label: "Auto Dashboards", Icon: BarChart3 },
    { to: scoped("/report"), match: "/report", label: "Report Builder", Icon: FileText },
    { to: scoped("/insights"), match: "/insights", label: "AI Insights", Icon: Lightbulb },
    { to: scoped("/quality"), match: "/quality", label: "Data Quality", Icon: ShieldCheck },
    { to: "/settings", label: "Settings", Icon: Settings },
  ];

  const nav = (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {NAV.map(({ to, label, Icon, end, match }) => {
        const isActive = match ? loc.pathname.startsWith(match) : end ? loc.pathname === to : loc.pathname.startsWith(to);
        return (
          <NavLink
            key={label}
            to={to}
            end={end}
            onClick={() => setOpen(false)}
            aria-current={isActive ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${isActive ? "bg-accent-soft font-medium text-accent" : "text-ink-soft hover:bg-sunken hover:text-ink"}`}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </NavLink>
        );
      })}
    </nav>
  );

  const brand = (
    <NavLink to="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
        <Gauge className="h-4.5 w-4.5" aria-hidden />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-ink">Smart MIS</span>
        <span className="block text-xs text-ink-faint">Spreadsheet intelligence</span>
      </span>
    </NavLink>
  );

  const footer = (
    <div className="space-y-3">
      {active && (
        <div className="rounded-lg border border-line bg-sunken p-3">
          <p className="text-xs text-ink-faint">Working on</p>
          <p className="truncate text-sm font-medium" title={active.name}>
            {active.name}
          </p>
          <p className="text-xs text-ink-soft">
            {active.rowCount.toLocaleString("en-IN")} rows · {active.colCount} columns
          </p>
        </div>
      )}
      <p className="flex items-start gap-2 text-xs text-ink-faint">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Local-only: your files are processed and stored in this browser.
      </p>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="no-print sticky top-0 hidden h-screen flex-col justify-between border-r border-line bg-surface p-4 lg:flex">
        <div className="space-y-7">
          {brand}
          {nav}
        </div>
        {footer}
      </aside>

      <header className="no-print sticky top-0 z-20 flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
        {brand}
        <button className="rounded-lg p-1.5 text-ink hover:bg-sunken" onClick={() => setOpen(!open)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>
      {open && (
        <div className="no-print fixed inset-x-0 top-[57px] z-20 space-y-5 border-b border-line bg-surface p-4 shadow-lg lg:hidden">
          {nav}
          {footer}
        </div>
      )}

      <main className="mx-auto w-full min-w-0 max-w-[90rem] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
