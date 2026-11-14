"use server";

import { revalidatePath } from "next/cache";
import { checkCase, type AddedCase } from "@/lib/added-cases";
import { getUser } from "@/lib/auth/server";
import { addedToday, DAILY_ADD_LIMIT, doctorFor, insertCase, listCasesBy, removeCase } from "@/lib/cases";
import { today as todayInBangkok } from "@/lib/clock";
import { db } from "@/lib/db";
import { thaiDate } from "@/lib/days";
import { holidaysBetween } from "@/lib/holidays";
import { getRepairPeriods } from "@/lib/repair-store";
import { getRoom, roomLabel } from "@/lib/rooms";

/**
 * Every answer carries the doctor's own bookings from today on, so the form's list stays current. They carry the HN:
 * the list goes only to the doctor who made them.
 */
export type CaseResult = { ok: true; mine: AddedCase[]; message: string } | { ok: false; error: string; mine?: AddedCase[] };

const NOT_DOCTOR: CaseResult = { ok: false, error: "เฉพาะแพทย์ที่ยืนยันชื่อแล้วเท่านั้น ลองออกจากระบบแล้วเข้าใหม่" };
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
 * Books a room for one patient (by HN) on a workday. The form checks the same with weekdays only; here the day is also
 * checked against the holidays (EXTRA_HOLIDAYS and the Bank of Thailand's feed). When the feed cannot be read, a
 * weekday that is not in EXTRA_HOLIDAYS is taken, as on the board: only the workbook upload needs the feed to be sure.
 */
export async function addCase(input: unknown): Promise<CaseResult> {
  try {
    const signed = await signedInDoctor();
    if (!signed) return NOT_DOCTOR;
    const { user, doctor, pool } = signed;
    // The app's clock (lib/clock.ts), the same one the page gave the form, so the two agree on what today is.
    const today = todayInBangkok();
    const periods = await getRepairPeriods(pool);
    // Again on the server: the HN (stored normalised), a weekday within 60 days, and a room open that day. Everything
    // but the holidays first, so the Bank of Thailand's feed is asked only for the booked day's year.
    const first = checkCase(input, today, periods);
    if (!first.ok) return { ok: false, error: first.error };
    const { holidays } = await holidaysBetween(first.value.date, first.value.date);
    const checked = checkCase(first.value, today, periods, holidays);
    if (!checked.ok) return { ok: false, error: checked.error };
    const value = checked.value;

    if ((await addedToday(pool, doctor.id)) >= DAILY_ADD_LIMIT) {
      return { ok: false, error: `จองได้ไม่เกิน ${DAILY_ADD_LIMIT} รายการต่อวัน` };
    }

    await insertCase(pool, doctor.id, user.sub, value);
    revalidatePath("/");
    const room = getRoom(value.roomId);
    return {
      ok: true,
      mine: await listCasesBy(pool, doctor.id, today),
      message: `จอง ${room ? roomLabel(room) : value.roomId} ${thaiDate(value.date, "short")} แล้ว`,
    };
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
