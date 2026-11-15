/**
 * Hospital numbers (HN): how a doctor's booking and a HOSxP workbook case are matched (lib/board-rows.ts). The two
 * sides write the same number differently ("0012345", "12-345", " 12345 ", full-width digits), so both are stored and
 * compared in one normalised form. Isomorphic: the booking form checks it too. Never log an HN.
 */

const THAI_DIGITS = /[๐-๙]/g;

/**
 * The matching form of an HN: Unicode NFKC (full-width letters and digits become plain ones), Thai digits as Arabic
 * ones, no whitespace or dashes, upper case, and no leading zeros ("0" stays when the number is all zeros). Anything
 * else is kept as it is, so two different numbers never become one. Empty when there is nothing left.
 */
export function normalizeHn(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  const text = String(raw)
    .normalize("NFKC")
    .replace(THAI_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0e50))
    .replace(/[\s-]+/g, "")
    .toUpperCase();
  const trimmed = text.replace(/^0+/, "");
  return trimmed === "" && text !== "" ? "0" : trimmed;
}

export type CheckedHn = { ok: true; hn: string } | { ok: false; error: string };

/** Hospital numbers at รพ.สมุทรสาคร have 7 digits (Pong, 15 Nov 2026). */
export const HN_LENGTH = 7;

/**
 * A booking's HN, required: exactly 7 digits once spaces and dashes are taken out (Thai and full-width digits count as
 * digits). Returns the normalised form to store and match (normalizeHn: no leading zeros).
 */
export function checkHn(raw: unknown): CheckedHn {
  const text =
    typeof raw === "string"
      ? raw
          .normalize("NFKC")
          .replace(THAI_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0e50))
          .replace(/[\s-]+/g, "")
      : "";
  if (!text) return { ok: false, error: "ใส่ HN ของผู้ป่วย" };
  if (!/^\d+$/.test(text) || text.length !== HN_LENGTH) return { ok: false, error: `HN ต้องเป็นตัวเลข ${HN_LENGTH} หลัก` };
  return { ok: true, hn: normalizeHn(text) };
}

/**
 * An HN as people read it: a number of digits only is shown with its leading zeros back, as 7 digits ("0123456" is
 * stored as "123456"); anything else as it is.
 */
export function displayHn(hn: string): string {
  return /^\d{1,6}$/.test(hn) ? hn.padStart(HN_LENGTH, "0") : hn;
}
