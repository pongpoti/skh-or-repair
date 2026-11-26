"use server";

import { revalidatePath } from "next/cache";
import {
  addDays,
  BOOK_AHEAD_DAYS,
  bookedChoice,
  bookedMessage,
  bookedRoom,
  bookingChange,
  bookingState,
  checkCase,
  deptRooms,
  earliestBookingDay,
  editedMessage,
  roomAmong,
  STARTED_TEXT,
  type AddedCase,
} from "@/lib/added-cases";
import { getUser } from "@/lib/auth/server";
import { bookingUnderWay } from "@/lib/board-rows";
import { addedToday, DAILY_ADD_LIMIT, doctorFor, insertCase, listCasesBy, listCasesOn, ownCase, removeCase, restoreCase, UNDO_MINUTES, updateCase, updateNote } from "@/lib/cases";
import { bangkokParts, now, today as todayInBangkok } from "@/lib/clock";
import { db } from "@/lib/db";
import { holidaysBetween } from "@/lib/holidays";
import type { RepairPeriods } from "@/lib/repair";
import { getRepairPeriods } from "@/lib/repair-store";
import { markTutorialSeen } from "@/lib/tutorial-store";
import { workbookForDay } from "@/lib/workbook-store";
import { BOARD_PATH } from "@/lib/places";

/**
 * Every answer carries the doctor's own bookings from today on, so the form's list stays current. They carry the HN:
 * the list goes only to the doctor who made them.
 */
export type CaseResult =
  | { ok: true; mine: AddedCase[]; message: string }
  /** `earliest` is set when the day had become too soon (15:00 passed while the form was open), for the calendar. */
  | { ok: false; error: string; mine?: AddedCase[]; earliest?: string };

const NOT_DOCTOR: CaseResult = { ok: false, error: "จองได้เฉพาะแพทย์ ลองออกแล้วเข้าระบบใหม่" };
const FAILED: CaseResult = { ok: false, error: "บันทึกไม่สำเร็จ ลองอีกครั้ง" };

/** Server actions can be called by anyone who can reach the site, so each one checks the doctor again. */
async function signedInDoctor() {
  // getUser() re-checks the signed session and that the number (or the doctor's email sign-in) is still authorized.
  const user = await getUser();
  if (!user) return null;
  const pool = await db();
  const doctor = await doctorFor(pool, user);
  return doctor ? { user, doctor, pool } : null;
}

/**
 * The message only: a database error's detail can quote the failing row ("Failing row contains (…)"), and a booking's
 * row holds the patient's HN, which is never logged.
 */
function logFailure(what: string, error: unknown) {
  console.error(`${what}:`, error instanceof Error ? error.message : "unknown error");
}

/**
 * Books a room for one patient (by HN) on a workday, in the room of the doctor's choice (lib/added-cases.ts
 * bookingRoom: their department's room that day, or the dressing room with their answer to the scrub question). The day is checked against the
 * earliest day by the app's clock (before 15:00 the next workday, from 15:00 the one after) and the holidays
 * (HOSPITAL_HOLIDAYS, EXTRA_HOLIDAYS and the Bank of Thailand's feed). When the feed cannot be read, a weekday that is
 * not in HOSPITAL_HOLIDAYS or EXTRA_HOLIDAYS is taken, as on the board: only the workbook upload needs the feed to be
 * sure.
 */
export async function addCase(input: unknown): Promise<CaseResult> {
  try {
    const signed = await signedInDoctor();
    if (!signed) return NOT_DOCTOR;
    const { user, doctor, pool } = signed;
    // The app's clock (lib/clock.ts), the same one the page gave the form, so the two agree on today and on 15:00.
    const { date: today, minutes } = bangkokParts(now());
    const [periods, { holidays }] = await Promise.all([getRepairPeriods(pool), holidaysBetween(today, addDays(today, BOOK_AHEAD_DAYS))]);
    // Again on the server: the day, the HN (stored normalised), the operation, the room choice, the scrub answer and the
    // note (cleanNote, at most MAX_NOTE characters);
    // the room itself is worked out from the doctor's own department as the database has it (never from the form).
    const earliest = earliestBookingDay(today, minutes, holidays);
    const checked = checkCase(input, { today, earliest, periods, subtype: doctor.subtype, holidays });
    if (!checked.ok) return { ok: false, error: checked.error, earliest: checked.earliest };
    const value = checked.value;

    if ((await addedToday(pool, doctor.id)) >= DAILY_ADD_LIMIT) {
      return { ok: false, error: `จองได้ไม่เกิน ${DAILY_ADD_LIMIT} รายการต่อวัน` };
    }

    // A department with several rooms that day: the room of the doctor's own booking there, else the emptier one.
    const rooms = value.dressing ? [] : deptRooms(doctor.subtype, value.operation, value.date, periods);
    if (rooms.length > 1) value.roomId = roomAmong(rooms, doctor.id, value.date, await listCasesOn(pool, value.date), periods);

    await insertCase(pool, doctor.id, user.sub, value);
    revalidatePath(BOARD_PATH);
    return { ok: true, mine: await listCasesBy(pool, doctor.id, today), message: bookedMessage(value) };
  } catch (error) {
    logFailure("Booking a room failed", error);
    return FAILED;
  }
}

