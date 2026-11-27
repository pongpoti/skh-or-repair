"use server";

import { revalidatePath } from "next/cache";
import {
  addDays,
  bookAheadDays,
  bookedChoice,
  bookedMessage,
  bookedRoom,
  bookingChange,
  bookingState,
  checkCase,
  daySlots,
  deptRooms,
  editedMessage,
  firstBookingDay,
  roomAmong,
  STARTED_TEXT,
  timeClash,
  timeOf,
  type AddedCase,
  type CaseField,
  type DaySlot,
} from "@/lib/added-cases";
import { isAdmin } from "@/lib/admin";
import { TIME_TAKEN_TEXT } from "@/lib/booking-time";
import { getUser } from "@/lib/auth/server";
import { bookingUnderWay } from "@/lib/board-rows";
import {
  addedToday,
  DAILY_ADD_LIMIT,
  doctorFor,
  insertCase,
  listCasesBy,
  listCasesOn,
  ownCase,
  removeCase,
  removedCase,
  restoreCase,
  UNDO_MINUTES,
  updateCase,
  updateNote,
  withDayLock,
} from "@/lib/cases";
import { bangkokParts, now, today as todayInBangkok } from "@/lib/clock";
import { db } from "@/lib/db";
import { holidaysBetween } from "@/lib/holidays";
import type { RepairPeriods } from "@/lib/repair";
import { getRepairPeriods } from "@/lib/repair-store";
import { markTutorialSeen } from "@/lib/tutorial-store";
import { userForSession } from "@/lib/user-list";
import { workbookForDay } from "@/lib/workbook-store";
import { BOARD_PATH, THA_CHALOM_PATH, type PlaceId } from "@/lib/places";

/**
 * Every answer carries the doctor's own bookings from today on, so the form's list stays current. They carry the HN:
 * the list goes only to the doctor who made them.
 */
export type CaseResult =
  | { ok: true; mine: AddedCase[]; message: string }
  /**
   * `earliest` is set when the day had become too soon (15:00 passed while the form was open), for the calendar; `field`
   * names what the error is about when the form cannot tell (a time another booking took meanwhile).
   */
  | { ok: false; error: string; mine?: AddedCase[]; earliest?: string; field?: CaseField };

/** The day view's bookings of one day (components/day-view.tsx). */
export type DayResult = { ok: true; date: string; slots: DaySlot[] } | { ok: false; error: string };

const NOT_DOCTOR_TEXT = "จองได้เฉพาะแพทย์ ลองออกแล้วเข้าระบบใหม่";
const NOT_DOCTOR: CaseResult = { ok: false, error: NOT_DOCTOR_TEXT };
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

/** A booking's change shows on its hospital's board; both are refreshed (a booking never moves between them). */
function refreshBoards() {
  revalidatePath(BOARD_PATH);
  revalidatePath(THA_CHALOM_PATH);
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
  return bookAt("skh", input);
}

/**
 * Books a room at รพ.ท่าฉลอม (Pong, 27 Nov 2026: "Add booking btn on ท่าฉลอม also"), checked as addCase's, in the room the
 * hospital's table gives the doctor's department that day (lib/added-cases.ts placeBookingRoom, decision card "No, own
 * department's room only"): never a dressing room nor another department's.
 */
export async function addThaChalomCase(input: unknown): Promise<CaseResult> {
  return bookAt("tha-chalom", input);
}

