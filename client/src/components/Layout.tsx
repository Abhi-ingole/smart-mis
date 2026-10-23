import { useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { BarChart3, CalendarClock, Database, FileText, Home, Lightbulb, Lock, Menu, MessageSquareText, Settings, ShieldCheck, Upload, X } from "lucide-react";
import { useDatasets } from "../state/datasets";
import logoUrl from "../assets/ingoviq-logo-light.png";

interface Item {
  to: string;
  label: string;
  Icon: typeof Home;
  end?: boolean;
  match?: string;
}

export function Layout({ children }: { children: ReactNode }) {
  const { activeId, datasets } = useDatasets();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const active = datasets?.find((d) => d.id === activeId);
  const scoped = (base: string) => (activeId ? `${base}/${activeId}` : base);

  const GROUPS: { title?: string; items: Item[] }[] = [
    {
      items: [
        { to: "/", label: "Home", Icon: Home, end: true },
        { to: "/upload", label: "Upload data", Icon: Upload },
        { to: "/datasets", label: "Datasets", Icon: Database },
      ],
    },
    {
      title: "Analyse",
      items: [
        { to: scoped("/dashboard"), match: "/dashboard", label: "Dashboard", Icon: BarChart3 },
        { to: scoped("/ask"), match: "/ask", label: "Ask a question", Icon: MessageSquareText },
        { to: scoped("/insights"), match: "/insights", label: "Insights", Icon: Lightbulb },
        { to: scoped("/quality"), match: "/quality", label: "Data quality", Icon: ShieldCheck },
      ],
    },
    {
      title: "Share",
      items: [
        { to: scoped("/report"), match: "/report", label: "Reports & export", Icon: FileText },
        { to: scoped("/schedule"), match: "/schedule", label: "Refresh & email", Icon: CalendarClock },
      ],
    },
    { items: [{ to: "/settings", label: "Settings", Icon: Settings }] },
  ];

  const nav = (
    <nav className="space-y-5" aria-label="Main">
      {GROUPS.map((g, gi) => (
        <div key={gi}>
          {g.title && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-side-faint">{g.title}</p>}
          <div className="flex flex-col gap-0.5">
            {g.items.map(({ to, label, Icon, end, match }) => {
              const isActive = match ? loc.pathname.startsWith(match) : end ? loc.pathname === to : loc.pathname.startsWith(to);
              return (
                <NavLink
                  key={label}
                  to={to}
                  end={end}
                  onClick={() => setOpen(false)}
                  aria-current={isActive ? "page" : undefined}
                  className={`relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${isActive ? "bg-side-soft font-medium text-white before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-brand-cyan" : "text-side-ink hover:bg-side-soft/60 hover:text-white"}`}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </NavLink>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const brand = (
    <NavLink to="/" className="block" onClick={() => setOpen(false)} aria-label="INGOVIQ AI Smart MIS — home">
      <img src={logoUrl} alt="INGOVIQ AI" width={900} height={279} className="h-8 w-auto lg:h-auto lg:w-40" />
      <span className="mt-2 hidden text-[11px] font-medium uppercase tracking-wider text-side-faint lg:block">Smart MIS · Business reporting</span>
    </NavLink>
  );

  const footer = (
    <div className="space-y-3">
      {active && (
        <div className="rounded-md border border-side-line bg-side-soft p-3">
          <p className="text-[11px] uppercase tracking-wider text-side-faint">Current dataset</p>
          <p className="mt-0.5 truncate text-sm font-medium text-white" title={active.name}>
            {active.name}
          </p>
          <p className="text-xs text-side-ink">
            {active.rowCount.toLocaleString("en-IN")} rows · {active.colCount} columns
          </p>
        </div>
      )}
      <p className="flex items-start gap-2 text-xs leading-relaxed text-side-faint">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Files stay in this browser tab. Nothing is uploaded or saved.
      </p>
      <p className="text-[11px] text-side-faint">© {new Date().getFullYear()} INGOVIQ AI</p>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_1fr]">
      <aside className="no-print sticky top-0 hidden h-screen flex-col justify-between overflow-y-auto bg-side p-4 lg:flex">
        <div className="space-y-7">
          <div className="px-1 pt-1">{brand}</div>
          {nav}
        </div>
        {footer}
      </aside>

      <header className="no-print sticky top-0 z-20 flex items-center justify-between bg-side px-4 py-3 lg:hidden">
        {brand}
        <button className="rounded-md p-1.5 text-white hover:bg-side-soft" onClick={() => setOpen(!open)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>
      {open && (
        <div className="no-print fixed inset-x-0 top-[56px] z-20 max-h-[calc(100vh-56px)] space-y-5 overflow-y-auto bg-side p-4 shadow-lg lg:hidden">
          {nav}
          {footer}
        </div>
      )}

      <main className="mx-auto w-full min-w-0 max-w-[92rem] px-4 py-6 sm:px-6 lg:px-8 lg:py-7">{children}</main>
    </div>
  );
}
