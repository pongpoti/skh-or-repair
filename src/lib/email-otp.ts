import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { withTx } from "./db";
import { EMAIL_CODE_TTL_MIN, type EmailFailure, type EmailTransport } from "./email";
import { generateCode, MAX_ATTEMPTS } from "./otp";
import { fullName, getListedUser, type ListedUser } from "./user-list";

type Q = Pool | PoolClient;

/**
 * Doctors (users of type DR) sign in with a code sent to their own email addresses (table user_emails, from the
 * hospital's doctor directory) instead of an SMS code. After LINE, the doctor picks their name; the code goes to every
 * address on file for that name, and typing it proves the name: no number, no Telegram undo. The claim
 * (user_claims, via = 'email', phone NULL) belongs to the LINE account, which then signs in without a code for
 * EMAIL_BINDING_MAX_AGE_DAYS. Codes live in email_codes, as an HMAC only.
 */

export const EMAIL_LIMITS = {
  /** Codes to one doctor (from any LINE account) per 15 minutes. */
  perUser15m: 3,
  /** Codes to one doctor for one LINE account per 24 h. */
  perPairDay: 6,
  perSubHour: 5,
  /** Different doctors one LINE account may ask codes for per 24 h. */
  usersPerSubDay: 3,
  perIpHour: 20,
  cooldownS: 60,
} as const;
/** A LINE account whose email code was checked within this many days signs in without a code. */
export const EMAIL_BINDING_MAX_AGE_DAYS = 180;

const DAY_S = 24 * 3600;

/** One name on the doctor page. Whether it has an address is all that leaves the table (never the address). */
export interface DoctorName {
  id: string;
  first_name: string;
  last_name: string;
  subtype: string | null;
  has_email: boolean;
}

/** Active doctors in Thai order, each with whether an email code can be sent to them. */
export async function listDoctors(pool: Q): Promise<DoctorName[]> {
  const { rows } = await pool.query<DoctorName>(
    `SELECT u.id::text AS id, u.first_name, u.last_name, u.subtype,
            EXISTS (SELECT 1 FROM user_emails e WHERE e.user_id = u.id) AS has_email
     FROM users u WHERE u.active AND u.type = 'DR'`,
  );
  return rows.sort((a, b) => a.first_name.localeCompare(b.first_name, "th") || a.last_name.localeCompare(b.last_name, "th"));
}

/** The active doctor with this id and their addresses (none: no code can be sent), or null for anyone else. */
export async function doctorWithEmails(pool: Q, userId: string): Promise<{ user: ListedUser; emails: string[] } | null> {
  const user = await getListedUser(pool, userId);
  if (!user || user.type !== "DR") return null;
  const { rows } = await pool.query<{ email: string; active: boolean }>(
    `SELECT e.email, u.active FROM users u LEFT JOIN user_emails e ON e.user_id = u.id WHERE u.id = $1 ORDER BY e.email`,
    [userId],
  );
  if (!rows.length || !rows[0].active) return null;
  return { user, emails: rows.map((r) => r.email).filter((e): e is string => typeof e === "string") };
}

/** "so•••@gmail.com": enough for the doctor to know which inbox to open, too little to learn the address. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  const local = email.slice(0, at);
  const keep = local.length <= 3 ? 1 : 2;
  return `${local.slice(0, keep)}•••${email.slice(at)}`;
}

/** HMAC-SHA256(OTP_PEPPER, email|userId|sub|code), hex. Only this is stored. */
export function hashEmailCode(pepper: string, userId: string, sub: string, code: string): string {
  return createHmac("sha256", pepper).update(`email|${userId}|${sub}|${code}`, "utf8").digest("hex");
}

