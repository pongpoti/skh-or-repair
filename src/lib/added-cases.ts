import type { DeptCode } from "./allocation.ts";
import { addDays, thaiDate, workdayIndex } from "./days.ts";
import { isDressingOperation } from "./dressing.ts";
import { checkHn } from "./hn.ts";
import { holidayIn, nextWorkdayIn, type Holiday } from "./holidays.ts";
import { placeCase, roomsHeldBy } from "./placement.ts";
import { repairOn, type RepairPeriods } from "./repair.ts";
import { roomUse } from "./rooms.ts";
import type { Operation, Shift } from "./schedule.ts";
import { isSpecialtyCode } from "./specialties.ts";
import { subtypeLabel } from "./user-labels.ts";
import type { DayBoard } from "./week.ts";

export { addDays };

/**
 * Cases a doctor adds on the board: during the ventilation repair, bookings of a room for a patient (by HN), matched
 * with the HOSxP workbook's cases (lib/board-rows.ts). Checked the same way in the form and in the server action.
 * Isomorphic: no server-only imports. The database side is lib/cases.ts.
 *
 * A booking is an elective case (Pong, 15 Nov 2026): the doctor picks the day, the HN and the operation, and the app
 * picks the room, the doctor's department's room that day, or the dressing room for a dressing case.
 */

/** Longest operation name, in characters (the cases table checks the same). */
export const MAX_OPERATION = 300;
/** How far ahead a case can be added, in days from today. */
export const BOOK_AHEAD_DAYS = 60;
/** What a booking shows in place of the operation's name until the workbook gives it (bookings from before it was required). */
export const NO_OPERATION_LABEL = "จองห้อง (รอข้อมูล HOSxP)";
/**
 * From 15:00 MX uploads the next workday's HOSxP list (lib/board-day.ts), so bookings for that day close then and the
 * earliest day moves on by one workday.
 */
export const BOOKING_CUTOFF_MINUTES = 15 * 60;

