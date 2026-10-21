/**
 * Upload validation: a file is accepted only when its extension, its declared
 * MIME type AND its actual bytes (file signature) all agree.
 */
export type FileKind = "pdf" | "csv" | "xlsx" | "png" | "jpg";

const MIME: Record<FileKind, string[]> = {
  pdf: ["application/pdf"],
  csv: ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  png: ["image/png"],
  jpg: ["image/jpeg", "image/jpg", "image/pjpeg"],
};

const EXT: Record<string, FileKind> = { pdf: "pdf", csv: "csv", xlsx: "xlsx", png: "png", jpg: "jpg", jpeg: "jpg" };

export const ALLOWED_EXTENSIONS = Object.keys(EXT);

const startsWith = (buf: Buffer, bytes: number[]) => bytes.every((b, i) => buf[i] === b);

function looksLikeXlsx(buf: Buffer): boolean {
  if (!startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return false;
  const head = buf.subarray(0, Math.min(buf.length, 64 * 1024)).toString("latin1");
  // Zip local headers store entry names in plain text.
  return head.includes("[Content_Types].xml") || head.includes("xl/");
}

function looksLikeCsv(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  const sample = buf.subarray(0, Math.min(buf.length, 64 * 1024));
  if (sample.includes(0)) return false; // binary
  const binarySigs = [[0x25, 0x50, 0x44, 0x46], [0x89, 0x50, 0x4e, 0x47], [0xff, 0xd8, 0xff], [0x50, 0x4b, 0x03, 0x04], [0x4d, 0x5a], [0x7f, 0x45, 0x4c, 0x46]];
  if (binarySigs.some((s) => startsWith(sample, s))) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample.subarray(0, Math.max(0, sample.length - 4)));
  } catch {
    return false;
  }
  return /[,;\t\n]/.test(sample.toString("utf8"));
}

export function sniff(buf: Buffer): FileKind | null {
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "jpg";
  if (looksLikeXlsx(buf)) return "xlsx";
  if (looksLikeCsv(buf)) return "csv";
  return null;
}

export interface CheckResult {
  ok: boolean;
  kind?: FileKind;
  reason?: string;
}

export function checkUpload(file: { originalname: string; mimetype: string; buffer: Buffer; size: number }, allowed: FileKind[] = ["pdf", "csv", "xlsx", "png", "jpg"], maxBytes = 10 * 1024 * 1024): CheckResult {
  if (file.size > maxBytes || file.buffer.length > maxBytes) return { ok: false, reason: "File too large. Maximum size is 10 MB." };
  const ext = (file.originalname.split(".").pop() ?? "").toLowerCase();
  const byExt = EXT[ext];
  if (!byExt || !allowed.includes(byExt)) return { ok: false, reason: `File type not allowed. Allowed: ${allowed.map((k) => k.toUpperCase()).join(", ")}.` };
  const mime = (file.mimetype || "").toLowerCase().split(";")[0].trim();
  if (!MIME[byExt].includes(mime)) return { ok: false, reason: "File type does not match its content type." };
  const actual = sniff(file.buffer);
  if (actual !== byExt) return { ok: false, reason: "File content does not match its extension." };
  return { ok: true, kind: actual };
}

export const MIME_FOR: Record<FileKind, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  jpg: "image/jpeg",
};
