/**
 * Device gate: the board, and LINE Login with it, opens only inside the board's LIFF app in the LINE app on a mobile
 * phone. Every other browser gets the "open in LINE" page instead, before the sign-in gate, so LINE Login cannot be
 * started (or finished) outside LIFF.
 *
 * The check reads the User-Agent, which a determined person can fake: it keeps the board off desktop browsers, out of
 * ordinary phone browsers and out of plain LINE chats, while the sign-in (LINE + SMS code + a claimed name) stays the
 * real access control.
 *
 * Modes:
 *   liff - the LIFF app on a phone (LINE adds "LIFF" to the in-app browser's User-Agent there). Always on Vercel
 *          (production and preview), whether or not LIFF_ID is set.
 *   off  - no gate. The default outside Vercel (local development and tests), and the break-glass CLIENT_GATE=off.
 */

export type GateMode = "off" | "liff";

/** A LIFF ID as LINE issues it, e.g. 2001234567-AbCdEfGh. */
const LIFF_ID_RE = /^\d{6,}-[A-Za-z0-9]{4,}$/;

function read(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** The registered LIFF app's id, or null when unset or malformed. Not a secret. */
export function liffId(): string | null {
  const v = read("LIFF_ID");
  return v && LIFF_ID_RE.test(v) ? v : null;
}

/** https://liff.line.me/<LIFF_ID>, the link that opens the board as a LIFF app, or null without a LIFF ID. */
export function liffUrl(): string | null {
  const id = liffId();
  return id ? `https://liff.line.me/${id}` : null;
}

export function gateMode(): GateMode {
  const explicit = read("CLIENT_GATE")?.toLowerCase();
  if (explicit === "off") return "off"; // break-glass, e.g. if LINE ever changes its User-Agent
  if (explicit) return "liff"; // "liff", or anything else: fail closed
  return process.env.VERCEL ? "liff" : "off";
}

/** LINE's in-app browser: "... Line/14.5.0" (iOS) or "... Line/14.5.0/IAB" (Android). */
export function isLineApp(ua: string): boolean {
  return /\bLine\/\d+(?:\.\d+)*/.test(ua);
}

/** A LIFF app inside LINE: the in-app browser adds the token "LIFF". */
export function isLiff(ua: string): boolean {
  return isLineApp(ua) && /\bLIFF\b/.test(ua);
}

/** A phone: iPhone or iPod, or Android with "Mobile" (Android tablets leave it out). iPads are not phones. */
export function isPhone(ua: string): boolean {
  if (/\b(?:iPhone|iPod)\b/.test(ua)) return true;
  return /\bAndroid\b/.test(ua) && /\bMobile\b/.test(ua);
}

export function clientAllowed(ua: string | null | undefined, mode: GateMode): boolean {
  if (mode === "off") return true;
  const s = ua ?? "";
  return isPhone(s) && isLiff(s);
}

export const GATE_PATH = "/open-in-line";
