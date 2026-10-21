import fs from "node:fs";
import path from "node:path";
import { parseFile } from "../src/engine/parse";
import { analyzeSheet, analyzeRecord } from "../src/engine/pipeline";
import { evaluateKpis } from "../src/engine/kpi";
import { allRows } from "../src/engine/analytics";
import type { DatasetRecord } from "../src/engine/types";

export const SAMPLES = path.resolve(__dirname, "../../samples");

export function fileFrom(name: string, data?: Buffer | string) {
  const buf = data === undefined ? fs.readFileSync(path.join(SAMPLES, name)) : Buffer.from(data);
  return {
    name,
    size: buf.length,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  };
}

export async function loadSample(name: string, sheet?: string): Promise<DatasetRecord> {
  const parsed = await parseFile(fileFrom(name));
  const s = sheet ? parsed.sheets.find((x) => x.name === sheet)! : parsed.sheets[0];
  return analyzeSheet(s, parsed);
}

export function evaluate(record: DatasetRecord) {
  const a = analyzeRecord(record);
  const rows = allRows(a.table);
  const time = record.schema.find((c) => c.role === "time" && !c.excluded)?.key;
  const values = evaluateKpis(record.dashboard.kpis, a.table, rows, { quality: a.quality }, time);
  const byName = (name: string) => {
    const def = record.dashboard.kpis.find((k) => k.name === name);
    if (!def) throw new Error(`KPI "${name}" not found. Have: ${record.dashboard.kpis.map((k) => k.name).join(", ")}`);
    return values.find((v) => v.id === def.id)!;
  };
  return { ...a, rows, values, byName };
}
