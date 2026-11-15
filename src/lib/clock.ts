import "server-only";
import { readFileSync } from "node:fs";
import { bangkokParts, todayIso } from "./days";
import { onVercel } from "./env";

export { bangkokParts };

/**
 * The app's clock. Every time decision of the repair-phase board (the 16:00 turnover, the upload window, the target
 * day of an upload) reads now() instead of new Date(), so tests can set the time:
 *
 * - APP_FAKE_NOW: an ISO time with its offset, e.g. 2026-11-16T15:30:00+07:00.
 * - APP_FAKE_NOW_FILE: the path of a file holding such a time. It is read again on every call, so the end-to-end tests
 *   can move the clock of a running server. It wins over APP_FAKE_NOW while it holds a valid time.
 *
 * Both are ignored on Vercel, so a stray variable can never move production's clock, and so is a value that is not a
 * full ISO time with an offset (a time without one would depend on the server's own time zone).
 */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

let warned = false;

function parse(raw: string | undefined, source: string): Date | null {
  const text = raw?.trim();
  if (!text) return null;
  const ms = ISO_TIME.test(text) ? Date.parse(text) : NaN;
  if (Number.isFinite(ms)) return new Date(ms);
  if (!warned) {
    warned = true;
    // The name only: the value is test data, but a log line has no need for it.
    console.warn(`[clock] ${source} is not an ISO time with an offset; using the real time`);
  }
  return null;
}

function readFake(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    // No file (yet): the tests have not set a time, so the real one applies.
    return undefined;
  }
}

/** The current time: the real one, or the tests' fake time (see above) outside Vercel. */
export function now(): Date {
  if (onVercel()) return new Date();
  const file = process.env.APP_FAKE_NOW_FILE?.trim();
  return (file ? parse(readFake(file), "APP_FAKE_NOW_FILE") : null) ?? parse(process.env.APP_FAKE_NOW, "APP_FAKE_NOW") ?? new Date();
}

/**
 * Today's date in Thailand by now(). lib/days.ts todayIso() keeps new Date() as its default because client components
 * import lib/days.ts, and this module reads files and server settings.
 */
export function today(): string {
  return todayIso(now());
}
