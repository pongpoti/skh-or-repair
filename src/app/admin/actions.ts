"use server";

import { revalidatePath } from "next/cache";
import { fileProblem } from "@/app/upload/file-check";
import { isAdmin } from "@/lib/admin";
import { displayNameFor } from "@/lib/auth/display-name";
import { getUser } from "@/lib/auth/server";
import { now } from "@/lib/clock";
import { db } from "@/lib/db";
import { bangkokParts } from "@/lib/days";
import { HOLIDAYS_UNAVAILABLE, holidaysBetween } from "@/lib/holidays";
import { PAST_LIMITS, pastLists, splitByDay } from "@/lib/past-lists";
import { getRepairPeriods, saveRepairPeriods } from "@/lib/repair-store";
import { addMx, removeMx, userIdOf } from "@/lib/roles";
import { cleanFileName, errorKind } from "@/lib/safe-text";
import { addUser, checkNewUser } from "@/lib/user-admin";
import { fullName, getListedUser } from "@/lib/user-list";
import { thaiDateSpan } from "@/lib/workbook";
import { savePastLists } from "@/lib/workbook-store";
import { readXlsx, XLS_MESSAGE, XLSX_LIMITS } from "@/lib/xlsx";
import { mxMembersFrom, pastListViewFrom, repairViewFrom, staffFrom, type MxView, type PastListView, type RepairView, type StaffView } from "./data";

type Refused = { ok: false; error: string };

/** A saved repair date answers with the form's data as a fresh page would show it (who saved, and when). */
export type RepairResult = { ok: true; repair: RepairView; message: string } | Refused;

/** The MX list as it now stands, after a refusal too when it could be read, so the page picks up another admin's changes. */
export type MxResult = { ok: true; members: MxView[]; message: string } | (Refused & { members?: MxView[] });

/** An added name answers with the whole list as it now stands, so the new name shows in its place. */
export type StaffResult = { ok: true; staff: StaffView[]; message: string; id: string } | Refused;

/** An import answers with the past days that now hold a list, for the section's line. */
export type PastListsResult = { ok: true; view: PastListView; message: string } | Refused;

const NOT_ADMIN: Refused = { ok: false, error: "ทำได้เฉพาะผู้ดูแลระบบ ลองออกจากระบบแล้วเข้าใหม่" };
const FAILED: Refused = { ok: false, error: "บันทึกไม่สำเร็จ ลองอีกครั้ง" };

/** Server actions can be called by anyone who can reach the site, so each one checks the admin again. */
async function signedInAdmin() {
  // getUser() re-checks the signed session and that the phone number is still authorized; admins are listed by LINE user id.
  const user = await getUser();
  return user && isAdmin(user.sub) ? user : null;
}

/**
 * The pages that follow the repair dates or the MX list: the board (rooms, the upload button), the upload page and
 * this page. Revalidating them from the action shows the change at once to whoever opens or refreshes them.
 */
function refreshPages(): void {
  for (const path of ["/", "/upload", "/admin"]) revalidatePath(path);
}

/**
 * Saves both halves' dates and the admin's switch (which rooms the board shows). lib/repair-store.ts checks them again (the form already did, with the same messages) and
 * records the admin's LINE sub as who saved them.
 */
export async function saveRepair(input: {
  half1: { from: string; to: string };
  half2: { from: string; to: string };
  mode?: string;
}): Promise<RepairResult> {
  const user = await signedInAdmin();
  if (!user) return NOT_ADMIN;

  try {
    const pool = await db();
    const saved = await saveRepairPeriods(pool, input, user.sub);
    if (!saved.ok) return { ok: false, error: saved.error };
    refreshPages();
    return { ok: true, repair: await repairViewFrom(pool), message: "บันทึกแล้ว ตารางผ่าตัดของทุกคนเปลี่ยนทันที" };
  } catch (error) {
    console.error("Saving the repair dates failed", error);
    return FAILED;
  }
}

/** Makes an active user MX (ผู้จัดการตาราง). */
export async function grantMx(userId: string): Promise<MxResult> {
  const user = await signedInAdmin();
  if (!user) return NOT_ADMIN;
  const id = userIdOf(userId);
  if (!id) return FAILED;

  try {
    const pool = await db();
    const result = await addMx(pool, id, user.sub);
    const members = await mxMembersFrom(pool);
    if (result === "missing") return { ok: false, error: "ไม่พบชื่อนี้ อาจถูกปิดใช้งานแล้ว", members };
    if (result === "ineligible") return { ok: false, error: "ผู้จัดการตารางต้องเป็น RN-OR เท่านั้น", members };
    if (result === "added") refreshPages();
    const name = members.find((member) => member.userId === id)?.name ?? "ชื่อนี้";
    return { ok: true, members, message: result === "added" ? `เพิ่ม ${name} เป็นผู้จัดการตารางแล้ว` : `${name} เป็นผู้จัดการตารางอยู่แล้ว` };
  } catch (error) {
    console.error("Adding an MX member failed", error);
    return FAILED;
  }
}

