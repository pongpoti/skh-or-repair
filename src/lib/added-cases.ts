import type { DeptCode } from "./allocation.ts";
import { addDays, thaiDate, workdayIndex } from "./days.ts";
import { checkHn } from "./hn.ts";
import { holidayIn, nextWorkdayIn, type Holiday } from "./holidays.ts";
import { placeCase, roomsHeldBy, type RoomChoice } from "./placement.ts";
import { REPAIR_LAYOUTS, repairOn, type RepairPeriods } from "./repair.ts";
import { getRoom, roomLabel, roomUse } from "./rooms.ts";
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
 * A booking is an elective case (Pong, 15 Nov 2026): the doctor picks the day, the HN, the operation, and one of two
 * rooms, their department's room that day (OR X) or the dressing room (ห้องทำแผล); the app works out which room each
 * of those is. For the dressing room the doctor also says whether the scrub nurse does the dressing for them. The
 * operation's name never decides a booking's room (Pong: "let surgeon decide which room to use"); it places only the
 * HOSxP workbook's cases nobody booked (lib/dressing.ts).
 */

/** Longest operation name, in characters (the cases table checks the same). */
export const MAX_OPERATION = 300;
/** Longest note (หมายเหตุ), in characters (the cases table checks the same). */
export const MAX_NOTE = 500;
/** How far ahead a case can be added, in days from today. */
export const BOOK_AHEAD_DAYS = 60;
/** What a booking shows in place of the operation's name until the workbook gives it (bookings from before it was required). */
export const NO_OPERATION_LABEL = "จองห้อง (รอข้อมูล HOSxP)";
/**
 * From 15:00 MX uploads the next workday's HOSxP list (lib/board-day.ts), so bookings for that day close then and the
 * earliest day moves on by one workday.
 */
export const BOOKING_CUTOFF_MINUTES = 15 * 60;

/** The doctor's choice of room: their department's room that day, or the dressing room (ห้องทำแผล). */
export type { RoomChoice };

/** What the dressing room is called in the form and on the board. */
export const DRESSING_ROOM_NAME = "ห้องทำแผล";
/** Asked when the doctor picks the dressing room (Pong, 15 Nov 2026), with its two answers. */
export const SCRUB_QUESTION = "scrub ทำให้แทนไหม ?";
export const SCRUB_YES = "ใช่ ฝากทำ";
export const SCRUB_NO = "ไม่ แพทย์ทำเอง";
/** The answer as a tag, on the board's row and in the doctor's own list. */
export function scrubTag(scrubDoes: boolean): string {
  return scrubDoes ? "ฝาก scrub ทำ" : "แพทย์ทำเอง";
}

export type CaseInput = {
  /** The operation's day in Thailand, YYYY-MM-DD. */
  date: string;
  /** The room the doctor's choice gives that day (bookingRoom), worked out by the app, never sent by the form. */
  roomId: string;
  /** The patient's HN, normalised (lib/hn.ts). Required for a new booking. */
  hn: string;
  /** The operation's name. Required for a new booking; "" only on bookings made before it was (stored as NULL). */
  operation: string;
  shift: Shift;
  /** The doctor picked the dressing room rather than their department's room. */
  dressing: boolean;
  /**
   * For a dressing-room booking, the doctor's answer to SCRUB_QUESTION: true for ใช่ ฝากทำ (the scrub nurse does the
   * dressing), false for ไม่ แพทย์ทำเอง (the doctor does); null for a department-room booking.
   */
  scrubDoes: boolean | null;
  /**
   * The doctor's note to the OR team (หมายเหตุ; Pong, 17 Nov 2026), cleaned by cleanNote: "" when there is none (stored
   * as NULL). Everyone who opens the board sees it on the booking's row (lib/board-rows.ts).
   */
  note: string;
};

/** A case from the cases table, as the board and the form show it. */
export type AddedCase = Omit<CaseInput, "hn" | "dressing"> & {
  /**
   * The doctor picked the dressing room (true) or their department's room (false); null for a booking made before the
   * form asked, whose saved room says which (bookedRoom).
   */
  dressing: boolean | null;
  id: string;
  /** The patient's HN (normalised), or null for a case saved before bookings carried one. */
  hn: string | null;
  /** users.id of the surgeon, who alone sees the HN of their bookings (besides MX and admins). */
  surgeonId: string;
  /** The surgeon (the doctor who added it), "ชื่อ นามสกุล". */
  surgeon: string;
  /** The surgeon's subtype code (users.subtype), e.g. ORTHO. */
  subtype: string | null;
  /** When the doctor made the booking (cases.created_at), an ISO time; left out by the made-up previews. */
  bookedAt?: string;
};

const BOOKED_AT = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "short",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * When a booking was made, as the case row says it (Pong, 15 Nov 2026: "วันเวลาที่จองคิว : 00 มค 66, 44:44"): "15 พ.ย. 69,
 * 23:43", in Bangkok time with the Buddhist year. Empty for a time that cannot be read.
 */
