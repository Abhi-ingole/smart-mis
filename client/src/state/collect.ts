/**
 * Turns whatever the user drops or picks — files, whole folders, ZIP archives
 * (even ZIPs inside ZIPs) — into a flat list of files the parser can read.
 * Everything happens in the browser; nothing is uploaded.
 */
import { unzipSync } from "fflate";
import { LIMITS, SUPPORTED_EXTS } from "../engine/parse";

export const COLLECT_LIMITS = {
  maxFiles: 200,
  maxZipBytes: 200 * 1024 * 1024, // total unpacked size per top-level ZIP (zip-bomb guard)
  maxZipDepth: 3,
};

export interface Collected {
  files: File[];
  /** Files inside folders/ZIPs that were left out, grouped by reason. */
  skipped: { reason: string; names: string[] }[];
}

const ext = (name: string) => (name.split(".").pop() ?? "").toLowerCase();
const hidden = (path: string) => path.split("/").some((p) => p.startsWith(".") || p === "__MACOSX" || p.startsWith("~$"));

interface Item {
  file: File;
  /** Path shown to the user, e.g. "Reports/Oct.xlsx" or "data.zip › sales/oct.csv". */
  path: string;
  /** True when the user picked this file directly (not found inside a folder or ZIP). */
  direct: boolean;
}

/** Reads files and folders from a drag-and-drop. Must be called synchronously inside the drop handler. */
export function itemsFromDrop(dt: DataTransfer): Promise<Item[]> {
  const entries = [...dt.items].map((i) => (i.kind === "file" ? i.webkitGetAsEntry?.() : null));
  if (!entries.some(Boolean)) return Promise.resolve([...dt.files].map((file) => ({ file, path: file.name, direct: true })));
  return (async () => {
    const out: Item[] = [];
    for (const entry of entries) if (entry) await walk(entry, "", out, true);
    return out;
  })();
}

async function walk(entry: FileSystemEntry, prefix: string, out: Item[], top: boolean): Promise<void> {
  if (out.length > COLLECT_LIMITS.maxFiles * 5) return; // stop walking huge trees early
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push({ file, path: prefix + file.name, direct: top });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    let batch: FileSystemEntry[];
    do {
      // readEntries returns results in batches, so keep reading until it returns nothing.
      batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      for (const child of batch) await walk(child, `${prefix}${entry.name}/`, out, false);
    } while (batch.length > 0);
  }
}

/** Reads files from an <input type="file">, including a folder picked with webkitdirectory. */
export function itemsFromInput(list: FileList): Item[] {
  return [...list].map((file) => ({ file, path: file.webkitRelativePath || file.name, direct: !file.webkitRelativePath }));
}

/** Expands ZIPs, drops hidden/system files and anything the parser can't read. */
export async function collect(items: Item[]): Promise<Collected> {
  const files: File[] = [];
  const skipped = new Map<string, string[]>();
  const skip = (reason: string, name: string): void => {
    skipped.set(reason, [...(skipped.get(reason) ?? []), name]);
  };

  const add = (file: File, path: string, direct: boolean) => {
    if (files.length >= COLLECT_LIMITS.maxFiles) return skip(`Only the first ${COLLECT_LIMITS.maxFiles} files are read at once`, path);
    // Direct picks keep their own name so the parser reports a precise error for them.
    files.push(direct ? file : new File([file], path, { type: file.type, lastModified: file.lastModified }));
  };

  const visit = async (file: File | Blob, path: string, direct: boolean, depth: number): Promise<void> => {
    if (hidden(path)) return;
    const e = ext(path);
    if (e === "zip") {
      if (depth >= COLLECT_LIMITS.maxZipDepth) return skip("ZIP nested too deep", path);
      let entries: Record<string, Uint8Array>;
      try {
        let total = 0;
        let tooBig = false;
        entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
          filter: (f) => {
            if (f.name.endsWith("/") || hidden(f.name)) return false;
            const fe = ext(f.name);
            if (fe !== "zip" && !SUPPORTED_EXTS.includes(fe)) {
              skip("Not a spreadsheet, JSON or PDF", `${path} › ${f.name}`);
              return false;
            }
            if (f.originalSize > LIMITS.maxFileBytes && fe !== "zip") {
              skip(`Larger than ${LIMITS.maxFileBytes / 1048576} MB`, `${path} › ${f.name}`);
              return false;
            }
            total += f.originalSize;
            if (total > COLLECT_LIMITS.maxZipBytes) tooBig = true;
            return !tooBig;
          },
        });
        if (tooBig) skip(`ZIP unpacks to more than ${COLLECT_LIMITS.maxZipBytes / 1048576} MB; the rest was left out`, path);
      } catch (err) {
        return skip(`Couldn't open ZIP (${(err as Error).message || "damaged or password-protected"})`, path);
      }
      for (const [name, data] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
        const copy = new Uint8Array(data.byteLength);
        copy.set(data);
        await visit(new Blob([copy.buffer]), `${path} › ${name}`, false, depth + 1);
      }
      return;
    }
    if (!SUPPORTED_EXTS.includes(e)) {
      if (direct) return add(file as File, path, true); // let the parser explain why
      return skip("Not a spreadsheet, JSON or PDF", path);
    }
    add(file instanceof File ? file : new File([file], path), path, direct);
  };

  for (const it of items) await visit(it.file, it.path, it.direct, 0);
  return { files, skipped: [...skipped].map(([reason, names]) => ({ reason, names })) };
}
