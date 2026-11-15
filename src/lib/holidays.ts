import { addDays, workdayIndex } from "./days.ts";

/**
 * Thai public and special holidays, when the operating suite runs no elective list.
 *
 * Source: the Bank of Thailand's Financial Institutions' Holidays API, which lists the public holidays,
 * substitution days and the special holidays the cabinet announces during the year. It needs a free
 * token from https://portal.api.bot.or.th in BOT_API_TOKEN. Dates the API does not know, such as a
 * hospital-only closure, can be added in EXTRA_HOLIDAYS ("2026-12-30=ปิดปรับปรุง,2026-12-31").
 */

export type Holiday = { date: string; name: string };

const ENDPOINT = "https://gateway.api.bot.or.th/financial-institutions-holidays/";
/** How far ahead the next workday is looked for: long enough for Songkran and the New Year. */
export const LOOKAHEAD_DAYS = 14;

/**
 * The feed's address: BOT_HOLIDAYS_URL points it at a mock for the end-to-end tests, ignored on Vercel like the other
 * development overrides. (VERCEL is read here rather than through lib/env.ts, which is server-only, so this module
 * stays importable by client code for isWorkday.)
 */
function endpoint(year: number): string {
  const override = process.env.BOT_HOLIDAYS_URL?.trim();
  const url = new URL(override && !process.env.VERCEL ? override : ENDPOINT);
  url.searchParams.set("year", String(year));
  return url.toString();
}

/** Special holidays are announced at short notice, so the list is fetched again every six hours. */
const REVALIDATE_SECONDS = 6 * 60 * 60;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The holidays in a BOT API response: `{ result: { data: [{ Date, HolidayDescriptionThai, … }] } }`. */
export function parseBotHolidays(json: unknown): Holiday[] {
  const data = (json as { result?: { data?: unknown } } | null)?.result?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    const date = typeof item?.Date === "string" ? item.Date.trim().slice(0, 10) : "";
    if (!ISO_DATE.test(date)) return [];
    const name = [item.HolidayDescriptionThai, item.HolidayDescription].find((value) => typeof value === "string" && value.trim());
    return [{ date, name: typeof name === "string" ? name.trim() : "วันหยุด" }];
  });
}

/** Extra closures from EXTRA_HOLIDAYS: comma-separated dates, each optionally followed by `=name`. */
export function parseExtraHolidays(raw: string | undefined): Holiday[] {
  return (raw ?? "").split(",").flatMap((entry) => {
    const [date, ...name] = entry.split("=");
    const day = date.trim();
    return ISO_DATE.test(day) ? [{ date: day, name: name.join("=").trim() || "วันหยุด" }] : [];
  });
}

/** The holiday on `iso`, if any. A date listed twice keeps its first name. */
export function holidayIn(holidays: readonly Holiday[], iso: string): Holiday | null {
  return holidays.find((holiday) => holiday.date === iso) ?? null;
}

/** What the BOT API gave for one year: the holidays, or why there are none. */
export type HolidayFeed =
  | { state: "ok"; holidays: Holiday[] }
  | { state: "no-token" }
  /** `status` is the HTTP status the API answered with (200 when it gave no holiday list), or null when it could not be reached. */
  | { state: "failed"; status: number | null };

/**
 * One year's holidays from the BOT API, kept for six hours. Only 200 answers are cached, so a refused token is asked
 * about again on the next request; a 200 without a list (a year not announced yet) is kept too, so the year's list can
 * take up to six hours to show once the BOT has it.
 */
export async function botHolidayFeed(year: number, options: { token?: string } = {}): Promise<HolidayFeed> {
  // A token pasted into Vercel can pick up a stray space or line break.
  const token = (options.token ?? process.env.BOT_API_TOKEN)?.trim();
  if (!token) return { state: "no-token" };
  try {
    const response = await fetch(endpoint(year), {
      headers: { Authorization: token, Accept: "application/json" },
      next: { revalidate: REVALIDATE_SECONDS },
    } as RequestInit);
    const body = await response.text();
    if (!response.ok) {
      console.warn(`BOT holidays API answered ${response.status} for ${year}: ${oneLine(body, token)}`);
      return { state: "failed", status: response.status };
    }
    const json = readJson(body);
    if (json === undefined) {
      // Seen in production for a year the BOT has not announced yet (2027, on 15 Nov 2026): a 200 with an empty body.
      console.warn(`BOT holidays API answered ${response.status} for ${year} without a holiday list: ${oneLine(body, token)}`);
      return { state: "failed", status: response.status };
    }
    return { state: "ok", holidays: parseBotHolidays(json) };
  } catch (error) {
    // fetch quotes a header value it refuses (a token with a line break inside), so the token is blanked here too.
    console.warn(`BOT holidays API could not be reached: ${blank(String(error), token)}`);
    return { state: "failed", status: null };
  }
}

