import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";

export type Role = "admin" | "member" | "viewer";
export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  companyId: number;
}

interface AuthState {
  user: User | null;
  company: { id: number; name: string } | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (action: "edit" | "admin") => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [company, setCompany] = useState<{ id: number; name: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<{ user: User; company: { id: number; name: string } }>("/api/auth/me");
      setUser(me.user);
      setCompany(me.company);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) console.error(e);
      setUser(null);
      setCompany(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = async (email: string, password: string) => {
    await api.post("/api/auth/login", { email, password });
    await refresh();
  };
  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => undefined);
    setUser(null);
    setCompany(null);
  };
  // UI hint only — the server enforces every permission itself.
  const can = (action: "edit" | "admin") => (action === "admin" ? user?.role === "admin" : user?.role === "admin" || user?.role === "member");

  return <Ctx.Provider value={{ user, company, loading, login, logout, refresh, can }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
