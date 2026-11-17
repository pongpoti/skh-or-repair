import "server-only";
import type { Pool } from "pg";
import { withTx } from "./db";
import { isUserType, subtypeChoices, type UserType } from "./user-labels";

/**
 * Names added by an admin on /admin (Pong, 17 Nov 2026: "on section all name: add user button"). Until then only
 * scripts/sync-users.mjs wrote `users` (from Pong's CSV); now an admin can add one name at a time too. The row is a
 * plain `users` row (no new column: the table's DDL stays the production one); table `users_added` records that the
 * app added it and who, so the next sync does not set it inactive for missing from the CSV. A name that exists but is
 * inactive comes back with the type and subtype given; an active one is refused.
 */

/** As the sync's limit (scripts/users-roster.mjs NAME_MAX). */
const NAME_MAX = 100;

export type NewUser = { firstName: string; lastName: string; type: UserType; subtype: string };

/** As scripts/users-roster.mjs cleanName(): no invisible format characters, one space between words, trimmed, NFC. */
export function cleanName(v: string): string {
  return v.replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim().normalize("NFC");
}

/** The form's fields checked and cleaned, or the first problem in Thai. */
export function checkNewUser(input: {
  firstName?: unknown;
  lastName?: unknown;
  type?: unknown;
  subtype?: unknown;
}): { ok: true; user: NewUser } | { ok: false; error: string } {
  const firstName = typeof input.firstName === "string" ? cleanName(input.firstName) : "";
  const lastName = typeof input.lastName === "string" ? cleanName(input.lastName) : "";
  if (!firstName) return { ok: false, error: "กรอกชื่อ" };
  if (!lastName) return { ok: false, error: "กรอกนามสกุล" };
  for (const v of [firstName, lastName]) {
    if (/\p{Cc}/u.test(v) || Array.from(v).length > NAME_MAX) return { ok: false, error: "ชื่อหรือนามสกุลไม่ถูกต้อง" };
  }
  if (!isUserType(input.type)) return { ok: false, error: "เลือกตำแหน่ง" };
  const type = input.type;
  const subtype = typeof input.subtype === "string" ? input.subtype.trim().toUpperCase() : "";
  if (!subtypeChoices(type).some((choice) => choice.code === subtype)) {
    return { ok: false, error: type === "DR" ? "เลือกสาขา" : "เลือกหน่วย" };
  }
  return { ok: true, user: { firstName, lastName, type, subtype } };
}

export type AddUserResult = { status: "added" | "reactivated"; id: string } | { status: "exists" };

/** Adds the name (or brings an inactive one back) and records that the app added it; `by` is the admin's LINE sub. */
export async function addUser(pool: Pool, user: NewUser, by: string): Promise<AddUserResult> {
  try {
    return await withTx(pool, async (c) => {
      const found = await c.query<{ id: string; active: boolean }>(
        "SELECT id::text AS id, active FROM users WHERE first_name = $1 AND last_name = $2 FOR UPDATE",
        [user.firstName, user.lastName],
      );
      const row = found.rows[0];
      if (row?.active) return { status: "exists" } as const;
      let id: string;
      if (row) {
        await c.query("UPDATE users SET type = $2, subtype = $3, active = true, updated_at = now() WHERE id = $1", [
          row.id,
          user.type,
          user.subtype,
        ]);
        id = row.id;
      } else {
        const ins = await c.query<{ id: string }>(
          "INSERT INTO users (first_name, last_name, type, subtype) VALUES ($1, $2, $3, $4) RETURNING id::text AS id",
          [user.firstName, user.lastName, user.type, user.subtype],
        );
        id = ins.rows[0].id;
      }
      await c.query(
        `INSERT INTO users_added (user_id, added_by) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET added_by = excluded.added_by, added_at = now()`,
        [id, by],
      );
      return { status: row ? "reactivated" : "added", id } as const;
    });
  } catch (e) {
    // The same name added at the same moment by another admin (users_name_key).
    if ((e as { code?: string }).code === "23505") return { status: "exists" };
    throw e;
  }
}
