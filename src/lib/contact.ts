/**
 * The two ways people prove who they are, checked the same way as they type and on the server (Pong, 21 Nov 2026:
 * "Make text validation for both email and Thai phone number"): everyone but doctors by a Thai mobile number (an SMS
 * code), doctors by an email address (an email code). Isomorphic: the forms import it for their live checks, and
 * lib/phone.ts re-exports the number rules for the server. scripts/phone.mjs repeats PHONE_RE and normalizePhone() for
 * the dev scripts (a unit test keeps the two identical).
 */

/**
 * Thai mobile numbers in their canonical form "0812345678": ten digits, a leading 0, then 6, 8 or 9 (the mobile
 * ranges); db/schema.sql checks the same pattern.
 */
export const PHONE_RE = /^0[689]\d{8}$/;

/** What a number field says when the number is not a Thai mobile number. U+00A0 keeps "10 หลัก" on one line. */
export const PHONE_RULE = "ใส่เบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 06, 08 หรือ 09";

/** What an email field says when the address cannot be one. */
export const EMAIL_RULE = "อีเมลไม่ถูกต้อง เช่น name@gmail.com";

/** Full-width and Thai digits (๐-๙) to ASCII; spaces, dashes, dots and parentheses removed. */
function phoneCharacters(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
    .replace(/[\s\-.()‐-―]/g, "");
}

/**
 * NFKC (full-width digits), Thai digits ๐-๙ to ASCII, spaces, dashes, dots and parentheses removed; accepts
 * 0XXXXXXXXX, 66XXXXXXXXX and +66XXXXXXXXX (also with the 0 kept: +660XXXXXXXXX, as on business cards). Returns the
 * canonical "0812345678", or null when it is not a Thai mobile number.
 */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 40) return null;
  let v = phoneCharacters(input);
  if (/^\+66\d{9}$/.test(v)) v = `0${v.slice(3)}`;
  else if (/^66\d{9}$/.test(v)) v = `0${v.slice(2)}`;
  // "+66 (0) 81 234 5678", "+66 081-234-5678": the country code written before the national number with its 0.
  else if (/^\+?660\d{9}$/.test(v)) v = v.replace(/^\+?66/, "");
  return PHONE_RE.test(v) ? v : null;
}

/**
 * The start of a Thai mobile number in any form normalizePhone() takes: "08", "081-23", "+66 8", "+66 (0) 8". A number
 * typed so far that matches can still become one.
 */
const PHONE_START = [/^0(?:[689]\d{0,7})?$/, /^\+?6(?:6(?:0?(?:[689]\d{0,7})?)?)?$/, /^\+$/];

/** Why a number typed so far is not a Thai mobile number yet. */
export type PhoneProblem = "empty" | "partial" | "invalid";

/**
 * Null for a Thai mobile number; "empty"; "partial" while what is typed can still become one (a field says nothing
 * yet); "invalid" when it cannot, whatever comes next (a landline such as 02, a number too long), so a field can say
 * so at once.
 */
export function phoneProblem(input: string): PhoneProblem | null {
  if (normalizePhone(input)) return null;
  const v = phoneCharacters(input);
  if (!v) return "empty";
  return input.length <= 40 && PHONE_START.some((re) => re.test(v)) ? "partial" : "invalid";
}

/**
 * Thai (๐-๙) and full-width digits -> ASCII; keeps only what a phone number is typed with; max 20 characters (after
 * cleaning, so a pasted "+66 (0) 81 234 5678" is never cut short).
 */
export function cleanPhoneInput(v: string): string {
  return v
    .normalize("NFKC")
    .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
    .replace(/[^\d+\- ().]/g, "")
    .slice(0, 20);
}

const EMAIL_LOCAL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const EMAIL_DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * An email address in the form user_emails keeps it (trimmed, lower case), or null when it cannot be one: a name part
 * of letters, digits and the usual signs (no dot at either end or two in a row, 64 characters at most), "@", then a
 * domain of labels with a top-level part of letters ("gmail.com", "skh.go.th"); 254 characters at most.
 */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim().toLowerCase();
  if (!v || v.length > 254) return null;
  const at = v.lastIndexOf("@");
  if (at < 1) return null;
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  return local.length <= 64 && EMAIL_LOCAL.test(local) && EMAIL_DOMAIN.test(domain) ? v : null;
}
