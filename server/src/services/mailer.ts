import nodemailer, { type Transporter } from "nodemailer";
import { config, isMailConfigured } from "../lib/config";

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  transporter = config.mail.dryRun
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: config.mail.user, pass: config.mail.appPassword },
      });
  return transporter;
}

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  cid?: string;
}

export async function sendMail(opts: { to: string[]; subject: string; html: string; text?: string; attachments?: MailAttachment[] }) {
  if (!isMailConfigured()) {
    throw new Error("Email is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in .env.");
  }
  const to = [...new Set(opts.to.map((e) => e.trim()).filter(Boolean))];
  if (!to.length) throw new Error("No email recipients are set. Add them in Settings → Report recipients.");
  const info = await getTransporter().sendMail({
    from: { name: config.mail.fromName, address: config.mail.user || "smart-mis@localhost" },
    to,
    subject: opts.subject.replace(/[\r\n]+/g, " "),
    html: opts.html,
    text: opts.text,
    attachments: opts.attachments,
  });
  if (config.mail.dryRun && !config.isTest) {
    console.log(`[mail:dry-run] to=${to.join(", ")} subject="${opts.subject}" (${opts.html.length} bytes html, ${opts.attachments?.length ?? 0} attachments)`);
  }
  return { to, messageId: info.messageId };
}

/** Turns a data: URL into an inline attachment (PNG/JPEG only). */
export function dataUrlAttachment(dataUrl: string | null | undefined, filename: string, cid: string): MailAttachment | null {
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? "");
  if (!m) return null;
  return { filename, content: Buffer.from(m[2], "base64"), contentType: m[1], cid };
}
