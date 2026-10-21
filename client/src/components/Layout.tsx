import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { BarChart3, FilePlus2, FileText, KeyRound, LogOut, Menu, Settings, X } from "lucide-react";
import { useAuth } from "../lib/auth";

const NAV = [
  { to: "/", label: "Dashboard", Icon: BarChart3, need: null },
  { to: "/add", label: "Add daily data", Icon: FilePlus2, need: "edit" as const },
  { to: "/reports", label: "Reports", Icon: FileText, need: null },
  { to: "/settings", label: "Settings", Icon: Settings, need: "admin" as const },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, company, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const links = NAV.filter((n) => !n.need || can(n.need));

  const nav = (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {links.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${isActive ? "bg-white/10 font-medium text-white" : "text-white/65 hover:bg-white/5 hover:text-white"}`
          }
        >
          <Icon className="h-4 w-4" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );

  const footer = (
    <div className="border-t border-white/10 pt-4 text-sm">
      <p className="truncate font-medium text-white">{user?.name}</p>
      <p className="truncate text-xs text-white/55">
        {user?.email} · <span className="capitalize">{user?.role}</span>
      </p>
      <div className="mt-3 flex flex-col items-start gap-0.5">
        <button
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-white/65 hover:bg-white/5 hover:text-white"
          onClick={() => {
            setOpen(false);
            navigate("/password");
          }}
        >
          <KeyRound className="h-3.5 w-3.5" /> Change password
        </button>
        <button
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-white/65 hover:bg-white/5 hover:text-white"
          onClick={async () => {
            await logout();
            navigate("/login");
          }}
        >
          <LogOut className="h-3.5 w-3.5" /> Log out
        </button>
      </div>
    </div>
  );

  const brand = (
    <div className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="h-7 w-7" />
      <div className="leading-tight">
        <p className="text-sm font-semibold text-white">Smart MIS</p>
        <p className="max-w-[11rem] truncate text-xs text-white/55">{company?.name}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-screen flex-col justify-between bg-rail p-4 lg:flex">
        <div className="space-y-8">
          {brand}
          {nav}
        </div>
        {footer}
      </aside>

      {/* Mobile bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between bg-rail px-4 py-3 lg:hidden">
        {brand}
        <button className="text-white" onClick={() => setOpen(!open)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>
      {open && (
        <div className="fixed inset-x-0 top-[52px] z-20 space-y-4 bg-rail p-4 shadow-lg lg:hidden">
          {nav}
          {footer}
        </div>
      )}

      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
