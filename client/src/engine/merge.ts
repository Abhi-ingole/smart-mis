/**
 * Guided join of two datasets. Nothing is joined automatically: the user picks
 * the key columns and sees the match rate and warnings before creating the result.
 * Source datasets are not modified.
 */
import type { Cell, ColumnSchema, DatasetRecord } from "./types";
import { cellText } from "./values";

export interface JoinPlan {
  leftKey: string; // column key
  rightKey: string;
  type: "inner" | "left";
}

export interface JoinPreview {
  leftRows: number;
  rightRows: number;
  matchedLeftRows: number;
  matchRate: number; // % of left rows with a match
  resultRows: number;
  duplicateRightKeys: number;
  warnings: string[];
  headers: string[];
  sample: Cell[][];
}

const norm = (c: Cell) => cellText(c)?.trim().toLowerCase() ?? null;

function index(rows: Cell[][], col: number) {
  const map = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const k = norm(r[col] ?? null);
    if (k === null) return;
    const arr = map.get(k);
    if (arr) arr.push(i);
    else map.set(k, [i]);
  });
  return map;
}

export function planJoin(left: DatasetRecord, right: DatasetRecord, plan: JoinPlan, sampleSize = 10): JoinPreview & { rows: Cell[][] } {
  const lc = left.schema.find((c) => c.key === plan.leftKey) as ColumnSchema;
  const rc = right.schema.find((c) => c.key === plan.rightKey) as ColumnSchema;
  const warnings: string[] = [];
  const typeGroup = (t: string) => (["number", "currency", "percentage", "identifier"].includes(t) ? "numeric-ish" : t === "date" ? "date" : "text");
  if (typeGroup(lc.type) !== typeGroup(rc.type)) warnings.push(`"${lc.name}" (${lc.type}) and "${rc.name}" (${rc.type}) have different types — matches may be accidental.`);
  const rIndex = index(right.rows, rc.index);
  const dupKeys = [...rIndex.values()].filter((v) => v.length > 1).length;
  if (dupKeys) warnings.push(`${dupKeys} key value(s) appear more than once in "${right.name}", so some rows will be repeated in the result.`);

  const rightCols = right.headers.map((h, i) => ({ h, i })).filter(({ i }) => i !== rc.index);
  const leftNames = new Set(left.headers.map((h) => h.toLowerCase()));
  const headers = [...left.headers, ...rightCols.map(({ h }) => (leftNames.has(h.toLowerCase()) ? `${h} (${right.name})` : h))];
  const rows: Cell[][] = [];
  let matched = 0;
  for (const lr of left.rows) {
    const k = norm(lr[lc.index] ?? null);
    const hits = k === null ? undefined : rIndex.get(k);
    if (hits?.length) {
      matched++;
      for (const ri of hits) rows.push([...lr, ...rightCols.map(({ i }) => right.rows[ri][i] ?? null)]);
    } else if (plan.type === "left") {
      rows.push([...lr, ...rightCols.map(() => null)]);
    }
  }
  const matchRate = left.rows.length ? (matched / left.rows.length) * 100 : 0;
  if (matchRate < 50) warnings.push(`Only ${matchRate.toFixed(1)}% of rows in "${left.name}" found a match. Check that the key columns really refer to the same thing.`);
  if (rows.length > 300_000) warnings.push("The result would be too large to analyse in the browser.");
  return { leftRows: left.rows.length, rightRows: right.rows.length, matchedLeftRows: matched, matchRate, resultRows: rows.length, duplicateRightKeys: dupKeys, warnings, headers, sample: rows.slice(0, sampleSize), rows };
}