/**
 * The BOT's answer for the log: its start on one line (its gateway says why a key is refused), with the token blanked
 * should it ever be echoed back.
 */
function oneLine(body: string, token: string): string {
  const line = blank(body, token).replace(/\s+/g, " ").trim();
  return line ? line.slice(0, 200) : "(no body)";
}

/** The JSON in `body`, or undefined when it is not JSON (an empty body included). */
function readJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** `text` with every copy of the token replaced by ***, for the log. */
function blank(text: string, token: string): string {
  return text.split(token).join("***");
}

/** The holiday on a YYYY-MM-DD date in Thailand, from EXTRA_HOLIDAYS first, then the BOT API. */
export async function holidayOn(iso: string): Promise<Holiday | null> {
  const extra = holidayIn(parseExtraHolidays(process.env.EXTRA_HOLIDAYS), iso);
  if (extra) return extra;
  const feed = await botHolidayFeed(Number(iso.slice(0, 4)));
  return feed.state === "ok" ? holidayIn(feed.holidays, iso) : null;
}

/** A workday: Monday to Friday and not one of `holidays`. */
export function isWorkday(iso: string, holidays: readonly Holiday[]): boolean {
  return workdayIndex(iso) !== null && holidayIn(holidays, iso) === null;
}

/** The first workday after `iso` (not `iso` itself) within `maxDays`, or null when there is none. */
export function nextWorkdayIn(iso: string, holidays: readonly Holiday[], maxDays: number = LOOKAHEAD_DAYS): string | null {
  for (let step = 1; step <= maxDays; step += 1) {
    const day = addDays(iso, step);
    if (isWorkday(day, holidays)) return day;
  }
  return null;
}

/**
 * Holidays over a span of days, or why the BOT feed could not give them (with what could be had). `unlisted` holds the
 * years (Gregorian) the BOT gave no holidays for: its feed failed, or it answered with an empty list, as for a year it
 * has not announced yet (every year has holidays). The calendars say so under the grid.
 */
export type HolidayList =
  | { ok: true; holidays: Holiday[]; unlisted: number[] }
  | { ok: false; reason: "no-token" | "failed"; holidays: Holiday[]; unlisted: number[] };

/**
 * The holidays from `from` to `to` (YYYY-MM-DD): EXTRA_HOLIDAYS and the BOT feed of every year in between. When a
 * year's feed is not "ok" (no token, refused, unreachable) the answer says why, and still carries EXTRA_HOLIDAYS and
 * the years that did load, so the board can fall back to weekdays while the upload refuses (lib/board-day.ts). An
 * empty list is still "ok": only the calendars' note (`unlisted`) tells it apart.
 */
export async function holidaysBetween(from: string, to: string): Promise<HolidayList> {
  const holidays = parseExtraHolidays(process.env.EXTRA_HOLIDAYS);
  const first = Number(from.slice(0, 4));
  const last = Number(to.slice(0, 4));
  let reason: "no-token" | "failed" | null = null;
  const unlisted: number[] = [];
  for (let year = first; year <= last; year += 1) {
    const feed = await botHolidayFeed(year);
    if (feed.state === "ok") holidays.push(...feed.holidays);
    else reason ??= feed.state;
    if (feed.state !== "ok" || feed.holidays.length === 0) unlisted.push(year);
  }
  return reason ? { ok: false, reason, holidays, unlisted } : { ok: true, holidays, unlisted };
}

/** The next workday after `iso`, or why it cannot be known. */
export type NextWorkday = { ok: true; date: string } | { ok: false; reason: "no-token" | "failed" | "none" };

/**
 * The first workday after `iso` by EXTRA_HOLIDAYS and the BOT feed, looking up to 14 days ahead (and so into the next
 * year at the end of December). Without the feed the day cannot be trusted, so the answer is not ok: an upload's
 * target day must not be guessed (Pong, 30 Oct 2026).
 */
export async function nextWorkdayAfter(iso: string): Promise<NextWorkday> {
  const list = await holidaysBetween(iso, addDays(iso, LOOKAHEAD_DAYS));
  if (!list.ok) return { ok: false, reason: list.reason };
  const date = nextWorkdayIn(iso, list.holidays);
  return date ? { ok: true, date } : { ok: false, reason: "none" };
}

/** What the upload page says when the next workday cannot be known. */
export const HOLIDAYS_UNAVAILABLE = "ตรวจวันหยุดจากธนาคารแห่งประเทศไทยไม่ได้ ลองใหม่อีกครั้ง";
