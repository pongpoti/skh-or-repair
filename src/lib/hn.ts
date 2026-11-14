/**
 * Hospital numbers (HN): how a doctor's booking and a HOSxP workbook case are matched (lib/board-rows.ts). The two
 * sides write the same number differently ("0012345", "12-345", " 12345 ", full-width digits), so both are stored and
 * compared in one normalised form. Isomorphic: the booking form checks it too. Never log an HN.
 */

/** Longest HN a booking takes, in characters, before normalising. */
export const MAX_HN = 15;

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

/**
 * A booking's HN, required: up to 15 letters, digits and dashes once trimmed (Thai and full-width digits count as
 * digits). Returns the normalised form to store.
 */
export function checkHn(raw: unknown): CheckedHn {
  const text =
    typeof raw === "string"
      ? raw
          .trim()
          .normalize("NFKC")
          .replace(THAI_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0e50))
      : "";
  if (!text) return { ok: false, error: "ใส่ HN ของผู้ป่วย" };
  if (text.length > MAX_HN || !/^[0-9A-Za-z-]+$/.test(text)) {
    return { ok: false, error: `HN ใช้ได้เฉพาะตัวเลข ตัวอักษรอังกฤษ และ - ไม่เกิน ${MAX_HN} ตัว` };
  }
  const hn = normalizeHn(text);
  return hn ? { ok: true, hn } : { ok: false, error: "ใส่ HN ของผู้ป่วย" };
}
