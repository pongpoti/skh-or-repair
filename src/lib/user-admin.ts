import "server-only";
import type { Pool } from "pg";
import { EMAIL_RULE, normalizeEmail, normalizePhone, PHONE_RULE } from "./contact";
import { withTx } from "./db";
import { isUserType, subtypeChoices, type UserType } from "./user-labels";
import { HOLDS } from "./user-list";

/**
 * Names added by an admin on /admin (Pong, 17 Nov 2026: "on section all name: add user button"). Until then only
 * scripts/sync-users.mjs wrote `users` (from Pong's CSV); now an admin can add one name at a time too. The row is a
 * plain `users` row (no new column: the table's DDL stays the production one); table `users_added` records that the
 * app added it and who, so the next sync does not set it inactive for missing from the CSV. A name that exists but is
 * inactive comes back with the type and subtype given; an active one is refused.
 *
 * Each name comes with how its person signs in (Pong, 21 Nov 2026: "new DR is requires to input email, new non DR phone
 * number"): a doctor's email address goes to user_emails (the email sign-in sends the code there), anyone else's mobile
 * number to user_phones (only that number may then claim the name by SMS). An address or number another active name
 * already has is refused.
 */

/** As the sync's limit (scripts/users-roster.mjs NAME_MAX). */
const NAME_MAX = 100;

/** `email` for a doctor (DR), `phone` (canonical 0812345678) for everyone else; the other is null. */
export type NewUser = {
  firstName: string;
  lastName: string;
  type: UserType;
  subtype: string;
  email: string | null;
  phone: string | null;
};

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
  email?: unknown;
  phone?: unknown;
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
  if (type === "DR") {
    if (typeof input.email !== "string" || !input.email.trim()) return { ok: false, error: "กรอกอีเมล" };
    const email = normalizeEmail(input.email);
    if (!email) return { ok: false, error: EMAIL_RULE };
    return { ok: true, user: { firstName, lastName, type, subtype, email, phone: null } };
  }
  if (typeof input.phone !== "string" || !input.phone.trim()) return { ok: false, error: "กรอกเบอร์มือถือ" };
  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, error: PHONE_RULE };
  return { ok: true, user: { firstName, lastName, type, subtype, email: null, phone } };
}

export type AddUserResult =
  | { status: "added" | "reactivated"; id: string }
  | { status: "exists" }
  /** Another active name has this email address (a doctor's code would reach both). */
  | { status: "email_taken" }
  /** Another active name has this number, given by an admin or claimed by SMS. */
  | { status: "phone_taken" };

/**
 * Adds the name (or brings an inactive one back) with its email address or number, and records that the app added it;
 * `by` is the admin's LINE sub. A name brought back keeps the addresses it had; its number becomes the one given, and a
 * current claim of it by another number ends ('replaced'). A number an inactive name was given is freed for the new one.
 */
export async function addUser(pool: Pool, user: NewUser, by: string): Promise<AddUserResult> {
  try {
    return await withTx(pool, async (c) => {
      const found = await c.query<{ id: string; active: boolean }>(
        "SELECT id::text AS id, active FROM users WHERE first_name = $1 AND last_name = $2 FOR UPDATE",
        [user.firstName, user.lastName],
      );
      const row = found.rows[0];
      if (row?.active) return { status: "exists" } as const;
      if (user.email) {
        const { rows } = await c.query(
          "SELECT 1 FROM user_emails e JOIN users u ON u.id = e.user_id WHERE e.email = $1 AND u.active AND u.id <> $2",
          [user.email, row?.id ?? 0],
        );
        if (rows.length) return { status: "email_taken" } as const;
      }
      if (user.phone) {
        const { rows } = await c.query(
          `SELECT 1 FROM user_phones p JOIN users u ON u.id = p.user_id WHERE p.phone = $1 AND u.active AND u.id <> $2
           UNION ALL
           SELECT 1 FROM user_claims c JOIN users u ON u.id = c.user_id
           WHERE c.phone = $1 AND c.undone_at IS NULL AND u.active AND ${HOLDS} AND u.id <> $2`,
          [user.phone, row?.id ?? 0],
        );
        if (rows.length) return { status: "phone_taken" } as const;
        // the number of a name that is no longer active is free again
        await c.query("DELETE FROM user_phones p USING users u WHERE u.id = p.user_id AND p.phone = $1 AND NOT u.active", [user.phone]);
      }
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
      if (user.email) {
        await c.query("INSERT INTO user_emails (user_id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, user.email]);
        // a doctor signs in by email only: no number holds the name
        await c.query("DELETE FROM user_phones WHERE user_id = $1", [id]);
      }
      if (user.phone) {
        await c.query(
          `INSERT INTO user_phones (user_id, phone, added_by) VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET phone = excluded.phone, added_by = excluded.added_by, created_at = now()`,
          [id, user.phone, by],
        );
        // a name brought back: a claim of it by another number no longer holds it
        await c.query(
          `UPDATE user_claims SET undone_at = now(), undone_by = NULL, undo_reason = 'replaced'
           WHERE user_id = $1 AND undone_at IS NULL AND phone IS DISTINCT FROM $2`,
          [id, user.phone],
        );
      }
      return { status: row ? "reactivated" : "added", id } as const;
    });
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    if (err.code === "23505") {
      // Another admin gave the same number at the same moment (user_phones_phone_key), or added the same name
      // (users_name_key).
      if (err.constraint === "user_phones_phone_key") return { status: "phone_taken" };
      return { status: "exists" };
    }
    throw e;
  }
}
