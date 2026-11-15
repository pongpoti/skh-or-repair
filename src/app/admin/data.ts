import "server-only";
import type { Pool } from "pg";
import { today } from "@/lib/clock";
import { db } from "@/lib/db";
import { DEFAULT_REPAIR_PERIODS, type RepairPeriods } from "@/lib/repair";
import { getRepairPeriods } from "@/lib/repair-store";
import { listActiveUsers, listMx, type MxMember } from "@/lib/roles";
import { thaiDateTime } from "@/lib/telegram";
import { roleLabel } from "@/lib/user-labels";

/**
 * What the admin page's two repair-phase sections show (components/repair-periods-form.tsx and mx-members.tsx), shaped
 * on the server: dates and times are written out here in Bangkok time, so the browser's own clock and Thai calendar
 * data cannot make the page differ from what the server rendered. The page and the server actions both use these, so a
 * save answers with exactly what a fresh page would show.
 */

/** The repair's dates for the form, with who saved them last. */
export type RepairView = {
  periods: RepairPeriods;
  /** "14 พ.ย. 2569 15:32 น." and the admin's name; null while the planned dates have never been saved over. */
  changed: { at: string; by: string } | null;
  /** True when the table could not be read: the form shows the planned dates and says so. */
  fallback: boolean;
  /** Today in Thailand (lib/clock.ts), to mark the half that is running. */
  today: string;
};

/** An MX member as the list shows them. */
export type MxView = {
  userId: string;
  name: string;
  /** "พยาบาล · ห้องผ่าตัด". */
  role: string;
  /** False when the users row went inactive: the role does nothing until it is active again. */
  active: boolean;
  /** "14 พ.ย. 2569". */
  addedOn: string;
};

/** An active user the admin can make MX: name and role only. */
export type PickView = { id: string; name: string; role: string };

export type MxData = { members: MxView[]; users: PickView[] };

/** Shown when the admin who saved is not found any more (their claim ended and LINE never gave a name). */
const UNKNOWN_ADMIN = "ผู้ดูแลระบบ";

const addedOnFormat = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" });

/**
 * Who saved the dates last and when. repair_periods.updated_by is the admin's LINE sub, which means nothing to a reader,
 * so it is named as the board names people (lib/auth/display-name.ts): the name their LINE account currently holds,
 * else their LINE display name. Both halves are saved in one statement, so the newest row speaks for both; a row the
 * seed wrote has no updated_by and means nobody has changed the planned dates.
 */
async function lastChange(pool: Pool): Promise<RepairView["changed"]> {
  const { rows } = await pool.query<{ updated_at: Date; updated_by: string | null; claimed: string | null; line_name: string | null }>(
    `SELECT r.updated_at, r.updated_by,
            (SELECT u.first_name || ' ' || u.last_name FROM user_claims c JOIN users u ON u.id = c.user_id
             WHERE c.line_sub = r.updated_by AND c.undone_at IS NULL LIMIT 1) AS claimed,
            (SELECT b.display_name FROM line_bindings b WHERE b.line_sub = r.updated_by) AS line_name
     FROM repair_periods r
     ORDER BY r.updated_by IS NULL, r.updated_at DESC
     LIMIT 1`,
  );
  const row = rows[0];
  if (!row?.updated_by) return null;
  return { at: thaiDateTime(row.updated_at), by: row.claimed ?? (row.line_name?.trim() || UNKNOWN_ADMIN) };
}

/** The form's data from an open pool (after a save, too). */
export async function repairViewFrom(pool: Pool): Promise<RepairView> {
  let changed: RepairView["changed"] = null;
  let fallback = false;
  try {
    changed = await lastChange(pool);
  } catch (error) {
    // getRepairPeriods() falls back to the planned dates on its own and logs once; this only decides the form's notice.
    console.error("[admin] reading who saved the repair dates failed:", (error as Error).message);
    fallback = true;
  }
  return { periods: await getRepairPeriods(pool), changed, fallback, today: today() };
}

/** The form's data for the page. Never throws: without a database the form shows the planned dates and says so. */
export async function loadRepairView(): Promise<RepairView> {
  try {
    return await repairViewFrom(await db());
  } catch (error) {
    console.error("[admin] no database for the repair dates:", (error as Error).message);
    return { periods: DEFAULT_REPAIR_PERIODS, changed: null, fallback: true, today: today() };
  }
}

function memberView(member: MxMember): MxView {
  return {
    userId: member.userId,
    name: member.name,
    role: roleLabel(member.type, member.subtype),
    active: member.active,
    addedOn: addedOnFormat.format(member.addedAt),
  };
}

export async function mxMembersFrom(pool: Pool): Promise<MxView[]> {
  return (await listMx(pool)).map(memberView);
}

/** The MX list and the names to pick from, or null when the database cannot be read (the section says so). */
export async function loadMxData(): Promise<MxData | null> {
  try {
    const pool = await db();
    const [members, users] = await Promise.all([mxMembersFrom(pool), listActiveUsers(pool)]);
    return { members, users: users.map((user) => ({ id: user.id, name: user.name, role: roleLabel(user.type, user.subtype) })) };
  } catch (error) {
    console.error("[admin] reading the MX list failed:", (error as Error).message);
    return null;
  }
}