function emailCodeMatches(pepper: string, userId: string, sub: string, code: string, storedHex: string): boolean {
  const a = Buffer.from(hashEmailCode(pepper, userId, sub, code), "hex");
  const b = Buffer.from(storedHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type EmailLimitReason = "cooldown" | "user" | "pair_day" | "sub" | "sub_users" | "ip";

type ReserveResult =
  | { status: "reserved"; id: string; sentToday: number }
  | { status: "limited"; reason: EmailLimitReason; retryAfterS: number }
  | { status: "capped"; sentToday: number; retryAfterS: number };

function untilDayWindow(ageS: number | null): number {
  return Math.max(60, Math.ceil(DAY_S - (ageS ?? 0)));
}

/**
 * The rate limits and EMAIL_DAILY_CAP, then a reservation row (expires_at = now, so it cannot be verified yet) that
 * counts for every limit while the email is sent. Serialized by one advisory lock, like reserveCode() in lib/otp.ts.
 */
async function reserveEmailCode(pool: Pool, args: { userId: string; sub: string; ip: string; dailyCap: number }): Promise<ReserveResult> {
  const { userId, sub, ip, dailyCap } = args;
  return withTx(pool, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('email-send'))");
    const { rows } = await c.query<{
      user_15m: number;
      pair_24h: number;
      pair_oldest_s: number | null;
      pair_age_s: number | null;
      sub_1h: number;
      sub_users_24h: number;
      sub_knows_user: boolean | null;
      sub_oldest_s: number | null;
      ip_1h: number;
    }>(
      `SELECT
         count(*) FILTER (WHERE user_id = $1 AND created_at > now() - interval '15 minutes')::int AS user_15m,
         count(*) FILTER (WHERE user_id = $1 AND line_sub = $2)::int AS pair_24h,
         extract(epoch FROM now() - min(created_at) FILTER (WHERE user_id = $1 AND line_sub = $2))::float8 AS pair_oldest_s,
         extract(epoch FROM now() - max(created_at) FILTER (WHERE user_id = $1 AND line_sub = $2))::float8 AS pair_age_s,
         count(*) FILTER (WHERE line_sub = $2 AND created_at > now() - interval '1 hour')::int AS sub_1h,
         count(DISTINCT user_id) FILTER (WHERE line_sub = $2)::int AS sub_users_24h,
         bool_or(line_sub = $2 AND user_id = $1) AS sub_knows_user,
         extract(epoch FROM now() - min(created_at) FILTER (WHERE line_sub = $2))::float8 AS sub_oldest_s,
         count(*) FILTER (WHERE ip = $3 AND created_at > now() - interval '1 hour')::int AS ip_1h
       FROM email_codes
       WHERE created_at > now() - interval '24 hours'
         AND (user_id = $1 OR line_sub = $2 OR (ip = $3 AND created_at > now() - interval '1 hour'))`,
      [userId, sub, ip],
    );
    const r = rows[0];
    if (r.pair_age_s !== null && r.pair_age_s < EMAIL_LIMITS.cooldownS) {
      return { status: "limited", reason: "cooldown", retryAfterS: Math.max(1, Math.ceil(EMAIL_LIMITS.cooldownS - r.pair_age_s)) };
    }
    if (r.user_15m >= EMAIL_LIMITS.perUser15m) return { status: "limited", reason: "user", retryAfterS: 15 * 60 };
    if (r.pair_24h >= EMAIL_LIMITS.perPairDay) {
      return { status: "limited", reason: "pair_day", retryAfterS: untilDayWindow(r.pair_oldest_s) };
    }
    if (r.sub_1h >= EMAIL_LIMITS.perSubHour) return { status: "limited", reason: "sub", retryAfterS: 3600 };
    if (!r.sub_knows_user && r.sub_users_24h >= EMAIL_LIMITS.usersPerSubDay) {
      return { status: "limited", reason: "sub_users", retryAfterS: untilDayWindow(r.sub_oldest_s) };
    }
    if (r.ip_1h >= EMAIL_LIMITS.perIpHour) return { status: "limited", reason: "ip", retryAfterS: 3600 };

    const total = await c.query<{ n: number; oldest_s: number | null }>(
      `SELECT count(*)::int AS n, extract(epoch FROM now() - min(created_at))::float8 AS oldest_s
       FROM email_codes WHERE created_at > now() - interval '24 hours'`,
    );
    const sent = total.rows[0].n;
    if (sent >= dailyCap) return { status: "capped", sentToday: sent, retryAfterS: untilDayWindow(total.rows[0].oldest_s) };

    const ins = await c.query<{ id: string }>(
      "INSERT INTO email_codes (user_id, line_sub, expires_at, ip) VALUES ($1, $2, now(), $3) RETURNING id::text AS id",
      [userId, sub, ip],
    );
    await c.query("DELETE FROM email_codes WHERE created_at < now() - interval '7 days'");
    return { status: "reserved", id: ins.rows[0].id, sentToday: sent + 1 };
  });
}

export type EmailSendResult =
  | { status: "sent"; to: string[]; sentToday: number }
  /** Not an active doctor (or no such user). */
  | { status: "unavailable" }
  /** An active doctor with no address on file: the code cannot be sent. */
  | { status: "no_email" }
  | { status: "limited"; reason: EmailLimitReason; retryAfterS: number }
  | { status: "capped"; sentToday: number; retryAfterS: number }
  | { status: "failed"; reason: EmailFailure };

/**
 * Sends a new code to every address of this doctor, for this LINE account: limits and cap, then the email, then the
 * row is completed (older unused codes of the pair stop working). A failed send removes the reservation. `to` holds
 * the masked addresses, for the page.
 */
