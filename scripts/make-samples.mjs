/**
 * Generates the FAKE example datasets used for testing and the "Explore Demo" button.
 * All names and numbers are invented. Deterministic: same output every run.
 *   npm run samples
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "@e965/xlsx";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDirs = [path.join(root, "samples"), path.join(root, "client", "public", "samples")];
outDirs.forEach((d) => fs.mkdirSync(d, { recursive: true }));

let s = 20261021;
const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rand() * a.length)];
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dmy = (d) => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
const FIRST = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Ananya", "Vivaan", "Isha", "Arjun", "Saanvi", "Reyansh", "Kiara", "Aditya", "Myra", "Ishaan", "Tara", "Neel", "Zoya", "Dev", "Riya"];
const LAST = ["Sharma", "Patil", "Iyer", "Khan", "Desai", "Nair", "Joshi", "Mehta", "Rao", "Kulkarni", "Gupta", "Pillai"];
const name = () => `${pick(FIRST)} ${pick(LAST)}`;

function write(file, data) {
  for (const d of outDirs) fs.writeFileSync(path.join(d, file), data);
  console.log("wrote", file);
}
function writeXlsx(file, sheets) {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, aoa] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, UTC: true }), sheetName);
  write(file, XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates: true }));
}
const csv = (aoa) => aoa.map((r) => r.map((v) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(",")).join("\n") + "\n";

// ── A. Sales (Excel, two sheets) ────────────────────────────
{
  const products = [
    ["Laptop Stand", "Accessories", 1499],
    ["Wireless Mouse", "Accessories", 799],
    ["Mechanical Keyboard", "Accessories", 3499],
    ["27in Monitor", "Displays", 15999],
    ["24in Monitor", "Displays", 10999],
    ["USB-C Dock", "Accessories", 5499],
    ["Noise-cancelling Headset", "Audio", 6999],
    ["Bluetooth Speaker", "Audio", 2999],
    ["Webcam HD", "Video", 2499],
    ["Office Chair", "Furniture", 12999],
  ];
  const regions = ["North", "South", "East", "West", "Central"];
  const pay = ["UPI", "Card", "Net Banking", "Cash on Delivery"];
  const customers = Array.from({ length: 140 }, () => `${pick(LAST)} ${pick(["Traders", "Enterprises", "Solutions", "Retail", "Stores", "Labs"])}`);
  const rows = [["Order ID", "Order Date", "Customer", "Region", "Product", "Category", "Quantity", "Unit Price (₹)", "Revenue (₹)", "Payment Mode"]];
  const start = Date.UTC(2025, 3, 1);
  for (let i = 0; i < 640; i++) {
    const day = Math.min(364, Math.floor((i / 640) * 365 + rand() * 3));
    const d = new Date(start + day * 86400000);
    const [p, cat, price] = pick(products);
    const regionW = rand() < 0.34 ? "West" : pick(regions);
    const qty = int(1, rand() < 0.08 ? 40 : 8);
    const unit = Math.round(price * (0.9 + rand() * 0.2));
    rows.push([`SO-${10001 + i}`, d, pick(customers), regionW, p, cat, qty, unit, qty * unit, pick(pay)]);
  }
  const targets = [["Region", "Annual Target (₹)"], ...regions.map((r) => [r, int(40, 90) * 100000])];
  writeXlsx("sales-orders.xlsx", [["Orders", rows], ["Targets", targets]]);
}

// ── B. HR (Excel) ───────────────────────────────────────────
{
  const depts = [["Engineering", ["Software Engineer", "Senior Engineer", "Tech Lead"], 95000], ["Sales", ["Sales Executive", "Account Manager"], 60000], ["Operations", ["Operations Analyst", "Ops Manager"], 55000], ["Finance", ["Accountant", "Finance Manager"], 70000], ["HR", ["HR Executive", "HR Manager"], 58000], ["Support", ["Support Associate", "Support Lead"], 40000]];
  const rows = [["Employee ID", "Name", "Department", "Designation", "Gender", "Age", "Date of Joining", "Monthly Salary (₹)", "City", "Status", "Performance Rating"]];
  for (let i = 0; i < 230; i++) {
    const [dept, roles, base] = pick(depts);
    const join = new Date(Date.UTC(2016 + int(0, 9), int(0, 11), int(1, 28)));
    const status = rand() < 0.14 ? "Resigned" : "Active";
    rows.push([`EMP${1001 + i}`, name(), dept, pick(roles), rand() < 0.46 ? "Female" : "Male", int(22, 58), join, Math.round((base * (0.75 + rand() * 0.7)) / 100) * 100, pick(["Mumbai", "Pune", "Bengaluru", "Hyderabad", "Delhi"]), status, int(1, 5)]);
  }
  writeXlsx("hr-employees.xlsx", [["Employees", rows]]);
}

// ── C. Student marks (CSV) ──────────────────────────────────
{
  const subjects = ["Mathematics", "Science", "English", "History", "Computer Science"];
  const rows = [["Roll No", "Student Name", "Class", "Gender", "Subject", "Marks Obtained", "Result"]];
  for (let r = 1; r <= 60; r++) {
    const n = name();
    const cls = pick(["10-A", "10-B", "10-C"]);
    const g = rand() < 0.5 ? "Female" : "Male";
    const ability = 45 + rand() * 40;
    for (const sub of subjects) {
      const m = Math.max(5, Math.min(100, Math.round(ability + (rand() - 0.5) * 40)));
      rows.push([`R${String(r).padStart(3, "0")}`, n, cls, g, sub, m, m >= 35 ? "Pass" : "Fail"]);
    }
  }
  write("student-marks.csv", csv(rows));
}

// ── D. Unknown custom data (CSV) — no business meaning on purpose ──
{
  const rows = [["Batch", "Zone Code", "Alpha", "Beta", "Gamma Index", "Flag"]];
  for (let i = 0; i < 300; i++) {
    const a = +(rand() * 50 + 10).toFixed(2);
    rows.push([`B-${int(1, 12)}`, pick(["Z1", "Z2", "Z3", "Z4"]), a, +(a * 1.8 + (rand() - 0.5) * 20).toFixed(2), +(rand() * 5).toFixed(3), rand() < 0.3 ? "Y" : "N"]);
  }
  write("custom-measurements.csv", csv(rows));
}

// ── E. Messy data: title row, missing values, duplicates, mixed types, bad dates, spaces ──
{
  const rows = [["Quarterly Expense Register"], [], ["Expense Date", "Department", "Category", "Amount", "Amount", "Approved By", "Notes"]];
  const cats = ["Travel", "Software", "Office Supplies", "Meals", "Training"];
  const base = [];
  for (let i = 0; i < 180; i++) {
    const d = new Date(Date.UTC(2026, int(0, 2), int(1, 28)));
    const amt = int(200, 25000);
    base.push([
      rand() < 0.04 ? "31/02/2026" : dmy(d),
      rand() < 0.1 ? "" : pick(["Sales", "Engineering", "Operations", " Sales ", "Finance"]),
      pick(cats),
      rand() < 0.05 ? "N/A" : amt,
      rand() < 0.5 ? amt : "",
      rand() < 0.15 ? "" : pick(FIRST),
      rand() < 0.7 ? "" : pick(["urgent", "client visit", "renewal", "=SUM(A1:A9)"]),
    ]);
  }
  for (let i = 0; i < 12; i++) base.push([...base[int(0, base.length - 1)]]); // exact duplicates
  write("messy-expenses.csv", csv([...rows, ...base]));
}
