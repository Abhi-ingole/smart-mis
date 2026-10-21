/**
 * Create the first admin (works in production, where no demo users exist).
 *   npm run create-admin -- --email you@company.com --name "Your Name" --company "Your Company"
 * A strong random password is printed once unless you pass --password.
 */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { config } from "../lib/config";
import { prisma } from "../lib/db";
import { runMigrations } from "./migrate";
import { SETTING_DEFAULTS } from "../services/settings";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  void config;
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim() || "Admin";
  const companyName = arg("company")?.trim();
  let password = arg("password");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !companyName) {
    console.error('Usage: npm run create-admin -- --email you@company.com --name "Your Name" --company "Your Company" [--password "..."]');
    process.exit(1);
  }
  if (password && password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }
  const generated = !password;
  password ??= crypto.randomBytes(12).toString("base64url");

  runMigrations(undefined, false);
  if (await prisma.user.findUnique({ where: { email } })) {
    console.error(`A user with ${email} already exists.`);
    process.exit(1);
  }
  let company = await prisma.company.findFirst({ where: { name: companyName } });
  if (!company) {
    company = await prisma.company.create({ data: { name: companyName } });
    await prisma.setting.createMany({ data: Object.entries(SETTING_DEFAULTS).map(([key, value]) => ({ companyId: company!.id, key, value })) });
  }
  const user = await prisma.user.create({ data: { companyId: company.id, name, email, role: "admin", passwordHash: await bcrypt.hash(password, 12) } });
  await prisma.auditLog.create({ data: { companyId: company.id, userId: user.id, action: "create_admin_cli", entity: "user", entityId: String(user.id) } });
  console.log(`Admin ${email} created for "${company.name}".`);
  if (generated) console.log(`Temporary password (shown once, change it after logging in): ${password}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