async function bookAt(place: PlaceId, input: unknown): Promise<CaseResult> {
  try {
    const signed = await signedInDoctor();
    if (!signed) return NOT_DOCTOR;
    const { user, doctor, pool } = signed;
    // An admin books with no time limits (Pong, 27 Nov 2026: "admin ... can book cases at any date on any time. No
    // restriction"): from today, whatever the hour, a year ahead, and no daily limit (lib/added-cases.ts firstBookingDay).
    const admin = isAdmin(user.sub);
    const ahead = bookAheadDays(admin);
    // The app's clock (lib/clock.ts), the same one the page gave the form, so the two agree on today and on 15:00.
    const { date: today, minutes } = bangkokParts(now());
    const [periods, { holidays }] = await Promise.all([getRepairPeriods(pool), holidaysBetween(today, addDays(today, ahead))]);
    // Again on the server: the day, the HN (stored normalised), the operation, the room choice, the scrub answer and the
    // note (cleanNote, at most MAX_NOTE characters);
    // the room itself is worked out from the doctor's own department as the database has it (never from the form).
    const earliest = firstBookingDay(admin, today, minutes, holidays);
    const checked = checkCase(input, { today, earliest, periods, subtype: doctor.subtype, holidays, place, ahead });
    if (!checked.ok) return { ok: false, error: checked.error, earliest: checked.earliest };
    const value = checked.value;

    if (!admin && (await addedToday(pool, doctor.id)) >= DAILY_ADD_LIMIT) {
      return { ok: false, error: `จองได้ไม่เกิน ${DAILY_ADD_LIMIT} รายการต่อวัน` };
    }

    // Under the day's lock: the time is checked free in its room and taken in one go (Pong, 27 Nov 2026).
    const taken = await withDayLock(pool, value.date, async (client) => {
      const day = await listCasesOn(client, value.date, place);
      // A department with several rooms that day: the room of the doctor's own booking there, else the emptier one
      // that is free at that time. รพ.ท่าฉลอม gives a department one room a day.
      const rooms = value.dressing || place !== "skh" ? [] : deptRooms(doctor.subtype, value.operation, value.date, periods);
      if (rooms.length > 1) value.roomId = roomAmong(rooms, doctor.id, value.date, day, periods, timeOf(value));
      if (timeClash(timeOf(value), value.roomId, value.date, day, periods)) return true;
      await insertCase(client, doctor.id, user.sub, value);
      return false;
    });
    if (taken) return { ok: false, error: TIME_TAKEN_TEXT, field: "time", mine: await listCasesBy(pool, doctor.id, today, place) };
    refreshBoards();
    return { ok: true, mine: await listCasesBy(pool, doctor.id, today, place), message: bookedMessage(value) };
  } catch (error) {
    logFailure("Booking a room failed", error);
    return FAILED;
  }
}

/** The hospital an edit's form was on (CaseInput.place), for a booking that has gone. */
function formPlace(input: unknown): PlaceId {
  return typeof input === "object" && input !== null && (input as { place?: unknown }).place === "tha-chalom" ? "tha-chalom" : "skh";
}

const isCaseId = (id: unknown): id is string => typeof id === "string" && /^\d{1,18}$/.test(id);
const GONE = "การจองนี้ถูกยกเลิกไปแล้ว";
const PAST = "ผ่านวันผ่าตัดแล้ว แก้ไม่ได้";

/**
 * Whether today's booking is on a row HOSxP says is under way or over (lib/board-rows.ts bookingUnderWay), on its
 * hospital's board: the row's actions then offer only booking again, and the server refuses an edit or a cancel. Only
 * today's list can say so.
 */