const isCaseId = (id: unknown): id is string => typeof id === "string" && /^\d{1,18}$/.test(id);
const GONE = "การจองนี้ถูกยกเลิกไปแล้ว";
const PAST = "ผ่านวันผ่าตัดแล้ว แก้ไม่ได้";

/**
 * Whether today's booking is on a row HOSxP says is under way or over (lib/board-rows.ts bookingUnderWay): the row's
 * actions then offer only booking again, and the server refuses an edit or a cancel. Only today's list can say so.
 */
async function startedToday(pool: Awaited<ReturnType<typeof db>>, booking: AddedCase, today: string, surgeonId: string, periods?: RepairPeriods): Promise<boolean> {
  if (booking.date !== today) return false;
  const [workbook, bookings, inForce] = await Promise.all([
    workbookForDay(pool, today),
    listCasesOn(pool, today),
    periods ? Promise.resolve(periods) : getRepairPeriods(pool),
  ]);
  if (!workbook) return false;
  return bookingUnderWay({ date: today, periods: inForce, workbook: workbook.cases, bookings }, booking.id, surgeonId);
}

/**
 * Saves the doctor's edit of one of their own bookings (Pong, 25 Nov 2026: "on DR case row : allow surgeon to edit, move
 * date, delete and other functions"): the new day, HN, operation, room choice, scrub answer and note, checked as a new
 * booking is (lib/added-cases.ts checkCase), except that its own day needs no day checks. Until 15:00 the day before it
 * all can change, the day too (a move); from then on only the note, though the case can still move to a day that is
 * open; that note alone is saved then (updateNote), the rest left as the day's list has it. A new day, room choice or HN
 * puts it at the back of its room's queue (bookingChange). In a department with several rooms that day a booking keeps
 * its room on its own day; on another day, or back from the dressing room, it takes one by roomAmong, as a new booking
 * does. A booking whose day has gone cannot change, nor one HOSxP says is under way or over.
 */
export async function editCase(id: unknown, input: unknown): Promise<CaseResult> {
  if (!isCaseId(id)) return FAILED;
  try {
    const signed = await signedInDoctor();
    if (!signed) return NOT_DOCTOR;
    const { doctor, pool } = signed;
    const { date: today, minutes } = bangkokParts(now());
    const [periods, { holidays }, booking] = await Promise.all([
      getRepairPeriods(pool),
      holidaysBetween(today, addDays(today, BOOK_AHEAD_DAYS)),
      ownCase(pool, id, doctor.id),
    ]);
    const mine = () => listCasesBy(pool, doctor.id, today);
    if (!booking) return { ok: false, error: GONE, mine: await mine() };
    const earliest = earliestBookingDay(today, minutes, holidays);
    if (bookingState(booking.date, today, earliest) === "past") return { ok: false, error: PAST, mine: await mine() };
    if (await startedToday(pool, booking, today, doctor.id, periods)) return { ok: false, error: STARTED_TEXT, mine: await mine() };
    const editing = { ...booking, subtype: doctor.subtype };
    const checked = checkCase(input, { today, earliest, periods, subtype: doctor.subtype, holidays, editing });
    if (!checked.ok) return { ok: false, error: checked.error, earliest: checked.earliest };
    const value = checked.value;

    // A closed day: only the note, saved alone (checkCase made sure nothing else changed).
    if (value.date === booking.date && value.date < earliest) {
      if (value.note === booking.note) return { ok: true, mine: await mine(), message: "ไม่มีอะไรเปลี่ยน" };
      if (!(await updateNote(pool, id, doctor.id, value.note))) return { ok: false, error: GONE, mine: await mine() };
      revalidatePath(BOARD_PATH);
      return { ok: true, mine: await mine(), message: "บันทึกแล้ว" };
    }
    if (!value.dressing) {
      const sameRoom = value.date === booking.date && bookedChoice(editing, periods) === "dept";
      const rooms = deptRooms(doctor.subtype, value.operation, value.date, periods);
      if (sameRoom && rooms.includes(bookedRoom(editing, periods).roomId)) value.roomId = bookedRoom(editing, periods).roomId;
      else if (rooms.length > 1) {
        // Among the day's other bookings: this one does not hold a room for itself.
        const day = (await listCasesOn(pool, value.date)).filter((item) => item.id !== booking.id);
        value.roomId = roomAmong(rooms, doctor.id, value.date, day, periods);
      }
    }

    const change = bookingChange(editing, value, periods);
    if (!change.changed) return { ok: true, mine: await mine(), message: "ไม่มีอะไรเปลี่ยน" };
    if (!(await updateCase(pool, id, doctor.id, value, change.requeue))) return { ok: false, error: GONE, mine: await mine() };
    revalidatePath(BOARD_PATH);
    return { ok: true, mine: await mine(), message: editedMessage(value, booking, change) };
  } catch (error) {
    logFailure("Editing a booking failed", error);
    return FAILED;
  }
}