export async function sendEmailCode(
  pool: Pool,
  args: { userId: string; sub: string; ip: string; pepper: string; dailyCap: number; transport: EmailTransport },
): Promise<EmailSendResult> {
  const { userId, sub, ip, pepper, dailyCap, transport } = args;
  const doctor = await doctorWithEmails(pool, userId);
  if (!doctor) return { status: "unavailable" };
  if (!doctor.emails.length) return { status: "no_email" };
  const reserved = await reserveEmailCode(pool, { userId, sub, ip, dailyCap });
  if (reserved.status !== "reserved") return reserved;
  const code = generateCode();
  let sent;
  try {
    sent = await transport.sendCode({ to: doctor.emails, code, name: fullName(doctor.user) });
  } catch (e) {
    console.error("[email-otp] sending failed:", (e as Error).message);
    sent = { ok: false as const, reason: "failed" as const };
  }
  if (!sent.ok) {
    await pool.query("DELETE FROM email_codes WHERE id = $1 AND code_hash IS NULL", [reserved.id]);
    return { status: "failed", reason: sent.reason };
  }
  await withTx(pool, async (c) => {
    await c.query(
      "UPDATE email_codes SET expires_at = now() WHERE user_id = $1 AND line_sub = $2 AND used_at IS NULL AND expires_at > now() AND id <> $3",
      [userId, sub, reserved.id],
    );
    await c.query("UPDATE email_codes SET code_hash = $2, expires_at = now() + make_interval(mins => $3) WHERE id = $1", [
      reserved.id,
      hashEmailCode(pepper, userId, sub, code),
      EMAIL_CODE_TTL_MIN,
    ]);
  });
  return { status: "sent", to: doctor.emails.map(maskEmail), sentToday: reserved.sentToday };
}

/** True when this doctor and LINE account have a code that can still be typed in. */
export async function hasLiveEmailCode(pool: Q, userId: string, sub: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM email_codes
     WHERE user_id = $1 AND line_sub = $2 AND used_at IS NULL AND expires_at > now() AND attempts < $3 LIMIT 1`,
    [userId, sub, MAX_ATTEMPTS],
  );
  return rows.length > 0;
}

export type EmailVerifyResult =
  | { ok: true }
  | { ok: false; reason: "invalid"; remaining: number }
  | { ok: false; reason: "locked" }
  | { ok: false; reason: "expired" };

/**
 * Checks a code for this doctor and LINE account: the attempt is counted first in one conditional UPDATE (so parallel
 * guesses never pass MAX_ATTEMPTS), then the HMAC is compared in constant time; success marks the code used (once).
 */
export async function verifyEmailCode(
  pool: Q,
  args: { userId: string; sub: string; code: string; pepper: string },
): Promise<EmailVerifyResult> {
  const { userId, sub, code, pepper } = args;
  const { rows } = await pool.query<{ id: string; code_hash: string | null; attempts: number }>(
    `UPDATE email_codes o SET attempts = o.attempts + 1
     FROM (
       SELECT id FROM email_codes
       WHERE user_id = $1 AND line_sub = $2 AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC, id DESC LIMIT 1
     ) t
     WHERE o.id = t.id AND o.attempts < $3 AND o.used_at IS NULL AND o.expires_at > now()
     RETURNING o.id::text AS id, o.code_hash, o.attempts`,
    [userId, sub, MAX_ATTEMPTS],
  );
  if (!rows.length) {
    const live = await pool.query<{ attempts: number }>(
      `SELECT attempts FROM email_codes
       WHERE user_id = $1 AND line_sub = $2 AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [userId, sub],
    );
    return live.rows.length && live.rows[0].attempts >= MAX_ATTEMPTS ? { ok: false, reason: "locked" } : { ok: false, reason: "expired" };
  }
  const row = rows[0];
  if (/^\d{6}$/.test(code) && row.code_hash && emailCodeMatches(pepper, userId, sub, code, row.code_hash)) {
    const used = await pool.query("UPDATE email_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id", [row.id]);
    return used.rowCount === 1 ? { ok: true } : { ok: false, reason: "expired" };
  }
  const remaining = Math.max(0, MAX_ATTEMPTS - row.attempts);
  return remaining === 0 ? { ok: false, reason: "locked" } : { ok: false, reason: "invalid", remaining };
}

/** A claim the email sign-in ended because the doctor proved the name again (another LINE account or a number). */
export interface ReplacedClaim {
  phone: string | null;
  lineSub: string;
  lineName: string | null;
}

export type EmailSignInResult =
  | { status: "signed_in"; user: ListedUser; created: boolean; replaced: ReplacedClaim | null }
  /** Not an active doctor any more. */
  | { status: "unavailable" }
  /** This LINE account holds someone else's (active) name. */
  | { status: "line_has_claim" };

