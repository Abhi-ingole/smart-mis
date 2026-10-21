/** Fetch wrapper: same-origin cookies, CSRF header on writes, readable errors. */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: any,
  ) {
    super(message);
  }
}

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

let csrfPromise: Promise<string> | null = null;

async function csrfToken(): Promise<string> {
  const existing = readCookie("smis_csrf");
  if (existing) return existing;
  csrfPromise ??= fetch("/api/auth/csrf", { credentials: "same-origin" })
    .then((r) => r.json())
    .then((d) => d.csrfToken as string)
    .finally(() => (csrfPromise = null));
  return csrfPromise;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function request<T>(method: Method, url: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (method !== "GET") headers["X-CSRF-Token"] = await csrfToken();
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: payload, credentials: "same-origin" });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    // A stale CSRF cookie: fetch a fresh one and retry once.
    if (res.status === 403 && /csrf/i.test(data?.error ?? "") && !retried) {
      document.cookie = "smis_csrf=; Max-Age=0; path=/";
      return request<T>(method, url, body, true);
    }
    const details = Array.isArray(data?.details) ? data.details.map((d: { message: string }) => d.message).join(" ") : "";
    throw new ApiError(res.status, [data?.error ?? `Request failed (${res.status})`, details].filter(Boolean).join(" — "), data);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>("PATCH", url, body ?? {}),
  del: <T>(url: string) => request<T>("DELETE", url),
};

export function qs(params: Record<string, string | number | undefined | null>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
}
