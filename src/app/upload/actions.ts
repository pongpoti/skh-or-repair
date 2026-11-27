"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/admin";
import { displayNameFor } from "@/lib/auth/display-name";
import { getUser } from "@/lib/auth/server";
import { addDays, isIsoDate } from "@/lib/added-cases";
import { ADMIN_UPLOAD_AHEAD_DAYS, adminCycleDay, cycleDayOf, cycleShows, inUploadWindow, loadUploadSlot, TURNOVER_MINUTES } from "@/lib/board-day";
import { listCasesOn } from "@/lib/cases";
import { bangkokParts, now } from "@/lib/clock";
import { db } from "@/lib/db";
import { thaiDate } from "@/lib/days";
import { HOLIDAYS_UNAVAILABLE, holidaysBetween, isWorkday, LOOKAHEAD_DAYS, type Holiday } from "@/lib/holidays";
import { BOARD_PATH, THA_CHALOM_PATH } from "@/lib/places";
import { getRepairPeriods } from "@/lib/repair-store";
import { isMx } from "@/lib/roles";
import { runUploadFlow } from "@/lib/upload-flow";
import { cleanFileName, errorKind } from "@/lib/safe-text";
import { saveUpload } from "@/lib/workbook-store";
import { XLSX_LIMITS } from "@/lib/xlsx";
import { fileProblem } from "./file-check";

/** The page shows the saved upload itself (it is revalidated), so an answer is one line. */
export type UploadResult = { ok: true; message: string } | { ok: false; error: string };

const NOT_ALLOWED: UploadResult = { ok: false, error: "อัปโหลดได้เฉพาะผู้จัดการตาราง (MX) และผู้ดูแลระบบ" };
const FAILED: UploadResult = { ok: false, error: "บันทึกไม่สำเร็จ ลองอีกครั้ง" };

const RULES = { maxBytes: XLSX_LIMITS.maxFileBytes };

/**
 * When an admin's upload shows on the board: now when its day is the board's, at 16:00 of its cycle when that is later,
 * else only on the calendar (today after 16:00); a weekend or holiday's says nothing.
 */
function adminWhen(target: string, cycle: string, at: Date, holidays: readonly Holiday[]): string {
  if (cycleShows(cycle, target, holidays)) {
    if (cycle === cycleDayOf(at)) return "ขึ้นกระดานแล้ว";
    return cycle === bangkokParts(at).date ? "ขึ้นกระดานเวลา 16:00 น." : `ขึ้นกระดาน${thaiDate(cycle, "short")} 16:00 น.`;
  }
  return isWorkday(target, holidays) ? "ดูได้จากปฏิทิน" : "";
}

/**
 * Uploads MX's HOSxP file for the next workday. Server actions can be called by anyone who can reach the site, so the
 * role, the window and the file are all checked again here, by the server's clock (lib/clock.ts now()): MX only from
 * 15:00 to 16:00 Bangkok time, admins at any time. MX's target day is the first workday after today by the Bank of
 * Thailand's holidays; without them nothing is saved (a guessed day could put a list on the wrong date). An admin picks
 * the day, any day from today to a year ahead (Pong, 27 Nov 2026: "admin can upload file of any date on anytime. No
 * restriction"), and the upload counts in the cycle that shows it (lib/board-day.ts adminCycleDay).
 */
export async function uploadWorkbook(form: FormData): Promise<UploadResult> {
  try {
    // getUser() re-checks the signed session and that the number (or the doctor's email sign-in) is still authorized.
    const user = await getUser();
    if (!user) return NOT_ALLOWED;
    const pool = await db();
    const admin = isAdmin(user.sub);
    if (!admin && !(await isMx(pool, user))) return NOT_ALLOWED;

    const at = now();
    if (!admin && !inUploadWindow(at)) return { ok: false, error: "อัปโหลดได้เฉพาะ 15:00–16:00 น." };

    const file = form.get("file");
    const problem = fileProblem(file instanceof File ? file : null, RULES);
    if (problem || !(file instanceof File)) return { ok: false, error: problem ?? "เลือกไฟล์ก่อน" };

    const shown = form.get("target");
    let target: string;
    let cycleDay: string;
    let adminHolidays: Holiday[] = [];
    if (admin) {
      // The admin's own pick, from today on: the file's rows must be for that day (runUploadFlow checks).
      const today = bangkokParts(at).date;
      if (!isIsoDate(shown) || shown < today || shown > addDays(today, ADMIN_UPLOAD_AHEAD_DAYS)) return { ok: false, error: "เลือกวันของตาราง" };
      target = shown;
      // Only when the board shows it hangs on the holidays, so a weekday stands in when the feed fails.
      adminHolidays = (await holidaysBetween(addDays(target, -LOOKAHEAD_DAYS), addDays(target, LOOKAHEAD_DAYS))).holidays;
      cycleDay = adminCycleDay(target, at, adminHolidays);
    } else {
      const slot = await loadUploadSlot(at);
      if (!slot.target.ok) {
        return { ok: false, error: slot.target.reason === "none" ? "ไม่มีวันทำการใน 14 วันข้างหน้า" : HOLIDAYS_UNAVAILABLE };
      }
      target = slot.target.date;
      cycleDay = slot.cycleDay;
      // The page names the day the file is for; should the day have moved on since (midnight), MX checks the file again.
      if (typeof shown === "string" && shown && shown !== target) {
        return { ok: false, error: `ตอนนี้รับตารางของ${thaiDate(target, "short")} โหลดหน้าใหม่แล้วลองอีกครั้ง` };
      }
    }

    // The file holds both hospitals' cases (Pong, 27 Nov 2026): each is matched with its own doctors' bookings.
    const [periods, bookings, thaChalomBookings] = await Promise.all([
      getRepairPeriods(pool),
      listCasesOn(pool, target),
      listCasesOn(pool, target, "tha-chalom"),
    ]);
    const flow = runUploadFlow({ data: new Uint8Array(await file.arrayBuffer()), target, periods, bookings, thaChalomBookings });
    if (!flow.ok) return { ok: false, error: flow.message };

    const { summary } = flow;
    await saveUpload(pool, {
      targetDate: target,
      cycleDay,
      uploadedAt: at,
      uploadedBy: user.sub,
      uploaderName: await displayNameFor(user, user.name),
      fileName: cleanFileName(file.name),
      totalRows: summary.rows,
      kept: summary.kept,
      placed: summary.placed,
      summary,
      cases: [...flow.cases, ...flow.thaChalomCases],
    });
    // Both boards' next cycle and this page's latest upload.
    revalidatePath(BOARD_PATH);
    revalidatePath(THA_CHALOM_PATH);
    revalidatePath("/upload");

    // An upload is the board's list from 16:00 of its day (lib/board-day.ts), so one made later shows at once.
    const when = admin ? adminWhen(target, cycleDay, at, adminHolidays) : bangkokParts(at).minutes < TURNOVER_MINUTES ? "ขึ้นกระดานเวลา 16:00 น." : "ขึ้นกระดานแล้ว";
    const tc = summary.thaChalom;
    const thaChalom = tc && tc.toPlace > 0 ? ` · ท่าฉลอม ${tc.placed} จาก ${tc.toPlace}` : "";
    return {
      ok: true,
      message: `บันทึกตารางของ${thaiDate(target, "short")} แล้ว ลงห้อง ${summary.placed} จาก ${summary.toPlace} เคส${thaChalom}${when ? ` · ${when}` : ""}`,
    };
  } catch (error) {
    console.error(`[upload] the upload failed (${errorKind(error)})`);
    return FAILED;
  }
}