async function startedToday(pool: Awaited<ReturnType<typeof db>>, booking: AddedCase, today: string, surgeonId: string, periods?: RepairPeriods): Promise<boolean> {
  if (booking.date !== today) return false;
  const place: PlaceId = booking.place === "tha-chalom" ? "tha-chalom" : "skh";
  const [workbook, bookings, inForce] = await Promise.all([
    workbookForDay(pool, today, place),
    listCasesOn(pool, today, place),
    periods ? Promise.resolve(periods) : getRepairPeriods(pool),
  ]);
  if (!workbook) return false;
  return bookingUnderWay({ date: today, periods: inForce, workbook: workbook.cases, bookings }, booking.id, surgeonId, place);
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
    const { user, doctor, pool } = signed;
    // An admin's edit has no time limits either (bookAt).
    const admin = isAdmin(user.sub);
    const ahead = bookAheadDays(admin);
    const { date: today, minutes } = bangkokParts(now());
    const [periods, { holidays }, booking] = await Promise.all([
      getRepairPeriods(pool),
      holidaysBetween(today, addDays(today, ahead)),
      ownCase(pool, id, doctor.id),
    ]);
    // The booking's own hospital (an edit never moves it to the other); the form's when it has gone.
    const place: PlaceId = booking ? (booking.place ?? "skh") : formPlace(input);
    const mine = () => listCasesBy(pool, doctor.id, today, place);
    if (!booking) return { ok: false, error: GONE, mine: await mine() };
    const earliest = firstBookingDay(admin, today, minutes, holidays);
    if (bookingState(booking.date, today, earliest) === "past") return { ok: false, error: PAST, mine: await mine() };
    if (await startedToday(pool, booking, today, doctor.id, periods)) return { ok: false, error: STARTED_TEXT, mine: await mine() };
    const editing = { ...booking, subtype: doctor.subtype };
    const checked = checkCase(input, { today, earliest, periods, subtype: doctor.subtype, holidays, editing, ahead });
    if (!checked.ok) return { ok: false, error: checked.error, earliest: checked.earliest };
    const value = checked.value;

    // A closed day: only the note, saved alone (checkCase made sure nothing else changed).
    if (value.date === booking.date && value.date < earliest) {
      if (value.note === booking.note) return { ok: true, mine: await mine(), message: "ไม่มีอะไรเปลี่ยน" };
      if (!(await updateNote(pool, id, doctor.id, value.note))) return { ok: false, error: GONE, mine: await mine() };
      refreshBoards();
      return { ok: true, mine: await mine(), message: "บันทึกแล้ว" };
    }
    // Under the new day's lock, as a new booking: its room worked out and its time checked free there.
    const saved = await withDayLock(pool, value.date, async (client): Promise<"taken" | "same" | "gone" | { requeue: boolean; moved: boolean }> => {
      // Among the day's other bookings: this one does not hold a room or a time for itself.
      const day = (await listCasesOn(client, value.date, place)).filter((item) => item.id !== booking.id);
      if (!value.dressing && place === "skh") {
        const sameRoom = value.date === booking.date && bookedChoice(editing, periods) === "dept";
        const rooms = deptRooms(doctor.subtype, value.operation, value.date, periods);
        if (sameRoom && rooms.includes(bookedRoom(editing, periods).roomId)) value.roomId = bookedRoom(editing, periods).roomId;
        else if (rooms.length > 1) value.roomId = roomAmong(rooms, doctor.id, value.date, day, periods, timeOf(value));
      }
      const change = bookingChange(editing, value, periods);
      if (!change.changed) return "same";
      if (timeClash(timeOf(value), value.roomId, value.date, day, periods)) return "taken";
      return (await updateCase(client, id, doctor.id, value, change.requeue)) ? change : "gone";
    });
    if (saved === "same") return { ok: true, mine: await mine(), message: "ไม่มีอะไรเปลี่ยน" };
    if (saved === "taken") return { ok: false, error: TIME_TAKEN_TEXT, field: "time", mine: await mine() };
    if (saved === "gone") return { ok: false, error: GONE, mine: await mine() };
    refreshBoards();
    return { ok: true, mine: await mine(), message: editedMessage(value, booking, saved) };
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
  return cancelAt("skh", id);
}

/** deleteCase on รพ.ท่าฉลอม's board: the same cancel; the answer lists the doctor's bookings there. */
export async function deleteThaChalomCase(id: unknown): Promise<CaseResult> {
  return cancelAt("tha-chalom", id);
}

async function cancelAt(boardPlace: PlaceId, id: unknown): Promise<CaseResult> {
  if (!isCaseId(id)) return FAILED;
  try {
    const signed = await signedInDoctor();
    if (!signed) return NOT_DOCTOR;
    const { doctor, pool } = signed;
    const today = todayInBangkok();
    const booking = await ownCase(pool, id, doctor.id);
    const place: PlaceId = booking ? (booking.place ?? "skh") : boardPlace;
    if (booking && booking.date < today) return { ok: false, error: PAST, mine: await listCasesBy(pool, doctor.id, today, place) };
    if (booking && (await startedToday(pool, booking, today, doctor.id))) return { ok: false, error: STARTED_TEXT, mine: await listCasesBy(pool, doctor.id, today, place) };
    const removed = booking !== null && (await removeCase(pool, id, doctor.id));
    refreshBoards();
    const mine = await listCasesBy(pool, doctor.id, today, place);
    return removed ? { ok: true, mine, message: "ยกเลิกการจองแล้ว" } : { ok: true, mine, message: GONE };
  } catch (error) {
    logFailure("Cancelling a booking failed", error);
    return { ok: false, error: "ยกเลิกไม่สำเร็จ ลองอีกครั้ง" };
  }
}

