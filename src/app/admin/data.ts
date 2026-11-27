import "server-only";
import type { Pool } from "pg";
import { today } from "@/lib/clock";
import { db } from "@/lib/db";
import { DEFAULT_REPAIR_PERIODS, shortThaiDate, type RepairPeriods } from "@/lib/repair";
import { getRepairPeriods } from "@/lib/repair-store";
import { listActiveUsers, listMx, mxEligible, type MxMember, type PickableUser } from "@/lib/roles";
import { thaiDateTime } from "@/lib/telegram";
import { roleLabel, subtypeLabel, type UserType } from "@/lib/user-labels";
import { HOLDS } from "@/lib/user-list";
import { listedDays } from "@/lib/workbook-store";

/**
 * What the admin page's sections show (components/repair-periods-form.tsx, mx-members.tsx and staff-list.tsx), shaped
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
  /** False when the row is no longer RN-OR (lib/roles.ts): the role does nothing while it is not. */
  eligible: boolean;
  /** "14 พ.ย. 2569". */
  addedOn: string;
};

/** An active RN-OR user the admin can make MX (lib/roles.ts): name and role only. */
export type PickView = { id: string; name: string; role: string };

export type MxData = { members: MxView[]; users: PickView[] };

/**
 * A name of the staff list (table `users`, loaded by scripts/sync-users.mjs), as the admin's all-names list shows it:
 * the type and subtype codes to filter by, and the subtype in Thai.
 */
export type StaffView = {
  id: string;
  name: string;
  type: UserType;
  /** The code: ORTHO, OBGYN, ... for doctors, OR or ANES for nurses and assistants. */
  subtype: string;
  /** "ออร์โธปิดิกส์", "ห้องผ่าตัด"; the code itself when the app has no Thai name for it. */
  subtypeName: string;
};

/** The two sections that list people: the MX list with its picker, and the all-names list. Null when unreadable. */
export type PeopleData = { mx: MxData | null; staff: StaffView[] | null };

/** Shown when the admin who saved is not found any more (their claim ended and LINE never gave a name). */
const UNKNOWN_ADMIN = "ผู้ดูแลระบบ";

const addedOnFormat = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" });

/**
 * Who saved the dates last and when. repair_periods.updated_by is the admin's LINE sub, which means nothing to a reader,
 * so it is named as the board names people (lib/auth/display-name.ts): the active name their LINE account currently
 * holds (user-list HOLDS), else their LINE display name. Both halves and the switch (schedule_mode) are saved in one
 * statement, so the newest row speaks for all; a row the seed wrote has no updated_by and means nobody has changed the
 * planned dates.
 */
async function lastChange(pool: Pool): Promise<RepairView["changed"]> {
  const { rows } = await pool.query<{ updated_at: Date; updated_by: string | null; claimed: string | null; line_name: string | null }>(
    `SELECT r.updated_at, r.updated_by,
            (SELECT u.first_name || ' ' || u.last_name FROM user_claims c JOIN users u ON u.id = c.user_id
             WHERE c.line_sub = r.updated_by AND c.undone_at IS NULL AND u.active AND ${HOLDS} LIMIT 1) AS claimed,
            (SELECT b.display_name FROM line_bindings b WHERE b.line_sub = r.updated_by) AS line_name
     FROM (SELECT updated_at, updated_by FROM repair_periods UNION ALL SELECT updated_at, updated_by FROM schedule_mode) r
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
    eligible: member.eligible,
    addedOn: addedOnFormat.format(member.addedAt),
  };
}

export async function mxMembersFrom(pool: Pool): Promise<MxView[]> {
  return (await listMx(pool)).map(memberView);
}

function staffView(user: PickableUser): StaffView {
  const subtype = user.subtype?.trim() ?? "";
  return { id: user.id, name: user.name, type: user.type, subtype, subtypeName: subtypeLabel(user.type, subtype) ?? subtype };
}

/** The all-names list as it now stands (after an admin added a name). */
export async function staffFrom(pool: Pool): Promise<StaffView[]> {
  return (await listActiveUsers(pool)).map(staffView);
}

/**
 * The MX list, the names to pick from, and the all-names list, from one read of the active users. Never throws: when
 * the database cannot be read both sections say so and the rest of the page still opens.
 */
export async function loadPeople(): Promise<PeopleData> {
  try {
    const pool = await db();
    const [members, users] = await Promise.all([mxMembersFrom(pool), listActiveUsers(pool)]);
    return {
      // Only RN of the OR unit may be MX (Pong, 17 Nov 2026), so only they are offered.
      mx: {
        members,
        users: users
          .filter((user) => mxEligible(user.type, user.subtype))
          .map((user) => ({ id: user.id, name: user.name, role: roleLabel(user.type, user.subtype) })),
      },
      staff: users.map(staffView),
    };
  } catch (error) {
    console.error("[admin] reading the users failed:", (error as Error).message);
    return { mx: null, staff: null };
  }
}

/** A day with HOSxP lists, for the reset section (components/hosxp-reset-section.tsx). */
export type ListedDayView = {
  date: string;
  /** "30 พ.ย. 2569". */
  label: string;
  /** "45 เคส · ท่าฉลอม 3 · อัปโหลด 2 ครั้ง · ล่าสุด 27 พ.ย. 2569 15:16 น. โดย …". */
  detail: string;
};

/** The days from today on that hold HOSxP lists (lib/workbook-store.ts listedDays), shaped for the page. */
export async function listedDaysFrom(pool: Pool): Promise<ListedDayView[]> {
  const days = await listedDays(pool, today());
  return days.map((day) => {
    const parts = [`${day.skh} เคส`];
    if (day.thaChalom > 0) parts.push(`ท่าฉลอม ${day.thaChalom}`);
    if (day.uploads > 1) parts.push(`อัปโหลด ${day.uploads} ครั้ง`);
    parts.push(`ล่าสุด ${thaiDateTime(day.latestAt)} โดย ${day.latestBy}`);
    return { date: day.date, label: shortThaiDate(day.date), detail: parts.join(" · ") };
  });
}

/** The same for the page, or null when the tables cannot be read. */
export async function loadListedDays(): Promise<ListedDayView[] | null> {
  try {
    return await listedDaysFrom(await db());
  } catch (error) {
    console.error(`[admin] listed days unavailable (${(error as Error).name})`);
    return null;
  }
}
