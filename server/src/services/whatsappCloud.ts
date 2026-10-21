/**
 * Optional WhatsApp Cloud API sender (Meta). Disabled unless WA_CLOUD_TOKEN and
 * WA_CLOUD_PHONE_NUMBER_ID are set. Note: Meta only delivers free-form text inside
 * a 24-hour customer-service window; outside it you need an approved template.
 */
import { config, isWaCloudConfigured } from "../lib/config";

export async function sendWhatsappText(numbers: string[], text: string) {
  if (!isWaCloudConfigured()) throw new Error("WhatsApp Cloud API is not configured.");
  const results: { to: string; ok: boolean; error?: string }[] = [];
  for (const raw of numbers) {
    const to = raw.replace(/\D/g, "");
    if (!to) continue;
    try {
      const res = await fetch(`https://graph.facebook.com/${config.waCloud.apiVersion}/${config.waCloud.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.waCloud.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { preview_url: false, body: text.slice(0, 4000) } }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        results.push({ to, ok: false, error: body.error?.message ?? `HTTP ${res.status}` });
      } else {
        results.push({ to, ok: true });
      }
    } catch (e) {
      results.push({ to, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