/**
 * Books back a booking the doctor cancelled moments ago (เลิกทำ on the cancel's answer), in its old place in the queue:
 * within UNDO_MINUTES of the cancel, and only while its day has not gone and its time is still free in its room.
 */
export async function undoCancel(id: unknown): Promise<CaseResult> {
  return restoreAt("skh", id);
}

/** undoCancel on รพ.ท่าฉลอม's board. */
export async function undoThaChalomCancel(id: unknown): Promise<CaseResult> {
  return restoreAt("tha-chalom", id);
}

async function restoreAt(boardPlace: PlaceId, id: unknown): Promise<CaseResult> {
  if (!isCaseId(id)) return FAILED;
  try {
    const signed = await signedInDoctor();
    if (!signed) return NOT_DOCTOR;
    const { doctor, pool } = signed;
    const today = todayInBangkok();
    const cancelled = await removedCase(pool, id, doctor.id);
    const place: PlaceId = cancelled ? (cancelled.place ?? "skh") : boardPlace;
    const restored = cancelled
      ? await withDayLock(pool, cancelled.date, async (client) => {
          const periods = await getRepairPeriods(client);
          const room = bookedRoom(cancelled, periods).roomId;
          if (timeClash(timeOf(cancelled), room, cancelled.date, await listCasesOn(client, cancelled.date, place), periods, cancelled.id)) return "taken";
          return (await restoreCase(client, id, doctor.id, today)) ? "restored" : "late";
        })
      : "late";
    refreshBoards();
    const mine = await listCasesBy(pool, doctor.id, today, place);
    if (restored === "restored") return { ok: true, mine, message: "จองคืนแล้ว คิวเดิม" };
    if (restored === "taken") return { ok: false, mine, error: "เวลานั้นมีคนจองแล้ว จองใหม่แทน" };
    return { ok: false, mine, error: `เลิกทำได้ภายใน ${UNDO_MINUTES} นาทีหลังยกเลิก จองใหม่แทน` };
  } catch (error) {
    logFailure("Restoring a booking failed", error);
    return { ok: false, error: "จองคืนไม่สำเร็จ ลองอีกครั้ง" };
  }
}

/**
 * The bookings of one day for the booking form's day view (Pong, 27 Nov 2026: "select time ... on day view of calendar
 * (just like in google calendar app)"): every room's, where each is now, with its time, operation and surgeon; never an
 * HN. Only for a signed-in doctor, and only for a day from today to BOOK_AHEAD_DAYS ahead (a year for an admin).
 */
export async function dayBookings(date: unknown): Promise<DayResult> {
  return dayAt("skh", date);
}

/** dayBookings for รพ.ท่าฉลอม's rooms. */
export async function thaChalomDayBookings(date: unknown): Promise<DayResult> {
  return dayAt("tha-chalom", date);
}

async function dayAt(place: PlaceId, date: unknown): Promise<DayResult> {
  try {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "วันที่ไม่ถูกต้อง" };
    const signed = await signedInDoctor();
    if (!signed) return { ok: false, error: NOT_DOCTOR_TEXT };
    const { user, doctor, pool } = signed;
    const today = todayInBangkok();
    if (date < today || date > addDays(today, bookAheadDays(isAdmin(user.sub)))) return { ok: false, error: "วันที่ไม่ถูกต้อง" };
    const [day, periods] = await Promise.all([listCasesOn(pool, date, place), getRepairPeriods(pool)]);
    return { ok: true, date, slots: daySlots(day, periods, doctor.id) };
  } catch (error) {
    logFailure("Reading a day's bookings failed", error);
    return { ok: false, error: "โหลดการจองไม่ได้ ลองใหม่" };
  }
}

/**
 * Notes that the signed-in user (a doctor, or RN, PN, PCA or MX) started or skipped the tutorial on their first visit
 * (/tutorial), so the board stops opening it by itself. Someone not on the users list is ignored. Never fails: the worst
 * case is the tutorial offered once more.
 */
export async function seeTutorial(): Promise<void> {
  try {
    const user = await getUser();
    if (!user) return;
    const pool = await db();
    const listed = await userForSession(pool, user);
    if (!listed) return;
    await markTutorialSeen(pool, listed.id);
  } catch (error) {
    logFailure("Noting the tutorial seen failed", error);
  }
}
