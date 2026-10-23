import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DatasetMeta, DatasetRecord } from "../engine/types";
import { analyzeRecord, type Analysis } from "../engine/pipeline";
import { deleteAllData, deleteDataset, getDataset, listDatasets, onDatasetChange, saveDataset, updateMeta } from "../storage/db";

interface DatasetsState {
  datasets: DatasetMeta[] | null;
  error: string | null;
  refresh: () => Promise<void>;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  add: (records: DatasetRecord[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  removeAll: () => Promise<void>;
}

const Ctx = createContext<DatasetsState | null>(null);
const ACTIVE_KEY = "smart-mis:active";

try {
  localStorage.removeItem(ACTIVE_KEY); // left by older versions
} catch {
  /* ignore */
}

function readActive(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function DatasetsProvider({ children }: { children: ReactNode }) {
  const [datasets, setDatasets] = useState<DatasetMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActive] = useState<string | null>(readActive);

  const refresh = useCallback(async () => {
    try {
      setDatasets(await listDatasets());
      setError(null);
    } catch (e) {
      setError(`Couldn't load data (${(e as Error).message}). Private/incognito windows may block it.`);
      setDatasets([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setActiveId = useCallback((id: string | null) => {
    setActive(id);
    try {
      if (id) sessionStorage.setItem(ACTIVE_KEY, id);
      else sessionStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value: DatasetsState = {
    datasets,
    error,
    refresh,
    activeId: activeId && datasets?.some((d) => d.id === activeId) ? activeId : (datasets?.[0]?.id ?? null),
    setActiveId,
    add: async (records) => {
      for (const r of records) await saveDataset(r);
      if (records[0]) setActiveId(records[0].id);
      await refresh();
    },
    remove: async (id) => {
      await deleteDataset(id);
      if (activeId === id) setActiveId(null);
      await refresh();
    },
    rename: async (id, name) => {
      await updateMeta(id, { name: name.trim().slice(0, 120) || "Untitled dataset" });
      await refresh();
    },
    removeAll: async () => {
      await deleteAllData();
      setActiveId(null);
      await refresh();
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDatasets() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDatasets outside provider");
  return v;
}

/** Loads one dataset and keeps its analysis in sync with schema/cleaning edits. */
export function useDataset(id: string | undefined) {
  const { refresh, setActiveId } = useDatasets();
  const [record, setRecord] = useState<DatasetRecord | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const [version, setVersion] = useState(0);
  useEffect(() => onDatasetChange((changed) => changed === id && setVersion((v) => v + 1)), [id]);

  useEffect(() => {
    let alive = true;
    if (!id) {
      setState("missing");
      return;
    }
    if (version === 0) setState("loading");
    getDataset(id)
      .then((r) => {
        if (!alive) return;
        if (!r) setState("missing");
        else {
          setRecord(r);
          setState("ready");
          setActiveId(r.id);
        }
      })
      .catch((e) => {
        if (!alive) return;
        setError((e as Error).message);
        setState("error");
      });
    return () => {
      alive = false;
    };
  }, [id, setActiveId, version]);

  const analysis: Analysis | null = useMemo(() => (record ? analyzeRecord(record) : null), [record?.schema, record?.ops, record?.rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback(
    async (patch: Partial<Omit<DatasetMeta, "id">>) => {
      if (!record) return;
      const meta = await updateMeta(record.id, patch);
      setRecord((r) => (r ? { ...r, ...meta } : r));
      void refresh();
    },
    [record, refresh],
  );

  return { record, analysis, state, error, update };
}
