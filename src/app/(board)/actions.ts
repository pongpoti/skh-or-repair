"use server";

import { revalidatePath } from "next/cache";
import { addDays, BOOK_AHEAD_DAYS, bookedMessage, checkCase, earliestBookingDay, type AddedCase } from "@/lib/added-cases";
import { getUser } from "@/lib/auth/server";
import { addedToday, DAILY_ADD_LIMIT, doctorFor, insertCase, listCasesBy, removeCase } from "@/lib/cases";
import { bangkokParts, now, today as todayInBangkok } from "@/lib/clock";
import { db } from "@/lib/db";
import { holidaysBetween } from "@/lib/holidays";
import { getRepairPeriods } from "@/lib/repair-store";

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
    // Again on the server: the day, the HN (stored normalised), the operation, the room choice and the scrub answer;
    // the room itself is worked out from the doctor's own department as the database has it (never from the form).
    const earliest = earliestBookingDay(today, minutes, holidays);
    const checked = checkCase(input, { today, earliest, periods, subtype: doctor.subtype, holidays });
    if (!checked.ok) return { ok: false, error: checked.error, earliest: checked.earliest };
    const value = checked.value;

    if ((await addedToday(pool, doctor.id)) >= DAILY_ADD_LIMIT) {
      return { ok: false, error: `จองได้ไม่เกิน ${DAILY_ADD_LIMIT} รายการต่อวัน` };
    }

    await insertCase(pool, doctor.id, user.sub, value);
    revalidatePath("/");
    return { ok: true, mine: await listCasesBy(pool, doctor.id, today), message: bookedMessage(value) };
  } catch (error) {
    logFailure("Booking a room failed", error);
    return FAILED;
  }
}

/** Cancels one of the doctor's own bookings (the row stays, with removed_at set). */
export async function deleteCase(id: unknown): Promise<CaseResult> {
  if (typeof id !== "string" || !/^\d{1,18}$/.test(id)) return FAILED;
  try {
    const signed = await signedInDoctor();
    if (!signed) return NOT_DOCTOR;
    const { doctor, pool } = signed;
    const removed = await removeCase(pool, id, doctor.id);
    revalidatePath("/");
    const mine = await listCasesBy(pool, doctor.id, todayInBangkok());
    return removed ? { ok: true, mine, message: "ยกเลิกการจองแล้ว" } : { ok: true, mine, message: "การจองนี้ถูกยกเลิกไปแล้ว" };
  } catch (error) {
    logFailure("Cancelling a booking failed", error);
    return { ok: false, error: "ยกเลิกไม่สำเร็จ ลองอีกครั้ง" };
  }
}
