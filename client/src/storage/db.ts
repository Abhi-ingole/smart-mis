/**
 * Storage. Nothing here is sent to any server, and uploaded data is not saved:
 * datasets are held in memory for the current tab only. IndexedDB keeps settings only.
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

/*
 * Uploaded data is NOT saved anywhere. Datasets live only in this tab's memory and
 * disappear when the tab is closed or reloaded. Only small preferences (settings)
 * are kept in IndexedDB. Data that older versions saved in the browser is wiped.
 */
const memory = new Map<string, DatasetRecord>();

let purged: Promise<void> | null = null;
/** Removes datasets that earlier versions stored in IndexedDB (runs once per page load). */
export function purgeStoredDatasets(): Promise<void> {
  purged ??= (async () => {
    try {
      const d = await db();
      const tx = d.transaction(["meta", "rows"], "readwrite");
      await Promise.all([tx.objectStore("meta").clear(), tx.objectStore("rows").clear(), tx.done]);
    } catch {
      /* storage blocked (e.g. private window) — nothing was stored then either */
    }
  })();
  return purged;
}
if (typeof indexedDB !== "undefined") void purgeStoredDatasets();

const metaOf = ({ rows: _rows, ...meta }: DatasetRecord): DatasetMeta => meta;

export async function listDatasets(): Promise<DatasetMeta[]> {
  return [...memory.values()].map(metaOf).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getDataset(id: string): Promise<DatasetRecord | null> {
  return memory.get(id) ?? null;
}

export async function saveDataset(record: DatasetRecord): Promise<void> {
  memory.set(record.id, record);
}

/** Updates metadata only (schema, cleaning steps, dashboard…). Rows are never rewritten. */
export async function updateMeta(id: string, patch: Partial<Omit<DatasetMeta, "id">>): Promise<DatasetMeta> {
  const current = memory.get(id);
  if (!current) throw new Error("Dataset not found.");
  const next = { ...current, ...patch, id, updatedAt: new Date().toISOString() };
  memory.set(id, next);
  return metaOf(next);
}

export async function deleteDataset(id: string): Promise<void> {
  memory.delete(id);
}

export async function deleteAllData(): Promise<void> {
  memory.clear();
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
  purged = null;
}