/**
 * Cancels one of the doctor's own bookings (the row stays, with removed_at set), whenever until its day has gone: after
 * 15:00 the day before too, when the case may already be on MX's HOSxP list (its row then shows it unbooked). Not once
 * HOSxP says the case is under way or over.
 */
export async function deleteCase(id: unknown): Promise<CaseResult> {
  if (!isCaseId(id)) return FAILED;
  try {
    const signed = await signedInDoctor();
    if (!signed) return NOT_DOCTOR;
    const { doctor, pool } = signed;
    const today = todayInBangkok();
    const booking = await ownCase(pool, id, doctor.id);
    if (booking && booking.date < today) return { ok: false, error: PAST, mine: await listCasesBy(pool, doctor.id, today) };
    if (booking && (await startedToday(pool, booking, today, doctor.id))) return { ok: false, error: STARTED_TEXT, mine: await listCasesBy(pool, doctor.id, today) };
    const removed = booking !== null && (await removeCase(pool, id, doctor.id));
    revalidatePath(BOARD_PATH);
    const mine = await listCasesBy(pool, doctor.id, today);
    return removed ? { ok: true, mine, message: "ยกเลิกการจองแล้ว" } : { ok: true, mine, message: GONE };
  } catch (error) {
    logFailure("Cancelling a booking failed", error);
    return { ok: false, error: "ยกเลิกไม่สำเร็จ ลองอีกครั้ง" };
  }
}

/**
 * Books back a booking the doctor cancelled moments ago (เลิกทำ on the cancel's answer), in its old place in the queue:
 * within UNDO_MINUTES of the cancel, and only while its day has not gone.
 */
export async function undoCancel(id: unknown): Promise<CaseResult> {
  if (!isCaseId(id)) return FAILED;
  try {
    const signed = await signedInDoctor();
    if (!signed) return NOT_DOCTOR;
    const { doctor, pool } = signed;
    const today = todayInBangkok();
    const restored = await restoreCase(pool, id, doctor.id, today);
    revalidatePath(BOARD_PATH);
    const mine = await listCasesBy(pool, doctor.id, today);
    return restored
      ? { ok: true, mine, message: "จองคืนแล้ว คิวเดิม" }
      : { ok: false, mine, error: `เลิกทำได้ภายใน ${UNDO_MINUTES} นาทีหลังยกเลิก จองใหม่แทน` };
  } catch (error) {
    logFailure("Restoring a booking failed", error);
    return { ok: false, error: "จองคืนไม่สำเร็จ ลองอีกครั้ง" };
  }
}

/**
 * Notes that the doctor started or skipped the tutorial (/tutorial), so the board stops opening it by itself. Anyone
 * else (an admin looking at it) is ignored. Never fails: the worst case is the tutorial offered once more.
 */
export async function seeTutorial(): Promise<void> {
  try {
    const signed = await signedInDoctor();
    if (!signed) return;
    await markTutorialSeen(signed.pool, signed.doctor.id);
  } catch (error) {
    logFailure("Noting the tutorial seen failed", error);
  }
}
