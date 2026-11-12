/**
 * Device gate: the board opens only inside the LINE app on a mobile phone (and, once a LIFF app is registered, only
 * through that LIFF app). Every other browser gets the "open in LINE" page instead, before the sign-in gate.
 *
 * The check reads the User-Agent, which a determined person can fake: it keeps the board off desktop browsers and
 * out of ordinary phone browsers, while the sign-in (LINE + SMS code + a claimed name) stays the real access control.
 *
 * Modes (CLIENT_GATE):
 *   off  - no gate (the default outside Vercel production: local development, tests and preview deployments)
 *   line - the LINE app's in-app browser on a phone
 *   liff - as line, and the page must be opened as a LIFF app (LINE adds "LIFF" to the User-Agent there)
 * Unset in production: liff when LIFF_ID is set, otherwise line, so a deploy before the LIFF app exists locks no one out.
 */

export type GateMode = "off" | "line" | "liff";

const MODES: readonly GateMode[] = ["off", "line", "liff"];

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
  if (explicit && (MODES as readonly string[]).includes(explicit)) return explicit as GateMode;
  if (explicit) return "liff"; // a typo fails closed
  if (process.env.VERCEL_ENV !== "production") return "off";
  return liffId() ? "liff" : "line";
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
  if (!isPhone(s) || !isLineApp(s)) return false;
  return mode === "line" || isLiff(s);
}

export const GATE_PATH = "/open-in-line";
