import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { Alert, Field, PageHeader } from "../components/ui";

export default function ChangePasswordPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < 8;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mismatch || tooShort) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.post("/api/auth/change-password", { currentPassword: current, newPassword: next });
      setMsg({ kind: "success", text: "Password changed. Other devices have been logged out." });
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md">
      <PageHeader title="Change password" description="Use at least 8 characters. Changing it logs you out everywhere else." />
      <form onSubmit={submit} className="panel space-y-4 p-5">
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <Field label="Current password" htmlFor="cur">
          <input id="cur" type="password" autoComplete="current-password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" htmlFor="new" error={tooShort ? "At least 8 characters" : undefined}>
          <input id="new" type="password" autoComplete="new-password" className="input" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Repeat new password" htmlFor="rep" error={mismatch ? "Passwords don't match" : undefined}>
          <input id="rep" type="password" autoComplete="new-password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <button className="btn-primary" disabled={busy || !current || !next || mismatch || tooShort}>
          {busy ? "Saving…" : "Change password"}
        </button>
      </form>
    </div>
  );
}
