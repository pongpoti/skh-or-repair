import { isWorkday, type Holiday } from "./holidays.ts";
import type { RepairPeriods } from "./repair.ts";
import { processSheet, type FlowOptions, type FlowSummary } from "./upload-flow.ts";
import type { PlacedCase } from "./workbook-store.ts";
import { cleanText, isBookedAhead, parseExport } from "./workbook.ts";
import type { XlsxCell, XlsxLimits } from "./xlsx.ts";

/**
 * Past days' lists from one HOSxP export of many days, for the board's calendar (Pong, 19 Nov 2026: "No case shown on
 * Jan, why ?", then yes to loading the Jan-Oct exports). Each past workday in the file gets the list MX's daily upload
 * would have given it: the rows booked for that day (W) and keyed in before 16:00 the day before (lib/workbook.ts
 * isBookedAhead, the upload's closing time), through MX's own pipeline (lib/upload-flow.ts processSheet: the filter,
 * the cuts, the rooms). No database, clock or network: app/admin/actions.ts reads the file, gives the day and the
 * holidays, and saves the lists (lib/workbook-store.ts savePastLists). Nothing here is ever logged.
 */

/**
 * An export of many days is far bigger than a day's list: Jan-Aug 2026 has 13,220 rows, 20 MB unpacked. The file
 * itself still has to fit lib/xlsx.ts's 4 MB (a server action takes 4.25 MB), so ten months go in more than one file.
 */
export const PAST_LIMITS: Partial<XlsxLimits> = { maxRows: 30_000, maxTotalBytes: 60 * 1024 * 1024 };

type Sheet = { rows: readonly (readonly XlsxCell[])[]; date1904: boolean };

/** One booked date of the file before today: its rows keyed in ahead (the header first), and how many rows it has in all. */
export type FileDay = { date: string; sheet: Sheet; fileRows: number };

export type SplitDays =
  | { ok: false; message: string }
  | {
      ok: true;
      /** Booked dates before today, in date order. */
      days: FileDay[];
      /** Rows the board never shows: booked for today or later, or with no readable booked date. */
      skipped: { later: number; noDate: number };
    };

/**
 * The file's rows by booked date (W), only dates before `today` (Bangkok, YYYY-MM-DD), each date keeping the rows
 * keyed in before 16:00 the day before. A date whose rows were all keyed in later still comes back, with no row: its
 * list is empty. Refused only when the headers are not the export's.
 */
export function splitByDay(sheet: Sheet, today: string): SplitDays {
  const parsed = parseExport(sheet.rows, { date1904: sheet.date1904 });
  if (!parsed.ok) return { ok: false, message: parsed.message };
  // The header is the first row that is not blank, as parseExport finds it.
  const header = sheet.rows.find((row) => row.some((cell) => cleanText(cell) !== "")) ?? [];
  const byDate = new Map<string, { rows: (readonly XlsxCell[])[]; fileRows: number }>();
  let later = 0;
  let noDate = 0;
  for (const row of parsed.rows) {
    if (row.bookedDate === null) {
      noDate += 1;
      continue;
    }
    if (row.bookedDate >= today) {
      later += 1;
      continue;
    }
    const day = byDate.get(row.bookedDate) ?? { rows: [], fileRows: 0 };
    day.fileRows += 1;
    // WorkbookRow.line is the sheet row number (the header is 1).
    if (isBookedAhead(row)) day.rows.push(sheet.rows[row.line - 1]);
    byDate.set(row.bookedDate, day);
  }
  const days = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, day]) => ({ date, sheet: { rows: [header, ...day.rows], date1904: sheet.date1904 }, fileRows: day.fileRows }));
  return { ok: true, days, skipped: { later, noDate } };
}

/** One past workday's list, as an upload stores it. */
export type PastDay = { date: string; cases: PlacedCase[]; summary: FlowSummary };

export type PastLists = {
  days: PastDay[];
  /** Booked dates the board cannot show (weekends and holidays), with their rows. */
  offDays: { days: number; rows: number };
};

/** Each workday of `split` through MX's pipeline, placed under `periods` (the board places the cases again when read). */
export function pastLists(
  split: Extract<SplitDays, { ok: true }>,
  input: { holidays: readonly Holiday[]; periods: RepairPeriods; options?: FlowOptions },
): PastLists {
  const days: PastDay[] = [];
  const offDays = { days: 0, rows: 0 };
  for (const day of split.days) {
    if (!isWorkday(day.date, input.holidays)) {
      offDays.days += 1;
      offDays.rows += day.fileRows;
      continue;
    }
    // Every row is booked for this day and the header is the file's, so the pipeline cannot refuse it.
    const processed = processSheet(day.sheet, day.date, input.periods, input.options);
    if (processed.ok) days.push({ date: day.date, cases: processed.cases, summary: processed.summary });
  }
  return { days, offDays };
}
