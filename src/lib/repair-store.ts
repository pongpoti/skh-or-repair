import "server-only";
import type { Pool, PoolClient } from "pg";
import { db } from "./db";
import { checkRepairPeriods, DEFAULT_REPAIR_PERIODS, type RepairPeriods } from "./repair";

type Q = Pool | PoolClient;

/**
 * The repair's dates, table `repair_periods` (db/schema.sql), which an admin edits on /admin. The board reads them on
 * every request, so a save shows at once. lib/repair.ts holds the room layouts and DEFAULT_REPAIR_PERIODS, the seed.
 */

let warned = false;

/** Logs once per server instance: a database that is down would otherwise log on every page. */
function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  console.warn(`[repair] ${message}; using the planned dates`);
}

interface PeriodRow {
  half: number;
  from_date: string;
  to_date: string;
}

/**
 * Both halves' dates. Falls back to DEFAULT_REPAIR_PERIODS when a half has no row (the seed was removed by hand) or
 * the table cannot be read, so the board keeps the planned layout rather than failing.
 */
export async function getRepairPeriods(pool: Q): Promise<RepairPeriods> {
  try {
    const { rows } = await pool.query<PeriodRow>(
      "SELECT half, to_char(from_date, 'YYYY-MM-DD') AS from_date, to_char(to_date, 'YYYY-MM-DD') AS to_date FROM repair_periods",
    );
    const first = rows.find((row) => row.half === 1);
    const second = rows.find((row) => row.half === 2);
    if (!first || !second) {
      warnOnce("repair_periods has no row for a half");
      return DEFAULT_REPAIR_PERIODS;
    }
    return { half1: { from: first.from_date, to: first.to_date }, half2: { from: second.from_date, to: second.to_date } };
  } catch (error) {
    warnOnce(`repair_periods could not be read (${(error as Error).message})`);
    return DEFAULT_REPAIR_PERIODS;
  }
}

/** The dates for a page: from the database (DATABASE_URL), or the planned dates when there is none or it is down. */
export async function currentRepairPeriods(): Promise<RepairPeriods> {
  let pool: Pool;
  try {
    pool = await db();
  } catch (error) {
    warnOnce(`no database (${(error as Error).message})`);
    return DEFAULT_REPAIR_PERIODS;
  }
  return getRepairPeriods(pool);
}

export type SavedPeriods = { ok: true; periods: RepairPeriods } | { ok: false; error: string };

/**
 * Saves both halves at once (one statement), after the same checks as the admin form (lib/repair.ts
 * checkRepairPeriods); `by` is the admin's LINE sub. A refused input answers with the Thai message to show.
 */
export async function saveRepairPeriods(pool: Q, input: unknown, by: string): Promise<SavedPeriods> {
  const checked = checkRepairPeriods(input);
  if (!checked.ok) return checked;
  const { half1, half2 } = checked.periods;
  await pool.query(
    `INSERT INTO repair_periods (half, from_date, to_date, updated_at, updated_by)
     VALUES (1, $1, $2, now(), $5), (2, $3, $4, now(), $5)
     ON CONFLICT (half) DO UPDATE SET from_date = excluded.from_date, to_date = excluded.to_date,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [half1.from, half1.to, half2.from, half2.to, by],
  );
  return { ok: true, periods: checked.periods };
}
