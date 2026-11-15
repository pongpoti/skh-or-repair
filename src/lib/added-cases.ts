import { allocationFor } from "./allocation.ts";
import { addDays, workdayIndex } from "./days.ts";
import { checkHn } from "./hn.ts";
import { holidayIn, type Holiday } from "./holidays.ts";
import type { RepairPeriods } from "./repair.ts";
import { openRooms, roomUse } from "./rooms.ts";
import type { Operation, Shift } from "./schedule.ts";
import { subtypeLabel } from "./user-labels.ts";
import type { DayBoard } from "./week.ts";

export { addDays };

/**
 * Cases a doctor adds on the board: during the ventilation repair, bookings of a room for a patient (by HN), matched
 * with the HOSxP workbook's cases (lib/board-rows.ts). Checked the same way in the form and in the server action.
 * Isomorphic: no server-only imports. The database side is lib/cases.ts.
 */

/** Longest operation name, in characters (the cases table checks the same). */
export const MAX_OPERATION = 300;
/** How far ahead a case can be added, in days from today. */
export const BOOK_AHEAD_DAYS = 60;
/** What a booking shows in place of the operation's name until the workbook gives it. */
export const NO_OPERATION_LABEL = "จองห้อง (รอข้อมูล HOSxP)";

export type CaseInput = {
  /** The operation's day in Thailand, YYYY-MM-DD. */
  date: string;
  roomId: string;
  /** The patient's HN, normalised (lib/hn.ts). Required for a new booking. */
  hn: string;
  /** The operation's name, or "" when the doctor left it for the workbook to give (stored as NULL). */
  operation: string;
  shift: Shift;
};

/** A case from the cases table, as the board and the form show it. */
export type AddedCase = Omit<CaseInput, "hn"> & {
  id: string;
  /** The patient's HN (normalised), or null for a case saved before bookings carried one. */
  hn: string | null;
  /** users.id of the surgeon, who alone sees the HN of their bookings (besides MX and admins). */
  surgeonId: string;
  /** The surgeon (the doctor who added it), "ชื่อ นามสกุล". */
  surgeon: string;
  /** The surgeon's subtype code (users.subtype), e.g. ORTHO. */
  subtype: string | null;
};

export type CheckedCase = { ok: true; value: CaseInput } | { ok: false; error: string };

function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** One line, NFC, no invisible format characters, single spaces. */
export function cleanOperation(v: string): string {
  return v.normalize("NFC").replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim();
}

/** The first weekday (Monday to Friday) on or after `iso`. Holidays are not known here; the server checks them. */
export function nextWorkday(iso: string): string {
  let day = iso;
  while (workdayIndex(day) === null) day = addDays(day, 1);
  return day;
}

/**
 * The day the booking form opens on: the board's own day (today until 16:00, then the next workday, both by the Bank
 * of Thailand's holidays, lib/board-day.ts), so after 16:00 on the eve of a holiday the form starts past it, as the
 * board does. With no board (the preview of a closed day), the next weekday after today.
 */
export function firstBookingDay(boardDate: string | null, today: string): string {
  return boardDate ?? nextWorkday(addDays(today, 1));
}

/**
 * Checks a new booking against today's date in Thailand (YYYY-MM-DD) and the repair `periods` (only a room open on
 * that day can be booked). `holidays` are the Bank of Thailand's and EXTRA_HOLIDAYS when the caller has them (the
 * server action); the form, which has none, checks weekdays only and leaves holidays to the server.
 */
