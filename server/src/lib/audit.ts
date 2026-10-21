import type { Request } from "express";
import { prisma } from "./db";

const SECRET_KEYS = /pass(word)?|token|secret|api[_-]?key|authorization|cookie|hash/i;

/** Remove anything that looks like a secret before it reaches the audit log. */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "[redacted]" : scrub(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 500) return value.slice(0, 500) + "…";
  return value;
}

export function clientIp(req: Request): string {
  return (req.ip ?? req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
}

export async function audit(
  req: Request | null,
  entry: { action: string; entity: string; entityId?: string | number | null; details?: unknown; companyId?: number | null; userId?: number | null },
) {
  try {
    await prisma.auditLog.create({
      data: {
        companyId: entry.companyId ?? req?.user?.companyId ?? null,
        userId: entry.userId ?? req?.user?.id ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId === undefined || entry.entityId === null ? null : String(entry.entityId),
        detailsJson: entry.details === undefined ? null : JSON.stringify(scrub(entry.details)),
        ip: req ? clientIp(req) : null,
      },
    });
  } catch (e) {
    console.error("[audit] failed to write audit log:", (e as Error).message);
  }
}
