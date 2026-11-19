import "server-only";
import type { Pool, PoolClient } from "pg";

type Q = Pool | PoolClient;

/**
 * Whether a doctor (users.id) has seen the tutorial (table tutorial_seen). A failed read counts as seen: the tutorial
 * never stands between a doctor and the board.
 */
export async function tutorialSeen(pool: Q, userId: string): Promise<boolean> {
  try {
    const { rowCount } = await pool.query("SELECT 1 FROM tutorial_seen WHERE user_id = $1", [userId]);
    return (rowCount ?? 0) > 0;
  } catch (error) {
    console.error("[tutorial] seen check failed:", (error as Error).message);
    return true;
  }
}

/** Notes that a doctor started or skipped the tutorial, so the board no longer opens it by itself. */
export async function markTutorialSeen(pool: Q, userId: string): Promise<void> {
  await pool.query("INSERT INTO tutorial_seen (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [userId]);
}
