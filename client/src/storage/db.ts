/**
 * Local-only dataset storage (IndexedDB). Nothing here is sent to any server.
 * Metadata and rows live in separate stores so listing datasets stays fast.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Cell, DatasetMeta, DatasetRecord } from "../engine/types";

interface SmartMisDB extends DBSchema {
  meta: { key: string; value: DatasetMeta; indexes: { updatedAt: string } };
  rows: { key: string; value: { id: string; rows: Cell[][] } };
  settings: { key: string; value: unknown };
}

const DB_NAME = "smart-mis";
let dbPromise: Promise<IDBPDatabase<SmartMisDB>> | null = null;

function db() {
  dbPromise ??= openDB<SmartMisDB>(DB_NAME, 1, {
    upgrade(d) {
      const meta = d.createObjectStore("meta", { keyPath: "id" });
      meta.createIndex("updatedAt", "updatedAt");
      d.createObjectStore("rows", { keyPath: "id" });
      d.createObjectStore("settings");
    },
  });
  return dbPromise;
}

export async function listDatasets(): Promise<DatasetMeta[]> {
  const all = await (await db()).getAll("meta");
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getDataset(id: string): Promise<DatasetRecord | null> {
  const d = await db();
  const [meta, rows] = await Promise.all([d.get("meta", id), d.get("rows", id)]);
  if (!meta || !rows) return null;
  return { ...meta, rows: rows.rows };
}

export async function saveDataset(record: DatasetRecord): Promise<void> {
  const { rows, ...meta } = record;
  const d = await db();
  const tx = d.transaction(["meta", "rows"], "readwrite");
  await Promise.all([tx.objectStore("meta").put(meta), tx.objectStore("rows").put({ id: record.id, rows }), tx.done]);
}

/** Updates metadata only (schema, cleaning steps, dashboard…). Rows are never rewritten. */
export async function updateMeta(id: string, patch: Partial<Omit<DatasetMeta, "id">>): Promise<DatasetMeta> {
  const d = await db();
  const current = await d.get("meta", id);
  if (!current) throw new Error("Dataset not found.");
  const next = { ...current, ...patch, id, updatedAt: new Date().toISOString() };
  await d.put("meta", next);
  return next;
}

export async function deleteDataset(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(["meta", "rows"], "readwrite");
  await Promise.all([tx.objectStore("meta").delete(id), tx.objectStore("rows").delete(id), tx.done]);
}

export async function deleteAllData(): Promise<void> {
  const d = await db();
  const tx = d.transaction(["meta", "rows", "settings"], "readwrite");
  await Promise.all([tx.objectStore("meta").clear(), tx.objectStore("rows").clear(), tx.objectStore("settings").clear(), tx.done]);
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const v = await (await db()).get("settings", key);
  return (v as T) ?? fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await (await db()).put("settings", value, key);
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}

/** For tests: reset the cached connection. */
export function _resetConnection() {
  dbPromise = null;
}
