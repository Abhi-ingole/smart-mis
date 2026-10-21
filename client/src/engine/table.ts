/**
 * Builds the typed working table from the ORIGINAL rows + the user's schema + cleaning steps.
 * The original rows are never changed; every view is recomputed from them.
 */
import type { Cell, CleaningOp, ColumnSchema, Table } from "./types";
import { cellText } from "./values";
import { toNumber } from "./infer";

const NUMERIC = new Set(["number", "currency", "percentage", "date", "boolean"]);
export const isNumericType = (c: ColumnSchema) => c.type === "number" || c.type === "currency" || c.type === "percentage";

export function buildTable(schema: ColumnSchema[], rows: Cell[][]): Table {
  const num: Table["num"] = {};
  const str: Table["str"] = {};
  for (const col of schema) {
    const i = col.index;
    if (NUMERIC.has(col.type)) num[col.key] = rows.map((r) => toNumber(r[i] ?? null, col));
    str[col.key] = rows.map((r) => {
      const t = cellText(r[i] ?? null);
      if (t === null) return null;
      return col.type === "boolean" ? (/^(yes|y|true|t)$/i.test(t) ? "Yes" : /^(no|n|false|f)$/i.test(t) ? "No" : t) : t;
    });
  }
  return { schema, rows, num, str };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mode(values: string[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  let bestN = 0;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

export interface OpResult {
  rows: Cell[][];
  changedCells: number;
  removedRows: number;
  examples: { row: number; column?: string; before: string; after: string }[];
}

const isBlank = (c: Cell) => c === null || (typeof c === "string" && c.trim() === "");

/** Applies one cleaning step, returning new rows (input is not mutated) and what changed. */
export function applyOp(rows: Cell[][], schema: ColumnSchema[], op: CleaningOp): OpResult {
  const examples: OpResult["examples"] = [];
  const colOf = (key: string) => schema.find((c) => c.key === key);
  switch (op.kind) {
    case "trim": {
      let changed = 0;
      const cols = op.columnKey ? [colOf(op.columnKey)!] : schema;
      const out = rows.map((r, ri) => {
        let copy: Cell[] | null = null;
        for (const c of cols) {
          const v = r[c.index];
          if (typeof v === "string") {
            const t = v.replace(/\s+/g, " ").trim();
            if (t !== v) {
              copy ??= [...r];
              copy[c.index] = t === "" ? null : t;
              changed++;
              if (examples.length < 5) examples.push({ row: ri + 1, column: c.name, before: JSON.stringify(v), after: JSON.stringify(t) });
            }
          }
        }
        return copy ?? r;
      });
      return { rows: out, changedCells: changed, removedRows: 0, examples };
    }
    case "removeDuplicates": {
      const seen = new Set<string>();
      const out: Cell[][] = [];
      rows.forEach((r, ri) => {
        const k = JSON.stringify(r);
        if (seen.has(k)) {
          if (examples.length < 5) examples.push({ row: ri + 1, before: "duplicate row", after: "removed" });
          return;
        }
        seen.add(k);
        out.push(r);
      });
      return { rows: out, changedCells: 0, removedRows: rows.length - out.length, examples };
    }
    case "dropMissingRows": {
      const c = colOf(op.columnKey)!;
      const out = rows.filter((r, ri) => {
        const blank = isBlank(r[c.index] ?? null);
        if (blank && examples.length < 5) examples.push({ row: ri + 1, column: c.name, before: "empty", after: "row removed" });
        return !blank;
      });
      return { rows: out, changedCells: 0, removedRows: rows.length - out.length, examples };
    }
    case "fillMissing": {
      const c = colOf(op.columnKey)!;
      let fill: Cell = null;
      if (op.method === "value") fill = op.value ?? "";
      else if (op.method === "zero") fill = 0;
      else if (op.method === "mode") fill = mode(rows.map((r) => cellText(r[c.index] ?? null)).filter((v): v is string => v !== null));
      else {
        const nums = rows.map((r) => toNumber(r[c.index] ?? null, c)).filter((v): v is number => v !== null);
        if (nums.length) fill = op.method === "mean" ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : median(nums);
        if (fill !== null && c.type === "percentage" && c.percentScale === "fraction") fill = (fill as number) / 100;
      }
      let changed = 0;
      const out = rows.map((r, ri) => {
        if (!isBlank(r[c.index] ?? null) || fill === null) return r;
        const copy = [...r];
        copy[c.index] = fill;
        changed++;
        if (examples.length < 5) examples.push({ row: ri + 1, column: c.name, before: "empty", after: String(fill) });
        return copy;
      });
      return { rows: out, changedCells: changed, removedRows: 0, examples };
    }
    case "replaceValue": {
      const c = colOf(op.columnKey)!;
      let changed = 0;
      const from = op.from.trim().toLowerCase();
      const out = rows.map((r, ri) => {
        const t = cellText(r[c.index] ?? null);
        if (t === null || t.toLowerCase() !== from) return r;
        const copy = [...r];
        copy[c.index] = op.to === "" ? null : op.to;
        changed++;
        if (examples.length < 5) examples.push({ row: ri + 1, column: c.name, before: t, after: op.to || "empty" });
        return copy;
      });
      return { rows: out, changedCells: changed, removedRows: 0, examples };
    }
  }
}

export function applyOps(rows: Cell[][], schema: ColumnSchema[], ops: CleaningOp[]): Cell[][] {
  return ops.reduce((acc, op) => applyOp(acc, schema, op).rows, rows);
}

export function describeOp(op: CleaningOp, schema: ColumnSchema[]): string {
  const name = (k?: string) => (k ? `"${schema.find((c) => c.key === k)?.name ?? k}"` : "all columns");
  switch (op.kind) {
    case "trim":
      return `Trim extra spaces in ${name(op.columnKey)}`;
    case "removeDuplicates":
      return "Remove exact duplicate rows";
    case "dropMissingRows":
      return `Remove rows where ${name(op.columnKey)} is empty`;
    case "fillMissing":
      return `Fill empty ${name(op.columnKey)} with ${op.method === "value" ? `"${op.value}"` : op.method}`;
    case "replaceValue":
      return `Replace "${op.from}" with "${op.to || "(empty)"}" in ${name(op.columnKey)}`;
  }
}

/** Indexes of rows that pass the dashboard filters. */
export function filterRows(table: Table, filters: { categories: Record<string, string[]>; dateColumn?: string; dateFrom?: string; dateTo?: string }, isoToDay: (s: string) => number): number[] {
  const cats = Object.entries(filters.categories).filter(([, v]) => v.length > 0);
  const from = filters.dateColumn && filters.dateFrom ? isoToDay(filters.dateFrom) : null;
  const to = filters.dateColumn && filters.dateTo ? isoToDay(filters.dateTo) : null;
  const dates = filters.dateColumn ? table.num[filters.dateColumn] : undefined;
  const sets = cats.map(([k, v]) => [table.str[k], new Set(v)] as const);
  const out: number[] = [];
  for (let i = 0; i < table.rows.length; i++) {
    let ok = true;
    for (const [col, set] of sets) {
      const v = col?.[i];
      if (v === null || v === undefined || !set.has(v)) {
        ok = false;
        break;
      }
    }
    if (ok && dates && (from !== null || to !== null)) {
      const d = dates[i];
      if (d === null || (from !== null && d < from) || (to !== null && d > to)) ok = false;
    }
    if (ok) out.push(i);
  }
  return out;
}
