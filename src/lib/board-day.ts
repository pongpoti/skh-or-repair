import { addDays, bangkokParts, workdayIndex } from "./days.ts";
import { holidaysBetween, LOOKAHEAD_DAYS, nextWorkdayAfter, nextWorkdayIn, type Holiday, type NextWorkday } from "./holidays.ts";

/**
 * Which day the board shows, and when MX may upload (Bangkok time, UTC+7). The suite's day turns over at 16:00, not at
 * midnight: from 16:00 the board shows the next workday's list, which MX uploads between 15:00 and 16:00.
 *
 * - cycleDay: today from 16:00, otherwise yesterday.
 * - boardDate: the first workday after cycleDay. So on a workday before 16:00 the board shows today, and from 16:00
 *   the next workday (the 16:00 "clear"); at the weekend and on holidays it already shows the next workday.
 * - The board's workbook is the latest upload made on cycleDay for boardDate (lib/workbook-store.ts): an upload's
 *   cycle_day is the Bangkok date it was made, its target the first workday after that date.
 *
 * The functions take the moment and the holidays as arguments, so they are pure and testable at any time; the async
 * ones fetch the holidays (call them on the server with lib/clock.ts now()).
 */

/** The board turns over at 16:00. */
export const TURNOVER_MINUTES = 16 * 60;
/** MX may upload from 15:00:00 up to, not including, 16:00:00, every day (holidays too). */
export const UPLOAD_OPENS_MINUTES = 15 * 60;
export const UPLOAD_CLOSES_MINUTES = 16 * 60;

/** The cycle a moment belongs to: its Bangkok date from 16:00 on, the day before until then. */
export function cycleDayOf(at: Date): string {
  const { date, minutes } = bangkokParts(at);
  return minutes >= TURNOVER_MINUTES ? date : addDays(date, -1);
}

/**
 * The day the board shows for a cycle: the first workday after it. Should `holidays` leave no workday within two weeks
 * (they never do), the next weekday stands in, so the board always has a date.
 */
export function boardDateOf(cycleDay: string, holidays: readonly Holiday[]): string {
  const day = nextWorkdayIn(cycleDay, holidays, LOOKAHEAD_DAYS);
  if (day) return day;
  let weekday = addDays(cycleDay, 1);
  while (workdayIndex(weekday) === null) weekday = addDays(weekday, 1);
  return weekday;
}

/** How the board's date stands to today, for the top bar's eyebrow. */
export type BoardDayRelation = "today" | "tomorrow" | "later";

export type BoardDay = {
  /** The Bangkok date of the moment. */
  today: string;
  /** Minutes since Bangkok midnight. */
  minutes: number;
  cycleDay: string;
  boardDate: string;
  relation: BoardDayRelation;
};

/** The board's day at a moment, with the holidays known. */
export function boardDayAt(at: Date, holidays: readonly Holiday[]): BoardDay {
  const { date: today, minutes } = bangkokParts(at);
  const cycleDay = cycleDayOf(at);
  const boardDate = boardDateOf(cycleDay, holidays);
  const relation = boardDate === today ? "today" : boardDate === addDays(today, 1) ? "tomorrow" : "later";
  return { today, minutes, cycleDay, boardDate, relation };
}

/** The top bar's line above the date. */
export function boardEyebrow(relation: BoardDayRelation): string {
  return relation === "today" ? "ตารางผ่าตัดวันนี้" : relation === "tomorrow" ? "ตารางผ่าตัดพรุ่งนี้" : "ตารางผ่าตัด";
}

/** Inside MX's upload window: Bangkok 15:00:00 ≤ t < 16:00:00, every day. Admins may upload at any time. */
export function inUploadWindow(at: Date): boolean {
  const { minutes } = bangkokParts(at);
  return minutes >= UPLOAD_OPENS_MINUTES && minutes < UPLOAD_CLOSES_MINUTES;
}

/**
 * The next moment the board changes by itself: 16:00 or midnight in Bangkok, whichever comes first after `at`. The
 * board page sets its refresh timer by it.
 */
export function nextBoardRefresh(at: Date): Date {
  const { date, minutes } = bangkokParts(at);
  const [y, m, d] = date.split("-").map(Number);
  // Bangkok midnight of `date` in UTC is 17:00 the day before.
  const midnight = Date.UTC(y, m - 1, d) - 7 * 60 * 60 * 1000;
  const next = minutes < TURNOVER_MINUTES ? midnight + TURNOVER_MINUTES * 60_000 : midnight + 24 * 60 * 60_000;
  return new Date(next);
}

/** The board's day with its holidays; `holidaysOk` is false when the BOT feed failed and weekdays stood in. */
export type LoadedBoardDay = BoardDay & { holidays: Holiday[]; holidaysOk: boolean };

/**
 * The board's day at `at` (lib/clock.ts now()), with the holidays from EXTRA_HOLIDAYS and the BOT feed. When the feed
 * fails the board keeps going on weekdays and EXTRA_HOLIDAYS (only the upload is blocked then).
 */
export async function loadBoardDay(at: Date): Promise<LoadedBoardDay> {
  const cycleDay = cycleDayOf(at);
  const list = await holidaysBetween(cycleDay, addDays(cycleDay, LOOKAHEAD_DAYS));
  return { ...boardDayAt(at, list.holidays), holidays: list.holidays, holidaysOk: list.ok };
}

/** What an upload at `at` would be: its cycle day, its target day (or why there is none), and whether MX may upload. */
export type UploadSlot = {
  /** The Bangkok date of the upload: the upload's cycle_day. */
  cycleDay: string;
  /** The first workday after cycleDay, from the BOT feed; not ok when the feed failed (the upload is refused). */
  target: NextWorkday;
  /** Inside the 15:00–16:00 window. */
  windowOpen: boolean;
};

/** The upload slot at `at` (lib/clock.ts now()). */
export async function loadUploadSlot(at: Date): Promise<UploadSlot> {
  const { date } = bangkokParts(at);
  return { cycleDay: date, target: await nextWorkdayAfter(date), windowOpen: inUploadWindow(at) };
}
