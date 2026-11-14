import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTransport } from "nodemailer";
import type { EmailConfig } from "../env";
import { BRAND_MARK_CID, BRAND_MARK_PNG_BASE64 } from "./brand-mark";
import { codeHtml as renderCodeHtml } from "./code-html";

/**
 * Sends a doctor's sign-in code by email (lib/email-otp.ts), as plain text with an HTML version in the app's theme
 * (code-html.ts) that carries the app's mark as an inline image:
 * - smtp (the only mode on Vercel): through an SMTP server, e.g. Gmail (smtp.gmail.com:465) with an app password;
 * - console / file (development and tests): the email goes to the log, or to a JSON file
 *   {to, subject, text, html, code, at} in EMAIL_OUTBOX_DIR.
 */

/** How long a code may be used, in minutes (lib/email-otp.ts). Kept here so the text and the check agree. */
export const EMAIL_CODE_TTL_MIN = 10;
const SEND_TIMEOUT_MS = 15_000;

export type EmailFailure = "misconfigured" | "rejected" | "failed";

export type EmailResult = { ok: true; accepted: number } | { ok: false; reason: EmailFailure };

export interface EmailTransport {
  /** Sends the code to every address in `to` (all of them belong to the same doctor). */
  sendCode(args: { to: string[]; code: string; name: string }): Promise<EmailResult>;
}

export function codeSubject(code: string): string {
  return `รหัสเข้าสู่ระบบ ORSKH: ${code}`;
}

/** Plain text, no link: the code is typed into the page that asked for it. */
export function codeText(code: string, name: string): string {
  return [
    `เรียน ${name}`,
    "",
    `รหัสเข้าสู่ระบบตารางห้องผ่าตัด (ORSKH) ของคุณคือ ${code}`,
    `รหัสใช้ได้ ${EMAIL_CODE_TTL_MIN} นาที และใช้ได้ครั้งเดียว`,
  ].join("\n");
}

/** The HTML version of codeText(), laid out like the app's sign-in page. */
export function codeHtml(code: string, name: string): string {
  return renderCodeHtml(code, name, EMAIL_CODE_TTL_MIN);
}

/** The app's mark, referenced by codeHtml() as cid:BRAND_MARK_CID. */
function brandMarkAttachment() {
  return {
    filename: "orskh.png",
    content: Buffer.from(BRAND_MARK_PNG_BASE64, "base64"),
    contentType: "image/png",
    cid: BRAND_MARK_CID,
    contentDisposition: "inline" as const,
  };
}

/** The whole message: plain text, the HTML version and the mark it shows inline. */
export function codeMessage(from: string, to: string[], code: string, name: string) {
  return {
    from,
    to,
    subject: codeSubject(code),
    text: codeText(code, name),
    html: codeHtml(code, name),
    attachments: [brandMarkAttachment()],
  };
}

export function emailTransport(cfg: EmailConfig): EmailTransport {
  if (cfg.kind === "smtp") {
    const mailer = createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      requireTLS: !cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
      connectionTimeout: SEND_TIMEOUT_MS,
      greetingTimeout: SEND_TIMEOUT_MS,
      socketTimeout: SEND_TIMEOUT_MS,
    });
    return {
      async sendCode({ to, code, name }) {
        try {
          // One message to all of the doctor's own addresses.
          const info = await mailer.sendMail(codeMessage(cfg.from, to, code, name));
          const accepted = Array.isArray(info.accepted) ? info.accepted.length : 0;
          return accepted > 0 ? { ok: true, accepted } : { ok: false, reason: "rejected" };
        } catch (e) {
          const err = e as { code?: string; responseCode?: number; message?: string };
          console.error("[email] sending failed:", err.code ?? "", err.responseCode ?? "", err.message ?? "");
          // EAUTH: wrong user or app password. Everything else is treated as a failed send.
          return { ok: false, reason: err.code === "EAUTH" || err.code === "ECONFIG" ? "misconfigured" : "failed" };
        }
      },
    };
  }
  return {
    async sendCode({ to, code, name }) {
      const message = {
        to,
        subject: codeSubject(code),
        text: codeText(code, name),
        html: codeHtml(code, name),
        code,
        at: new Date().toISOString(),
      };
      try {
        if (cfg.kind === "file") {
          await mkdir(cfg.outboxDir, { recursive: true });
          await writeFile(join(cfg.outboxDir, `${Date.now()}-${randomBytes(4).toString("hex")}.json`), JSON.stringify(message, null, 2));
        } else {
          console.info(`[email:console] to=${to.join(",")} subject=${message.subject}`);
        }
      } catch (e) {
        console.error("[email] local delivery failed:", (e as Error).message);
        return { ok: false, reason: "failed" };
      }
      return { ok: true, accepted: to.length };
    },
  };
}
