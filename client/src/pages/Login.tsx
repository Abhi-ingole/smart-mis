import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Alert, Field } from "../components/ui";

export default function LoginPage() {
  const { user, login, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";

  if (!loading && user) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_28rem]">
      <section className="hidden flex-col justify-between bg-rail p-12 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          <span className="font-semibold">Smart MIS</span>
        </div>
        <div className="max-w-lg">
          <p className="text-4xl font-semibold leading-tight tracking-tight">
            Yesterday's campaign numbers, in your boss's inbox by seven.
          </p>
          <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-white/10 text-sm">
            <div className="bg-rail p-4">
              <p className="flex items-center gap-2 text-white/60">
                <span className="h-2 w-2 rounded-full bg-wa" /> WhatsApp
              </p>
              <p className="mt-2 text-white/85">Drop the vendor PDF. Delivered and sent are read for you.</p>
            </div>
            <div className="bg-rail p-4">
              <p className="flex items-center gap-2 text-white/60">
                <span className="h-2 w-2 rounded-sm bg-mail" /> Email
              </p>
              <p className="mt-2 text-white/85">Upload the stats export. Opens and sends land in the same report.</p>
            </div>
          </div>
        </div>
        <p className="text-xs text-white/40">Numbers are always calculated in code. The AI only writes the summary.</p>
      </section>

      <section className="flex items-center justify-center px-4 py-12">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5" noValidate>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
            <p className="mt-1 text-sm text-ink-soft">Use the email your admin set up for you.</p>
          </div>
          {error && <Alert kind="error">{error}</Alert>}
          <Field label="Email" htmlFor="email">
            <input id="email" type="email" autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password" htmlFor="password">
            <input id="password" type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <button className="btn-primary w-full" disabled={busy || !email || !password}>
            {busy ? "Logging in…" : "Log in"}
          </button>
          {import.meta.env.DEV && (
            <p className="rounded-md border border-dashed border-line p-3 text-xs text-ink-soft">
              Demo (development only): admin@demo.com, member@demo.com or viewer@demo.com — password Demo@123
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
