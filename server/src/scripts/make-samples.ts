/**
 * Writes FAKE sample vendor files to /samples so you can try the upload + extraction flow.
 * No real data: all numbers, names and phone numbers are invented.
 *   npx tsx src/scripts/make-samples.ts
 */
import fs from "node:fs";
import path from "node:path";

/** Builds a tiny, valid one-page PDF with plain text lines (Helvetica). */
export function makeTextPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = ["BT", "/F1 12 Tf", "14 TL", "50 780 Td", ...lines.map((l, i) => (i === 0 ? `(${esc(l)}) Tj` : `T* (${esc(l)}) Tj`)), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export const SAMPLE_WA_LINES = [
  "Example Messaging Vendor - Campaign Delivery Report",
  "Report date: 20-10-2026",
  "Campaign: Festive Offer",
  "Account manager contact: +91 98000 00000 / support@example.com",
  "Total Submitted: 12,480",
  "Delivered: 11,902",
  "Read: 8,115",
  "Failed: 578",
  "Delivery rate: 95.4%",
];

if (require.main === module) {
  const dir = path.resolve(__dirname, "../../../samples");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "sample-whatsapp-vendor-report.pdf"), makeTextPdf(SAMPLE_WA_LINES));
  fs.writeFileSync(
    path.join(dir, "sample-email-stats.csv"),
    ["Metric,Value", "Campaign,Weekly Newsletter", "Emails Sent,8450", "Delivered,8302", "Unique Opens,1987", "Open Rate,23.9%", "Clicks,412", "Bounced,148"].join("\n") + "\n",
  );
  const statuses = ["Delivered", "Read", "Delivered", "Failed", "Read", "Delivered", "Sent", "Read"];
  fs.writeFileSync(
    path.join(dir, "sample-whatsapp-per-recipient.csv"),
    ["Phone,Name,Status,Timestamp", ...statuses.map((s, i) => `+9198000000${String(i).padStart(2, "0")},Test User ${i + 1},${s},2026-10-20 10:${String(i).padStart(2, "0")}`)].join("\n") + "\n",
  );
  console.log(`Sample files written to ${dir}`);
}