export function checkCase(input: unknown, today: string, periods: RepairPeriods, holidays: readonly Holiday[] = []): CheckedCase {
  const raw = (input ?? {}) as Record<string, unknown>;
  const date = raw.date;
  if (!isIsoDate(date)) return { ok: false, error: "เลือกวันที่ผ่าตัด" };
  if (date < today) return { ok: false, error: "เลือกวันนี้หรือวันถัดไป" };
  if (date > addDays(today, BOOK_AHEAD_DAYS)) return { ok: false, error: `จองล่วงหน้าได้ไม่เกิน ${BOOK_AHEAD_DAYS} วัน` };
  if (workdayIndex(date) === null) return { ok: false, error: "วันเสาร์และอาทิตย์ไม่มีตารางผ่าตัด" };
  const holiday = holidayIn(holidays, date);
  if (holiday) return { ok: false, error: `วันที่เลือกเป็นวันหยุด (${holiday.name}) ไม่มีตารางผ่าตัด` };

  const roomId = raw.roomId;
  if (typeof roomId !== "string" || !roomId) return { ok: false, error: "เลือกห้องผ่าตัด" };
  const use = roomUse(roomId, date, periods);
  if (use === "recovery") return { ok: false, error: "ห้องนี้ใช้เป็นห้องพักฟื้นในวันที่เลือก เลือกห้องอื่น" };
  if (use === "instrument") return { ok: false, error: "ห้องนี้ใช้เก็บเครื่องมือในวันที่เลือก เลือกห้องอื่น" };
  if (use !== "open") return { ok: false, error: "ห้องนี้ปิดในวันที่เลือก เลือกห้องอื่น" };

  const hn = checkHn(raw.hn);
  if (!hn.ok) return hn;

  // The operation's name is optional (the workbook names it), but must be text when given.
  if (raw.operation !== undefined && raw.operation !== null && typeof raw.operation !== "string") {
    return { ok: false, error: "ชื่อการผ่าตัดไม่ถูกต้อง" };
  }
  const operation = cleanOperation(typeof raw.operation === "string" ? raw.operation : "");
  if (operation.length > MAX_OPERATION) return { ok: false, error: `ชื่อการผ่าตัดยาวเกิน ${MAX_OPERATION} ตัวอักษร` };

  const shift = raw.shift ?? "in";
  if (shift !== "in" && shift !== "out") return { ok: false, error: "เลือกในเวลาหรือนอกเวลา" };

  return { ok: true, value: { date, roomId, hn: hn.hn, operation, shift } };
}

/**
 * The open room the doctor's department holds on `date` (morning or afternoon). During the ventilation repair a
 * department with no room of its own gets the first mixed-department room. Null when there is neither.
 */
export function roomForSubtype(subtype: string | null | undefined, date: string, periods: RepairPeriods): string | null {
  if (!subtype) return null;
  let mixed: string | null = null;
  for (const room of openRooms(date, periods)) {
    const allocation = allocationFor(room.id, date, periods);
    if (allocation?.am?.code === subtype || allocation?.pm?.code === subtype) return room.id;
    if (!mixed && allocation?.am?.code === "MIXED") mixed = room.id;
  }
  return mixed;
}

/**
 * The board with the doctors' added cases for its day after the imported ones in each room, in the order they were
 * added. Cases in a room that is not in use for operations that day (closed, or a recovery or instrument room during
 * the repair) are left off.
 */
export function withAddedCases(board: DayBoard, added: readonly AddedCase[], periods: RepairPeriods): DayBoard {
  const order = new Map<string, number>();
  for (const item of board.operations) order.set(item.roomId, Math.max(order.get(item.roomId) ?? 0, item.order));

  const operations: Operation[] = [...board.operations];
  for (const item of added) {
    if (item.date !== board.date || roomUse(item.roomId, board.date, periods) !== "open") continue;
    const slot = (order.get(item.roomId) ?? 0) + 1;
    order.set(item.roomId, slot);
    operations.push({
      id: `case-${item.id}`,
      roomId: item.roomId,
      order: slot,
      procedure: item.operation || NO_OPERATION_LABEL,
      surgeon: item.surgeon,
      specialty: subtypeLabel("DR", item.subtype),
      status: "scheduled",
      shift: item.shift,
    });
  }
  return { ...board, operations };
}