export type CaseInput = {
  /** The operation's day in Thailand, YYYY-MM-DD. */
  date: string;
  /** The room the app picked (bookingRoom), never the doctor's. */
  roomId: string;
  /** The patient's HN, normalised (lib/hn.ts). Required for a new booking. */
  hn: string;
  /** The operation's name. Required for a new booking; "" only on bookings made before it was (stored as NULL). */
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

/** The form field an error is about, for the form to mark and focus; none for a room the department does not have. */
export type CaseField = "date" | "hn" | "operation" | "shift";

/** `earliest` is set when the day was refused for being too soon, so the form can move its calendar on. */
export type CheckedCase =
  | { ok: true; value: CaseInput; dressing: boolean }
  | { ok: false; error: string; field?: CaseField; earliest?: string };

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

/** The first workday after `iso`, by `holidays`; should they leave none within two weeks, the next weekday. */
function workdayAfter(iso: string, holidays: readonly Holiday[]): string {
  const day = nextWorkdayIn(iso, holidays);
  if (day) return day;
  let weekday = addDays(iso, 1);
  while (workdayIndex(weekday) === null) weekday = addDays(weekday, 1);
  return weekday;
}

/**
 * The first day a doctor can book, at `minutes` past midnight on `today` in Bangkok (Pong, 15 Nov 2026): before 15:00
 * the next workday (tomorrow, or past the weekend and any holiday); from 15:00, when MX is uploading that day's HOSxP
 * list, the workday after it. Monday 14:00 gives Tuesday, Monday 15:30 Wednesday, Friday 15:30 Tuesday.
 */
export function earliestBookingDay(today: string, minutes: number, holidays: readonly Holiday[] = []): string {
  const next = workdayAfter(today, holidays);
  return minutes >= BOOKING_CUTOFF_MINUTES ? workdayAfter(next, holidays) : next;
}

/**
 * What the form says about the earliest day, and the error for a day before it: "from 15:00" when the cut-off moved it
 * past the next workday.
 */
export function earliestText(today: string, earliest: string, holidays: readonly Holiday[]): string {
  const closed = earliest > workdayAfter(today, holidays);
  return `${closed ? "หลัง 15:00 น. ปิดรับจองวันทำการถัดไป · " : ""}จองได้ตั้งแต่ ${thaiDate(earliest, "short")}`;
}

/** Why a day cannot be booked in the calendar, or null when it can (the earliest day and the 60 days aside). */
export function closedDayNote(iso: string, holidays: readonly Holiday[]): string | null {
  if (workdayIndex(iso) === null) return "วันเสาร์-อาทิตย์";
  return holidayIn(holidays, iso)?.name ?? null;
}

export type BookingRoom = { ok: true; roomId: string; dressing: boolean } | { ok: false; error: string };

const NO_ROOM_TEXT = {
  "obgyn-building": "ช่วงปิดซ่อม สูติ-นรีเวชกรรมผ่าตัดที่อาคารแม่ จองห้องที่นี่ไม่ได้",
  "no-department": "ยังไม่ทราบสาขาของคุณ จึงจัดห้องให้ไม่ได้ ติดต่อผู้ดูแลระบบ",
  "no-room": "สาขาของคุณไม่มีห้องผ่าตัดในวันที่เลือก เลือกวันอื่น",
} as const;

/**
 * The department a doctor's bookings go to: their specialty (the codes the admin list gives doctors), or SCOPE, which
 * the workbook's placement sends to general surgery. Any other subtype (an anaesthetist's, or a room code such as EMER
 * that is not a department) has no room of its own and goes to the mixed-department room, so an elective booking never
 * takes the emergency or dressing room by its subtype; no subtype at all cannot be placed.
 */
function bookingDept(subtype: string | null | undefined): DeptCode | null {
  if (typeof subtype !== "string" || !subtype.trim()) return null;
  return isSpecialtyCode(subtype) || subtype === "SCOPE" ? subtype : "MIXED";
}

/**
 * The room a booking goes to on `date`: the doctor's department's room that day, as the HOSxP workbook's elective
 * cases are placed (lib/placement.ts placeCase; during the repair a department without a room of its own uses the
 * mixed-department room, and obstetrics-gynaecology operates in its own building), and the dressing room for a
 * dressing case. A dressing case is any operation whose name holds one of Pong's dressing words, typos forgiven, and no
 * graft (lib/dressing.ts), the rule the workbook's cases use too; lib/board-rows.ts says which room a matched pair
 * shows in when the booking's name and HOSxP's differ.
 */
export function bookingRoom(subtype: string | null | undefined, operation: string, date: string, periods: RepairPeriods): BookingRoom {
  const dept = bookingDept(subtype);
  const dressingRooms = roomsHeldBy("INFECT", date, periods);
  // Obstetrics-gynaecology during the repair is refused before anything else, as placeCase does.
  const obgynAway = dept === "OBGYN" && repairOn(date, periods) !== null;
  if (!obgynAway && isDressingOperation(operation) && dressingRooms.length > 0) return { ok: true, roomId: dressingRooms[0], dressing: true };
  const placed = placeCase({ procedure: operation, dept, emergency: false, team: dept }, date, periods, new Map());
  if (!placed.ok) return { ok: false, error: NO_ROOM_TEXT[placed.reason] };
  return { ok: true, roomId: placed.roomId, dressing: dressingRooms.includes(placed.roomId) };
}

/**
 * Where a saved booking is now. The app picks a booking's room, so it is picked again whenever it is read, like the
 * workbook's cases: an admin may move the repair's dates, or correct the doctor's department, after the booking was
 * made. The room saved with the booking counts only when no room can be picked now (it was made before the room was
 * arranged, or the doctor's department has none that day).
 */
export function bookedRoom(booking: Pick<AddedCase, "subtype" | "operation" | "date" | "roomId">, periods: RepairPeriods): { roomId: string; dressing: boolean } {
  const room = bookingRoom(booking.subtype, booking.operation ?? "", booking.date, periods);
  return room.ok ? { roomId: room.roomId, dressing: room.dressing } : { roomId: booking.roomId, dressing: false };
}

/** What checking a booking needs to know besides the form's fields. */
export type BookingContext = {
  /** Today in Thailand, YYYY-MM-DD. */
  today: string;
  /** The first day that can be booked (earliestBookingDay), by the server's clock: the form gets it from the page. */
  earliest: string;
  periods: RepairPeriods;
  /** The doctor's subtype code (users.subtype), which picks the room. */
  subtype: string | null;
  /** The Bank of Thailand's holidays and EXTRA_HOLIDAYS, from today to 60 days ahead. */
  holidays: readonly Holiday[];
};

/**
 * Checks a new booking ({ date, hn, operation, shift }) and picks its room. The server action and the form run the
 * same checks with the same holidays (the page passes them to the form); the server's answer is the one that counts.
 */
export function checkCase(input: unknown, context: BookingContext): CheckedCase {
  const { today, earliest, periods, subtype, holidays } = context;
  const raw = (input ?? {}) as Record<string, unknown>;
  const refuse = (field: CaseField | undefined, error: string, more: { earliest?: string } = {}): CheckedCase => ({ ok: false, error, field, ...more });
  const date = raw.date;
  if (!isIsoDate(date)) return refuse("date", "เลือกวันที่ผ่าตัด");
  if (date < earliest) return refuse("date", earliestText(today, earliest, holidays), { earliest });
  if (date > addDays(today, BOOK_AHEAD_DAYS)) return refuse("date", `จองล่วงหน้าได้ไม่เกิน ${BOOK_AHEAD_DAYS} วัน`);
  if (workdayIndex(date) === null) return refuse("date", "วันเสาร์และอาทิตย์ไม่มีตารางผ่าตัด");
  const holiday = holidayIn(holidays, date);
  if (holiday) return refuse("date", `วันที่เลือกเป็นวันหยุด (${holiday.name}) ไม่มีตารางผ่าตัด`);

  const hn = checkHn(raw.hn);
  if (!hn.ok) return refuse("hn", hn.error);

  if (raw.operation !== undefined && raw.operation !== null && typeof raw.operation !== "string") {
    return refuse("operation", "ชื่อการผ่าตัดไม่ถูกต้อง");
  }
  const operation = cleanOperation(typeof raw.operation === "string" ? raw.operation : "");
  if (!operation) return refuse("operation", "ใส่ชื่อการผ่าตัด");
  if (operation.length > MAX_OPERATION) return refuse("operation", `ชื่อการผ่าตัดยาวเกิน ${MAX_OPERATION} ตัวอักษร`);

  const shift = raw.shift ?? "in";
  if (shift !== "in" && shift !== "out") return refuse("shift", "เลือกในเวลาหรือนอกเวลา");

  const room = bookingRoom(subtype, operation, date, periods);
  // No room on a day the department has none: another day may have one.
  if (!room.ok) return refuse(room.error === NO_ROOM_TEXT["no-room"] ? "date" : undefined, room.error);
  return { ok: true, value: { date, roomId: room.roomId, hn: hn.hn, operation, shift }, dressing: room.dressing };
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
