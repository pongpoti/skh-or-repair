"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/admin";
import { getUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { saveRepairPeriods } from "@/lib/repair-store";
import { addMx, removeMx, userIdOf } from "@/lib/roles";
import { fullName, getListedUser } from "@/lib/user-list";
import { mxMembersFrom, repairViewFrom, type MxView, type RepairView } from "./data";

type Refused = { ok: false; error: string };

/** A saved repair date answers with the form's data as a fresh page would show it (who saved, and when). */
export type RepairResult = { ok: true; repair: RepairView; message: string } | Refused;

/** The MX list as it now stands, after a refusal too when it could be read, so the page picks up another admin's changes. */
export type MxResult = { ok: true; members: MxView[]; message: string } | (Refused & { members?: MxView[] });

const NOT_ADMIN: Refused = { ok: false, error: "เฉพาะผู้ดูแลระบบเท่านั้น ลองออกจากระบบแล้วเข้าใหม่" };
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
 * Saves both halves' dates. lib/repair-store.ts checks them again (the form already did, with the same messages) and
 * records the admin's LINE sub as who saved them.
 */
export async function saveRepair(input: { half1: { from: string; to: string }; half2: { from: string; to: string } }): Promise<RepairResult> {
  const user = await signedInAdmin();
  if (!user) return NOT_ADMIN;

  try {
    const pool = await db();
    const saved = await saveRepairPeriods(pool, input, user.sub);
    if (!saved.ok) return { ok: false, error: saved.error };
    refreshPages();
    return { ok: true, repair: await repairViewFrom(pool), message: "บันทึกแล้ว ตารางผ่าตัดใช้วันที่ใหม่ทันที" };
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
    if (result === "missing") return { ok: false, error: "ไม่พบชื่อนี้ในผู้ใช้ที่ใช้งานอยู่ อาจถูกปิดใช้งานไปแล้ว", members };
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