/**
 * After a good email code: this LINE account holds the doctor's name (user_claims, via = 'email'), in one
 * transaction. Already so: only email_verified_at moves. A current claim of the name by another LINE account or by a
 * number ends ('replaced'; the number's LINE bindings go, so it signs out), since the code went to the doctor's own
 * addresses. A current claim of this LINE account on an inactive name ends ('inactive'); on another active name the
 * sign-in is refused. Logged as 'login_email' in login_events. `users` is only read.
 */
export async function signInByEmail(
  pool: Pool,
  r: { userId: string; sub: string; lineName: string; ip: string; userAgent: string },
): Promise<EmailSignInResult> {
  return withTx(pool, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('claim-sub:' || $1))", [r.sub]);
    await c.query("SELECT pg_advisory_xact_lock(hashtext('claim-user:' || $1))", [r.userId]);
    const user = await getListedUser(c, r.userId);
    const active = await c.query("SELECT 1 FROM users WHERE id = $1 AND active AND type = 'DR'", [r.userId]);
    if (!user || !active.rowCount) return { status: "unavailable" };
    const lineName = r.lineName.slice(0, 200) || null;
    const log = () =>
      c.query("INSERT INTO login_events (line_sub, phone, event, ip, user_agent) VALUES ($1, NULL, 'login_email', $2, $3)", [
        r.sub,
        r.ip,
        r.userAgent,
      ]);

    const { rows: current } = await c.query<{ id: string; phone: string | null; line_sub: string; line_name: string | null; via: string }>(
      "SELECT id::text AS id, phone, line_sub, line_name, via FROM user_claims WHERE user_id = $1 AND undone_at IS NULL",
      [r.userId],
    );
    const mine = current[0];
    if (mine && mine.via === "email" && mine.line_sub === r.sub) {
      await c.query("UPDATE user_claims SET email_verified_at = now(), line_name = $2 WHERE id = $1", [mine.id, lineName]);
      await log();
      return { status: "signed_in", user, created: false, replaced: null };
    }

    // This LINE account's own current claim on another name: an inactive one ends, an active one refuses.
    const { rows: held } = await c.query<{ id: string; active: boolean }>(
      `SELECT c.id::text AS id, u.active FROM user_claims c JOIN users u ON u.id = c.user_id
       WHERE c.line_sub = $1 AND c.undone_at IS NULL AND c.user_id <> $2`,
      [r.sub, r.userId],
    );
    if (held.length && held[0].active) return { status: "line_has_claim" };
    if (held.length) {
      await c.query("UPDATE user_claims SET undone_at = now(), undone_by = NULL, undo_reason = 'inactive' WHERE id = $1", [held[0].id]);
    }

    let replaced: ReplacedClaim | null = null;
    if (mine) {
      await c.query("UPDATE user_claims SET undone_at = now(), undone_by = NULL, undo_reason = 'replaced' WHERE id = $1", [mine.id]);
      if (mine.phone) await c.query("DELETE FROM line_bindings WHERE phone = $1", [mine.phone]);
      replaced = { phone: mine.phone, lineSub: mine.line_sub, lineName: mine.line_name };
    }
    await c.query(
      `INSERT INTO user_claims (user_id, phone, line_sub, line_name, ip, via, email_verified_at)
       VALUES ($1, NULL, $2, $3, $4, 'email', now())`,
      [r.userId, r.sub, lineName, r.ip],
    );
    await log();
    return { status: "signed_in", user, created: true, replaced };
  });
}

/** True when this LINE account holds this doctor's name through an email claim, and the name is active. */
export async function holdsEmailClaim(pool: Q, userId: string, sub: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM user_claims c JOIN users u ON u.id = c.user_id
     WHERE c.user_id = $1 AND c.line_sub = $2 AND c.via = 'email' AND c.undone_at IS NULL AND u.active`,
    [userId, sub],
  );
  return rowCount === 1;
}

/** The doctor this LINE account holds by email, if the code was checked within EMAIL_BINDING_MAX_AGE_DAYS. */
export async function freshEmailClaim(pool: Q, sub: string): Promise<string | null> {
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT c.user_id::text AS user_id FROM user_claims c JOIN users u ON u.id = c.user_id
     WHERE c.line_sub = $1 AND c.via = 'email' AND c.undone_at IS NULL AND u.active
       AND c.email_verified_at > now() - make_interval(days => $2)`,
    [sub, EMAIL_BINDING_MAX_AGE_DAYS],
  );
  return rows.length ? rows[0].user_id : null;
}
