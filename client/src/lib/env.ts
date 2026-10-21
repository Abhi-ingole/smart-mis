/** Build-time flags. VITE_STATIC=true is used for the public GitHub Pages build (no server, so no AI). */
export const IS_STATIC = import.meta.env.VITE_STATIC === "true";
export const BASE = import.meta.env.BASE_URL; // "/" locally, "/smart-mis/" on GitHub Pages

export interface AiStatus {
  available: boolean;
  provider: string | null;
  reason?: "static" | "not-configured";
}

export async function aiStatus(): Promise<AiStatus> {
  if (IS_STATIC) return { available: false, provider: null, reason: "static" };
  try {
    const r = await fetch(`${BASE}api/ai/status`);
    if (!r.ok) throw new Error();
    return { ...(await r.json()), reason: "not-configured" };
  } catch {
    return { available: false, provider: null, reason: "not-configured" };
  }
}
