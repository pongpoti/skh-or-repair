import "server-only";
import type { Pool, PoolClient } from "pg";
import { isAdmin } from "./admin";
import type { BoardViewer } from "./board-rows";
import type { UserType } from "./user-labels";
import { fullName, userForSession, type SessionIdentity } from "./user-list";

type Q = Pool | PoolClient;

/**
 * Roles beyond signing in. ADMIN is the existing admin list (lib/admin.ts, AUTH_ADMIN_LINE_IDS by LINE sub) and may do
 * everything MX may. MX (ผู้จัดการตาราง) uploads the HOSxP workbook: a users row in table `mx_members`, granted and
 * revoked by an admin on /admin. A session is MX through its user (lib/user-list.ts userForSession: the current claim
 * of its number, or a doctor's email claim), so the role ends with the claim or when the user goes inactive. Only a
 * registered nurse of the operating-room unit (type RN, subtype OR) may be MX (Pong, 17 Nov 2026: "only RN-OR are
 * allowed in list"): the picker lists only them, addMx() refuses anyone else, and a member whose row stops being RN-OR
 * (a later sync) keeps the row but not the role.
 */

/** The one type and unit MX is open to. */
export const MX_TYPE = "RN";
export const MX_UNIT = "OR";

/** Whether a users row may hold MX: RN of the OR unit. */
export function mxEligible(type: string, subtype: string | null | undefined): boolean {
  return type === MX_TYPE && subtype?.trim() === MX_UNIT;
}

/** The same rule in SQL, for a users row aliased `u`. */
const ELIGIBLE_SQL = `u.type = '${MX_TYPE}' AND btrim(u.subtype) = '${MX_UNIT}'`;

/** Largest users.id (an integer column). */
const MAX_USER_ID = 2_147_483_647;

/** A users row id from a form: a positive whole number within users.id's range (a number or its digits), or null. */
export function userIdOf(v: unknown): string | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^[1-9]\d{0,9}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 && n <= MAX_USER_ID ? String(n) : null;
}

async function isMember(pool: Q, userId: string): Promise<boolean> {
  const { rowCount } = await pool.query("SELECT 1 FROM mx_members WHERE user_id = $1", [userId]);
  return rowCount === 1;
}

/** Whether the role works for this user: a member whose row is RN-OR. */
async function holdsMx(pool: Q, userId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM mx_members m JOIN users u ON u.id = m.user_id WHERE m.user_id = $1 AND ${ELIGIBLE_SQL}`,
    [userId],
  );
  return rowCount === 1;
}

/** Whether this session's user is an MX member (and RN-OR). */
export async function isMx(pool: Q, user: SessionIdentity): Promise<boolean> {
  const listed = await userForSession(pool, user);
  return listed ? holdsMx(pool, listed.id) : false;
}

/** MX and admins upload the workbook. */
export async function canUpload(pool: Q, user: SessionIdentity): Promise<boolean> {
  return isAdmin(user.sub) || (await isMx(pool, user));
}

/** Who looks at the board, for the HN rule of lib/board-rows.ts: MX and admins see every HN, a doctor their bookings'. */
export async function boardViewer(pool: Q, user: SessionIdentity): Promise<BoardViewer> {
  const listed = await userForSession(pool, user);
  const mx = listed ? await holdsMx(pool, listed.id) : false;
  return { allHn: isAdmin(user.sub) || mx, userId: listed?.id ?? null };
}

/** An MX member, as the admin page lists them. */
export type MxMember = {
  userId: string;
  name: string;
  type: UserType;
  subtype: string | null;
  /** False when the users row went inactive: the role does nothing until it is active again. */
  active: boolean;
  /** False when the row is no longer RN-OR: the role does nothing while it is not. */
  eligible: boolean;
  addedAt: Date;
  /** LINE sub of the admin who granted it. */
  addedBy: string | null;
};

const byThaiName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "th");

export async function listMx(pool: Q): Promise<MxMember[]> {
  const { rows } = await pool.query<{
    user_id: string;
    first_name: string;
    last_name: string;
    type: UserType;
    subtype: string | null;
    active: boolean;
    added_at: Date;
    added_by: string | null;
  }>(
    `SELECT m.user_id::text AS user_id, u.first_name, u.last_name, u.type, u.subtype, u.active, m.added_at, m.added_by
     FROM mx_members m JOIN users u ON u.id = m.user_id`,
  );
  return rows
    .map((r) => ({
      userId: r.user_id,
      name: fullName({ firstName: r.first_name, lastName: r.last_name }),
      type: r.type,
      subtype: r.subtype,
      active: r.active,
      eligible: mxEligible(r.type, r.subtype),
      addedAt: r.added_at,
      addedBy: r.added_by,
    }))
    .sort(byThaiName);
}

/** "added", or why not: already a member, an active user who is not RN-OR, or no such active user. */
export type AddMxResult = "added" | "already" | "ineligible" | "missing";

/** Grants MX to an active RN-OR user; `by` is the admin's LINE sub. */
export async function addMx(pool: Q, userId: string, by: string): Promise<AddMxResult> {
  const id = userIdOf(userId);
  if (!id) return "missing";
  const { rowCount } = await pool.query(
    `INSERT INTO mx_members (user_id, added_by) SELECT u.id, $2 FROM users u WHERE u.id = $1 AND u.active AND ${ELIGIBLE_SQL}
     ON CONFLICT (user_id) DO NOTHING`,
    [id, by],
  );
  if (rowCount === 1) return "added";
  if (await isMember(pool, id)) return "already";
  const { rowCount: active } = await pool.query("SELECT 1 FROM users WHERE id = $1 AND active", [id]);
  return active === 1 ? "ineligible" : "missing";
}

/** Revokes MX. False when the user was not a member. */
export async function removeMx(pool: Q, userId: string): Promise<boolean> {
  const id = userIdOf(userId);
  if (!id) return false;
  const { rowCount } = await pool.query("DELETE FROM mx_members WHERE user_id = $1", [id]);
  return rowCount === 1;
}

/** An active user for the admin's MX picker: name and type only. */
export type PickableUser = { id: string; name: string; type: UserType; subtype: string | null; mx: boolean };

/** Every active user, in Thai name order, with whether they are MX already. */
export async function listActiveUsers(pool: Q): Promise<PickableUser[]> {
  const { rows } = await pool.query<{ id: string; first_name: string; last_name: string; type: UserType; subtype: string | null; mx: boolean }>(
    `SELECT u.id::text AS id, u.first_name, u.last_name, u.type, u.subtype,
            EXISTS (SELECT 1 FROM mx_members m WHERE m.user_id = u.id) AS mx
     FROM users u WHERE u.active`,
  );
  return rows
    .map((r) => ({ id: r.id, name: fullName({ firstName: r.first_name, lastName: r.last_name }), type: r.type, subtype: r.subtype, mx: r.mx }))
    .sort(byThaiName);
}