export function bookedAtText(iso: string): string {
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return "";
  const part = Object.fromEntries(BOOKED_AT.formatToParts(time).map((item) => [item.type, item.value]));
  return `${part.day} ${part.month} ${part.year}, ${part.hour}:${part.minute}`;
}

/** The form field an error is about, for the form to mark and focus. */
export type CaseField = "date" | "hn" | "operation" | "room" | "shift" | "note";

/** `earliest` is set when the day was refused for being too soon, so the form can move its calendar on. */
export type CheckedCase =
  | { ok: true; value: CaseInput }
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

/**
 * A note as it is saved: NFC, no invisible format or control characters, the doctor's line breaks kept (at most one
 * blank line in a row, none at either end), and single spaces within each line, which is trimmed.
 */
export function cleanNote(v: string): string {
  return v
    .normalize("NFC")
    .replace(/\r\n?|[\u2028\u2029]/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]|\p{Cf}/gu, "")
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
 * The 15:00 rule as the booking form states it, under the date (Pong's words, 15 Nov 2026), in its phrases: the form
 * breaks a line only between them, so a word such as ถัดไป is never split.
 */
export const BOOKING_CUTOFF_PHRASES = ["หลังเวลา 15.00 น.", "ระบบจะปิดรับการจอง", "ของวันทำการถัดไป"] as const;
export const BOOKING_CUTOFF_RULE = BOOKING_CUTOFF_PHRASES.join(" ");

/** The first day that can be booked, as the form says it. */
export function bookableFrom(earliest: string): string {
  return `จองได้ตั้งแต่ ${thaiDate(earliest, "short")}`;
}

/**
 * The error for a day before the earliest: the 15:00 rule as well when the cut-off moved the earliest day past the next
 * workday.
 */
export function earliestText(today: string, earliest: string, holidays: readonly Holiday[]): string {
  const closed = earliest > workdayAfter(today, holidays);
  return `${closed ? `${BOOKING_CUTOFF_RULE} · ` : ""}${bookableFrom(earliest)}`;
}

/** Why a day cannot be booked in the calendar, or null when it can (the earliest day and the 60 days aside). */
export function closedDayNote(iso: string, holidays: readonly Holiday[]): string | null {
  if (workdayIndex(iso) === null) return "วันเสาร์-อาทิตย์";
  return holidayIn(holidays, iso)?.name ?? null;
}

/** Why a booking has no room: the keys of NO_ROOM_TEXT. */
export type NoRoomReason = keyof typeof NO_ROOM_TEXT;

export type BookingRoom = { ok: true; roomId: string; dressing: boolean } | { ok: false; reason: NoRoomReason; error: string };

const NO_ROOM_TEXT = {
  "obgyn-building": "ช่วงปิดซ่อม สูติ-นรีเวชกรรมผ่าตัดที่อาคารแม่ จองห้องที่นี่ไม่ได้",
  "no-department": "ยังไม่ทราบสาขาของคุณ จึงจัดห้องให้ไม่ได้ ติดต่อผู้ดูแลระบบ",
  "no-room": "สาขาของคุณไม่มีห้องผ่าตัดในวันที่เลือก เลือกวันอื่น",
  "no-dressing-room": "ไม่มีห้องทำแผลในวันที่เลือก เลือกวันอื่น",
} as const;

/** What a room card the doctor cannot pick says under its name, by the reason (the full reason is under the cards). */
export const NO_ROOM_NOTE: Readonly<Record<NoRoomReason, string>> = {
  "obgyn-building": "ผ่าตัดที่อาคารแม่",
  "no-department": "ไม่ทราบสาขา",
  "no-room": "ไม่มีในวันที่เลือก",
  "no-dressing-room": "ไม่มีในวันที่เลือก",
};

const noRoom = (reason: NoRoomReason): BookingRoom => ({ ok: false, reason, error: NO_ROOM_TEXT[reason] });

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
 * The room a booking goes to on `date` for the doctor's choice. "dept": the doctor's department's room that day, as the
 * HOSxP workbook's elective cases are placed (lib/placement.ts placeCase, never the dressing room whatever the
 * operation's name; during the repair a department without a room of its own uses the mixed-department room). "dressing":
 * the dressing room that day. Obstetrics-gynaecology during the repair is refused either way: it operates in its own
 * building. lib/board-rows.ts says which room a matched pair shows in.
 */
export function bookingRoom(subtype: string | null | undefined, operation: string, date: string, periods: RepairPeriods, choice: RoomChoice): BookingRoom {
  const dept = bookingDept(subtype);
  if (dept === "OBGYN" && repairOn(date, periods) !== null) return noRoom("obgyn-building");
  if (choice === "dressing") {
    const rooms = roomsHeldBy("INFECT", date, periods);
    return rooms.length > 0 ? { ok: true, roomId: rooms[0], dressing: true } : noRoom("no-dressing-room");
  }
  const placed = placeCase({ procedure: operation, dept, emergency: false, team: dept, choice: "dept" }, date, periods, new Map());
  if (!placed.ok) return noRoom(placed.reason);
  return { ok: true, roomId: placed.roomId, dressing: false };
}

/**
 * The rooms that are the dressing room under some layout: OR 1 in the weekly schedule (lib/allocation.ts) and the
 * dressing room of each half of the repair.
 */
const DRESSING_ROOMS_ANY: ReadonlySet<string> = new Set([
  "or-1",
  ...Object.values(REPAIR_LAYOUTS).flatMap((layout) =>
    Object.entries(layout.rooms)
      .filter(([, code]) => code === "INFECT")
      .map(([roomId]) => roomId),
  ),
]);

/**
 * The doctor's choice for a saved booking. One made before the form asked counts as a dressing-room booking when it was
 * saved in the dressing room of its day (the doctor picked it from the rooms). An admin may have moved the repair's dates
 * since, so a saved room that is closed on its day now still counts when it is a dressing room under some layout (OR 10
 * in the first half, OR 1 otherwise).
 */
export function bookedChoice(booking: Pick<AddedCase, "dressing" | "date" | "roomId">, periods: RepairPeriods): RoomChoice {
  if (typeof booking.dressing === "boolean") return booking.dressing ? "dressing" : "dept";
  const { date, roomId } = booking;
  const dressing =
    roomsHeldBy("INFECT", date, periods).includes(roomId) || (roomUse(roomId, date, periods) !== "open" && DRESSING_ROOMS_ANY.has(roomId));
  return dressing ? "dressing" : "dept";
}

/**
 * Where a saved booking is now. The app works out the room for the doctor's choice, so it is worked out again whenever
 * it is read, like the workbook's cases: an admin may move the repair's dates, or correct the doctor's department,
 * after the booking was made. The room saved with the booking counts only when no room can be worked out now (the
 * doctor's department has none that day).
 */
export function bookedRoom(
  booking: Pick<AddedCase, "subtype" | "operation" | "date" | "roomId" | "dressing">,
  periods: RepairPeriods,
): { roomId: string; dressing: boolean } {
  const choice = bookedChoice(booking, periods);
  const room = bookingRoom(booking.subtype, booking.operation ?? "", booking.date, periods, choice);
  return room.ok ? { roomId: room.roomId, dressing: room.dressing } : { roomId: booking.roomId, dressing: choice === "dressing" };
}

/**
 * What the form says once a booking is saved, simply the room and the day (Pong, 15 Nov 2026: "simply state จอง OR XX
 * วันอังคารที่ … แล้ว"): "จอง OR 10 วันอังคารที่ 17 พ.ย. 2569 แล้ว", for the dressing room too.
 */
export function bookedMessage(value: Pick<CaseInput, "roomId" | "date">): string {
  const room = getRoom(value.roomId);
  return `จอง ${room ? roomLabel(room) : value.roomId} ${thaiDate(value.date, "short")} แล้ว`;
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
  /** The Bank of Thailand's holidays, HOSPITAL_HOLIDAYS and EXTRA_HOLIDAYS, from today to 60 days ahead. */
  holidays: readonly Holiday[];
};

/**
 * Checks a new booking ({ date, hn, operation, shift, room, scrubDoes, note }) and works out its room. `room` is the
 * doctor's choice, "dept" (the default) or "dressing"; a dressing-room booking needs `scrubDoes`, the answer to
 * SCRUB_QUESTION. `note` is optional (cleanNote, at most MAX_NOTE characters).
 * The server action and the form run the same checks with the same holidays (the page passes them to the form); the
 * server's answer is the one that counts.
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

  const choice = raw.room ?? "dept";
  if (choice !== "dept" && choice !== "dressing") return refuse("room", "เลือกห้องผ่าตัด");
  let scrubDoes: boolean | null = null;
  if (choice === "dressing") {
    if (typeof raw.scrubDoes !== "boolean") return refuse("room", `ห้องทำแผล: ตอบก่อนว่า ${SCRUB_QUESTION}`);
    scrubDoes = raw.scrubDoes;
  }
  const room = bookingRoom(subtype, operation, date, periods, choice);
  // No room that day: another day may have one.
  if (!room.ok) return refuse(room.reason === "no-room" || room.reason === "no-dressing-room" ? "date" : undefined, room.error);

  // Last, as in the form.
  if (raw.note !== undefined && raw.note !== null && typeof raw.note !== "string") return refuse("note", "หมายเหตุไม่ถูกต้อง");
  const note = cleanNote(typeof raw.note === "string" ? raw.note : "");
  if (note.length > MAX_NOTE) return refuse("note", `หมายเหตุยาวเกิน ${MAX_NOTE} ตัวอักษร`);
  return { ok: true, value: { date, roomId: room.roomId, hn: hn.hn, operation, shift, dressing: room.dressing, scrubDoes, note } };
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
