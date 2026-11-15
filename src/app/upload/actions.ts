"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/admin";
import { displayNameFor } from "@/lib/auth/display-name";
import { getUser } from "@/lib/auth/server";
import { inUploadWindow, loadUploadSlot, TURNOVER_MINUTES } from "@/lib/board-day";
import { listCasesOn } from "@/lib/cases";
import { bangkokParts, now } from "@/lib/clock";
import { db } from "@/lib/db";
import { thaiDate } from "@/lib/days";
import { HOLIDAYS_UNAVAILABLE } from "@/lib/holidays";
import { getRepairPeriods } from "@/lib/repair-store";
import { isMx } from "@/lib/roles";
import { runUploadFlow } from "@/lib/upload-flow";
import { saveUpload } from "@/lib/workbook-store";
import { XLS_MESSAGE, XLSX_LIMITS } from "@/lib/xlsx";
import { fileProblem } from "./file-check";

/** The page shows the saved upload itself (it is revalidated), so an answer is one line. */
export type UploadResult = { ok: true; message: string } | { ok: false; error: string };

const NOT_ALLOWED: UploadResult = { ok: false, error: "เฉพาะผู้จัดการตาราง (MX) และผู้ดูแลระบบเท่านั้น ลองออกจากระบบแล้วเข้าใหม่" };
const FAILED: UploadResult = { ok: false, error: "บันทึกไม่สำเร็จ ลองอีกครั้ง" };

const RULES = { maxBytes: XLSX_LIMITS.maxFileBytes, xlsMessage: XLS_MESSAGE };

/** The file's name as stored: one line, no control or format characters, at most 120 characters. Never logged. */
function cleanFileName(name: string): string | null {
  const clean = name
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? clean.slice(0, 120) : null;
}

/** An error's kind for the log: never its message, which for a database error can quote the HNs it was given. */
function errorKind(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string" && /^[0-9A-Z_]{1,40}$/i.test(code)) return code;
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Uploads MX's HOSxP file for the next workday. Server actions can be called by anyone who can reach the site, so the
 * role, the window and the file are all checked again here, by the server's clock (lib/clock.ts now()): MX only from
 * 15:00 to 16:00 Bangkok time, admins at any time. The target day is the first workday after today by the Bank of
 * Thailand's holidays; without them nothing is saved (a guessed day could put a list on the wrong date).
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
    if (!admin && !inUploadWindow(at)) return { ok: false, error: "อัปโหลดได้เฉพาะเวลา 15:00–16:00 น." };

    const file = form.get("file");
    const problem = fileProblem(file instanceof File ? file : null, RULES);
    if (problem || !(file instanceof File)) return { ok: false, error: problem ?? "เลือกไฟล์ตารางผ่าตัดก่อน" };

    const slot = await loadUploadSlot(at);
    if (!slot.target.ok) {
      return { ok: false, error: slot.target.reason === "none" ? "ไม่พบวันทำการใน 14 วันข้างหน้า" : HOLIDAYS_UNAVAILABLE };
    }
    const target = slot.target.date;
    // The page names the day the file is for; should the day have moved on since (midnight), MX checks the file again.
    const shown = form.get("target");
    if (typeof shown === "string" && shown && shown !== target) {
      return { ok: false, error: `ตอนนี้เป็นรอบตารางของ${thaiDate(target, "short")} โหลดหน้านี้ใหม่แล้วอัปโหลดอีกครั้ง` };
    }

    const [periods, bookings] = await Promise.all([getRepairPeriods(pool), listCasesOn(pool, target)]);
    const flow = runUploadFlow({ data: new Uint8Array(await file.arrayBuffer()), target, periods, bookings });
    if (!flow.ok) return { ok: false, error: flow.message };

    const { summary } = flow;
    await saveUpload(pool, {
      targetDate: target,
      cycleDay: slot.cycleDay,
      uploadedAt: at,
      uploadedBy: user.sub,
      uploaderName: await displayNameFor(user, user.name),
      fileName: cleanFileName(file.name),
      totalRows: summary.rows,
      kept: summary.kept,
      placed: summary.placed,
      summary,
      cases: flow.cases,
    });
    // The board's next cycle and this page's latest upload.
    revalidatePath("/");
    revalidatePath("/upload");

    // An upload is the board's list from 16:00 of its day (lib/board-day.ts), so one made later shows at once.
    const when = bangkokParts(at).minutes < TURNOVER_MINUTES ? "ขึ้นกระดานเวลา 16:00 น." : "ขึ้นกระดานแล้ว";
    return {
      ok: true,
      message: `บันทึกตารางของ${thaiDate(target, "short")} แล้ว ลงห้อง ${summary.placed} จาก ${summary.toPlace} เคส · ${when}`,
    };
  } catch (error) {
    console.error(`[upload] the upload failed (${errorKind(error)})`);
    return FAILED;
  }
}
