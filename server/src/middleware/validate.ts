import type { RequestHandler } from "express";
import { z, type ZodType } from "zod";

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Parsed and validated input. Handlers read from here, never from raw req.body/query/params. */
      valid: { body: any; query: any; params: any };
    }
  }
}

function formatIssues(err: z.ZodError) {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

/**
 * Validates body, query and params with zod. Unknown keys are stripped.
 * Routes with no schema for a part get an empty strict object, so unexpected input is rejected.
 */
export function validate(schemas: Schemas = {}): RequestHandler {
  const body = schemas.body ?? z.object({}).strict().optional();
  const query = schemas.query ?? z.object({}).strict();
  const params = schemas.params ?? z.object({}).strict();
  return (req, res, next) => {
    const b = body.safeParse(req.body ?? undefined);
    const q = query.safeParse({ ...(req.query as object) });
    const p = params.safeParse({ ...req.params });
    const failed = [b, q, p].find((r) => !r.success);
    if (failed && !failed.success) {
      res.status(400).json({ error: "Invalid request", details: formatIssues(failed.error) });
      return;
    }
    req.valid = { body: (b as any).data ?? {}, query: (q as any).data, params: (p as any).data };
    next();
  };
}
