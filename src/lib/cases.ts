import "server-only";
import type { Pool, PoolClient } from "pg";
import type { AddedCase, CaseInput } from "./added-cases";
import type { Shift } from "./schedule";
import { fullName, userForPhone, userForSession, type ListedUser, type SessionIdentity } from "./user-list";

type Q = Pool | PoolClient;

/**
 * The doctors' added cases (bookings during the repair): table `cases` (db/schema.sql). Only a doctor adds them (a
 * current claim on an active users row of type DR), always as the surgeon, and only that doctor removes them. Checks of
 * the input are in lib/added-cases.ts; the server actions are in app/(board)/actions.ts. The lists carry the HN: a
 * caller hands it on only to whoever may see it (lib/board-rows.ts).
 */

/** Cases one doctor may add per day (a guard against a runaway script, far above a real list). */
export const DAILY_ADD_LIMIT = 60;

interface CaseRow {
  id: string;
  date: string;
  room_id: string;
  hn: string | null;
  operation: string | null;
  shift: Shift;
  surgeon_id: string;
  first_name: string;
  last_name: string;
  subtype: string | null;
}

const COLUMNS =
  "c.id::text AS id, to_char(c.op_date, 'YYYY-MM-DD') AS date, c.room_id, c.hn, c.operation, c.shift, " +
  "c.surgeon_id::text AS surgeon_id, u.first_name, u.last_name, u.subtype";

function toCase(r: CaseRow): AddedCase {
  return {
    id: r.id,
    date: r.date,
    roomId: r.room_id,
    hn: r.hn,
    // A booking without a name stores NULL (db/schema.sql); the app reads it as "".
    operation: r.operation ?? "",
    shift: r.shift,
    surgeonId: r.surgeon_id,
    surgeon: fullName({ firstName: r.first_name, lastName: r.last_name }),
    subtype: r.subtype,
  };
}

/**
 * The doctor whose current claim holds this number (or this session: a doctor signed in by email), or null for anyone
 * else (nurses, approved requests, ALLOWED_PHONES).
 */
export async function doctorFor(pool: Q, who: string | SessionIdentity): Promise<ListedUser | null> {
  const user = typeof who === "string" ? await userForPhone(pool, who) : await userForSession(pool, who);
  return user?.type === "DR" ? user : null;
}

/** Every case on one day, oldest first. */
export async function listCasesOn(pool: Q, date: string): Promise<AddedCase[]> {
  const { rows } = await pool.query<CaseRow>(
    `SELECT ${COLUMNS} FROM cases c JOIN users u ON u.id = c.surgeon_id
     WHERE c.op_date = $1 AND c.removed_at IS NULL ORDER BY c.created_at, c.id`,
    [date],
  );
  return rows.map(toCase);
}

/** One doctor's cases from `from` (YYYY-MM-DD) on, by day, then in the order they were added. */
export async function listCasesBy(pool: Q, surgeonId: string, from: string): Promise<AddedCase[]> {
  const { rows } = await pool.query<CaseRow>(
    `SELECT ${COLUMNS} FROM cases c JOIN users u ON u.id = c.surgeon_id
     WHERE c.surgeon_id = $1 AND c.op_date >= $2 AND c.removed_at IS NULL ORDER BY c.op_date, c.created_at, c.id`,
    [surgeonId, from],
  );
  return rows.map(toCase);
}

/** Cases this doctor added in the last 24 hours (removed ones included). */
export async function addedToday(pool: Q, surgeonId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM cases WHERE surgeon_id = $1 AND created_at > now() - interval '24 hours'",
    [surgeonId],
  );
  return rows[0].n;
}

/**
 * Saves a checked case (lib/added-cases.ts checkCase: the HN normalised) with this doctor as the surgeon. Returns its id.
 * An empty operation name is stored as NULL, never as "".
 */
export async function insertCase(pool: Q, surgeonId: string, lineSub: string, input: CaseInput): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO cases (op_date, room_id, hn, operation, shift, surgeon_id, line_sub)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text AS id`,
    [input.date, input.roomId, input.hn, input.operation || null, input.shift, surgeonId, lineSub],
  );
  return rows[0].id;
}

/** Removes one of this doctor's cases. Returns false when it is not theirs or was already removed. */
export async function removeCase(pool: Q, id: string, surgeonId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "UPDATE cases SET removed_at = now() WHERE id = $1 AND surgeon_id = $2 AND removed_at IS NULL",
    [id, surgeonId],
  );
  return rowCount === 1;
}