/** Takes MX away. Their upload button goes on their next page load, and every upload re-checks the role anyway. */
export async function revokeMx(userId: string): Promise<MxResult> {
  const user = await signedInAdmin();
  if (!user) return NOT_ADMIN;
  const id = userIdOf(userId);
  if (!id) return FAILED;

  try {
    const pool = await db();
    const removed = await removeMx(pool, id);
    const [members, listed] = await Promise.all([mxMembersFrom(pool), getListedUser(pool, id)]);
    if (removed) refreshPages();
    const name = listed ? fullName(listed) : "ชื่อนี้";
    return { ok: true, members, message: removed ? `ถอดสิทธิ์ผู้จัดการตารางของ ${name} แล้ว` : `${name} ไม่ได้เป็นผู้จัดการตารางแล้ว` };
  } catch (error) {
    console.error("Removing an MX member failed", error);
    return { ok: false, error: "ถอดสิทธิ์ไม่สำเร็จ ลองอีกครั้ง" };
  }
}

/**
 * Adds a name to the staff list (Pong, 17 Nov 2026: "on section all name: add user button"), or brings an inactive one
 * back with the type and subtype given (lib/user-admin.ts). A doctor's comes with their email address, anyone else's
 * with their mobile number (Pong, 21 Nov 2026), checked as the form checks them. The person can then sign in with it.
 */
export async function addStaff(input: {
  firstName: string;
  lastName: string;
  type: string;
  subtype: string;
  email?: string;
  phone?: string;
}): Promise<StaffResult> {
  const user = await signedInAdmin();
  if (!user) return NOT_ADMIN;
  const checked = checkNewUser(input ?? {});
  if (!checked.ok) return checked;
  const name = fullName(checked.user);

  try {
    const pool = await db();
    const result = await addUser(pool, checked.user, user.sub);
    if (result.status === "exists") return { ok: false, error: `มี ${name} ในรายชื่ออยู่แล้ว` };
    if (result.status === "email_taken") return { ok: false, error: "อีเมลนี้มีชื่ออื่นใช้แล้ว" };
    if (result.status === "phone_taken") return { ok: false, error: "เบอร์นี้มีชื่ออื่นใช้แล้ว" };
    refreshPages();
    const message = result.status === "added" ? `เพิ่ม ${name} แล้ว` : `เปิดใช้งาน ${name} อีกครั้งแล้ว`;
    return { ok: true, staff: await staffFrom(pool), message, id: result.id };
  } catch (error) {
    console.error("Adding a name failed", (error as Error).message);
    return FAILED;
  }
}

/**
 * Imports past days' lists from a HOSxP export of many days (Pong, 19 Nov 2026: "No case shown on Jan, why ?", then yes
 * to loading the Jan-Oct exports), so the board's calendar shows those days' cases. Each past workday in the file gets
 * the list MX's upload would have given it (lib/past-lists.ts); a day MX uploaded a list for keeps MX's list, and a day
 * an earlier import gave a list gets the new one. Admins only, at any time.
 */
export async function importPastLists(form: FormData): Promise<PastListsResult> {
  try {
    const user = await signedInAdmin();
    if (!user) return NOT_ADMIN;
    const file = form.get("file");
    const problem = fileProblem(file instanceof File ? file : null, { maxBytes: XLSX_LIMITS.maxFileBytes, xlsMessage: XLS_MESSAGE });
    if (problem || !(file instanceof File)) return { ok: false, error: problem ?? "เลือกไฟล์ก่อน" };

    const book = readXlsx(new Uint8Array(await file.arrayBuffer()), PAST_LIMITS);
    if (!book.ok) return { ok: false, error: book.message };
    const at = now();
    const today = bangkokParts(at).date;
    const split = splitByDay(book, today);
    if (!split.ok) return { ok: false, error: split.message };
    if (split.days.length === 0) return { ok: false, error: "ไฟล์นี้ไม่มีวันที่ผ่านมาแล้ว" };

    // Weekends and holidays are left out, as on the board's calendar; without the BOT's holidays nothing is saved.
    const holidays = await holidaysBetween(split.days[0].date, split.days[split.days.length - 1].date);
    if (!holidays.ok) return { ok: false, error: HOLIDAYS_UNAVAILABLE };
    const pool = await db();
    const lists = pastLists(split, { holidays: holidays.holidays, periods: await getRepairPeriods(pool) });
    if (lists.days.length === 0) return { ok: false, error: "ไฟล์นี้ไม่มีวันทำการที่ผ่านมาแล้ว" };

    const saved = await savePastLists(pool, {
      cycleDay: today,
      uploadedAt: at,
      uploadedBy: user.sub,
      uploaderName: await displayNameFor(user, user.name),
      fileName: cleanFileName(file.name),
      lists: lists.days.map((day) => ({
        targetDate: day.date,
        totalRows: day.summary.rows,
        kept: day.summary.kept,
        placed: day.summary.placed,
        summary: day.summary,
        cases: day.cases,
      })),
    });
    refreshPages();

    const placed = lists.days.filter((day) => saved.saved.includes(day.date)).reduce((sum, day) => sum + day.summary.placed, 0);
    const parts = [
      saved.saved.length > 0
        ? `บันทึก ${saved.saved.length} วัน ${thaiDateSpan(saved.saved[0], saved.saved[saved.saved.length - 1])} ลงห้อง ${placed.toLocaleString("en-US")} เคส`
        : "ไม่ได้บันทึกวันใด",
    ];
    if (saved.mxDays.length > 0) parts.push(`ข้าม ${saved.mxDays.length} วันที่ MX อัปโหลดแล้ว`);
    return { ok: true, view: await pastListViewFrom(pool), message: parts.join(" · ") };
  } catch (error) {
    console.error(`[admin] importing past lists failed (${errorKind(error)})`);
    return FAILED;
  }
}
