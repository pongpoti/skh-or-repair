import "server-only";
import { normalizePhone, PHONE_RE } from "./contact";
import { allowedPhonesRaw } from "./env";

/**
 * Thai mobile numbers, the sign-in identity. Stored and compared in one canonical form, "0812345678" (PHONE_RE). The
 * pattern and normalizePhone() live in lib/contact.ts, which the forms share for their live checks.
 */
export { normalizePhone, PHONE_RE };

/** "0812345678" -> "66812345678", the format the SMS provider expects. */
export function toInternational(phone: string): string {
  return `66${phone.slice(1)}`;
}

/** "0812345678" -> "081-234-5678" for display. Anything else is returned unchanged. */
export function formatPhone(phone: string): string {
  return PHONE_RE.test(phone) ? `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}` : phone;
}

/**
 * Parses a comma, semicolon or newline separated list into canonical numbers (spaces and dashes inside a number are
 * fine). Invalid entries are dropped.
 */
export function parsePhoneList(raw: string): Set<string> {
  const out = new Set<string>();
  for (const part of raw.split(/[,;\n]+/)) {
    const p = normalizePhone(part);
    if (p) out.add(p);
  }
  return out;
}

let memo: { raw: string; set: Set<string> } | null = null;

/** True when the number is in the break-glass ALLOWED_PHONES (normalized on both sides). False when it is unset. */
export function isAllowedPhone(phone: string): boolean {
  const raw = allowedPhonesRaw();
  if (!raw) return false;
  if (!memo || memo.raw !== raw) memo = { raw, set: parsePhoneList(raw) };
  const p = normalizePhone(phone);
  return p !== null && memo.set.has(p);
}
