import "server-only";
import type { Pool, PoolClient } from "pg";
import type { AddedCase, CaseInput } from "./added-cases";
import type { PlaceId } from "./places";
import type { Shift } from "./schedule";
import { fullName, userForPhone, userForSession, type ListedUser, type SessionIdentity } from "./user-list";

type Q = Pool | PoolClient;

/**
 * The doctors' added cases (bookings during the repair): table `cases` (db/schema.sql). Only a doctor adds them (a
 * current claim on an active users row of type DR), always as the surgeon, and only that doctor removes them. Checks of
 * the input are in lib/added-cases.ts; the server actions are in app/(board)/actions.ts. The lists carry the HN, the
 * patient's name and the diagnosis: a caller hands them on only to whoever may see them (lib/board-rows.ts).
 */

/** Cases one doctor may add per day (a guard against a runaway script, far above a real list). */
export const DAILY_ADD_LIMIT = 60;

interface CaseRow {
  id: string;
  date: string;
  room_id: string;
  hn: string | null;
  patient_name: string | null;
  diagnosis: string | null;
  operation: string | null;
  shift: Shift;
  dressing: boolean | null;
  scrub_does: boolean | null;
  note: string | null;
  surgeon_id: string;
  first_name: string;
  last_name: string;
  subtype: string | null;
  booked_at: Date;
  edited_at: Date | null;
  start_min: number | null;
  end_min: number | null;
  place: PlaceId;
  api_client: string | null;
  external_id: string | null;
}

const COLUMNS =
  "c.id::text AS id, to_char(c.op_date, 'YYYY-MM-DD') AS date, c.room_id, c.hn, c.patient_name, c.diagnosis, c.operation, c.shift, c.dressing, c.scrub_does, c.note, " +
  "c.surgeon_id::text AS surgeon_id, u.first_name, u.last_name, u.subtype, c.queued_at AS booked_at, c.edited_at, c.start_min, c.end_min, c.place, " +
  "c.api_client, c.external_id::text AS external_id";

function toCase(r: CaseRow): AddedCase {
  return {
    id: r.id,
    date: r.date,
    roomId: r.room_id,
    hn: r.hn,
    // Not given is NULL (db/schema.sql); the app reads it as "".
    patientName: r.patient_name ?? "",
    diagnosis: r.diagnosis ?? "",
    // A booking without a name stores NULL (db/schema.sql); the app reads it as "".
    operation: r.operation ?? "",
    shift: r.shift,
    dressing: r.dressing,
    // Only a dressing-room booking has the answer (the table's CHECK says so).
    scrubDoes: r.dressing ? r.scrub_does : null,
    // No note is NULL (db/schema.sql); the app reads it as "".
    note: r.note ?? "",
    surgeonId: r.surgeon_id,
    surgeon: fullName({ firstName: r.first_name, lastName: r.last_name }),
    subtype: r.subtype,
    // The booking's place in its room's queue (db/schema.sql queued_at): when it was made, or moved to its day, room or
    // patient.
    bookedAt: r.booked_at.toISOString(),
    ...(r.edited_at ? { editedAt: r.edited_at.toISOString() } : {}),
    // Both or neither (db/schema.sql cases_time_check).
    start: r.start_min,
    end: r.end_min,
    // รพ.ท่าฉลอม's bookings say so; รพ.สมุทรสาคร's leave it out, as they always have.
    ...(r.place === "tha-chalom" ? { place: r.place } : {}),
    // A booking the calendar API pushed (lib/calendar-api.ts) says so: it changes at the calendar, not on the board.
    ...(r.api_client ? { via: "calendar" as const } : {}),
  };
}

/**
 * The doctor this session holds (a doctor signed in by email), or null for anyone else (nurses, ALLOWED_PHONES, and any
 * number: a doctor's name never signs in by number, see userForPhone()).
 */
export async function doctorFor(pool: Q, who: string | SessionIdentity): Promise<ListedUser | null> {
  const user = typeof who === "string" ? await userForPhone(pool, who) : await userForSession(pool, who);
  return user?.type === "DR" ? user : null;
}

/**
 * Runs `fn` in a transaction that holds the day's lock: the check that a time is free in its room and the save that takes
 * it (app/(board)/actions.ts) never interleave with another booking's for that day.
 */
export async function withDayLock<T>(pool: Pool, date: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('cases-day:' || $1))", [date]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Every case on one day at one hospital (รพ.สมุทรสาคร unless `place` says otherwise), in queue order. */
export async function listCasesOn(pool: Q, date: string, place: PlaceId = "skh"): Promise<AddedCase[]> {
  const { rows } = await pool.query<CaseRow>(
    `SELECT ${COLUMNS} FROM cases c JOIN users u ON u.id = c.surgeon_id
     WHERE c.op_date = $1 AND c.place = $2 AND c.removed_at IS NULL ORDER BY c.queued_at, c.id`,
    [date, place],
  );
  return rows.map(toCase);
}

/** One doctor's cases at one hospital (รพ.สมุทรสาคร unless `place` says otherwise) from `from` (YYYY-MM-DD) on, by day, then in queue order. */
export async function listCasesBy(pool: Q, surgeonId: string, from: string, place: PlaceId = "skh"): Promise<AddedCase[]> {
  const { rows } = await pool.query<CaseRow>(
    `SELECT ${COLUMNS} FROM cases c JOIN users u ON u.id = c.surgeon_id
     WHERE c.surgeon_id = $1 AND c.op_date >= $2 AND c.place = $3 AND c.removed_at IS NULL ORDER BY c.op_date, c.queued_at, c.id`,
    [surgeonId, from, place],
  );
  return rows.map(toCase);
}

/**
 * Cases this doctor added on the board in the last 24 hours (removed ones included): the calendar API's pushes are not
 * theirs to count (lib/calendar-api.ts has its own limit).
 */
export async function addedToday(pool: Q, surgeonId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM cases WHERE surgeon_id = $1 AND api_client IS NULL AND created_at > now() - interval '24 hours'",
    [surgeonId],
  );
  return rows[0].n;
}

/**
 * Saves a checked case (lib/added-cases.ts checkCase: the HN normalised, the room worked out from the doctor's choice)
 * with this doctor as the surgeon. Returns its id. An empty operation name, patient's name, diagnosis or note is stored
 * as NULL, never as "".
 * `api`: a booking the calendar API pushed, its client and the calendar's own id of the record (lib/calendar-api.ts).
 */
export async function insertCase(
  pool: Q,
  surgeonId: string,
  lineSub: string,
  input: CaseInput,
  api: { client: string; externalId: string } | null = null,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO cases (op_date, room_id, hn, operation, shift, dressing, scrub_does, note, surgeon_id, line_sub, start_min, end_min, place, api_client, external_id, patient_name, diagnosis)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id::text AS id`,
    [
      input.date,
      input.roomId,
      input.hn,
      input.operation || null,
      input.shift,
      input.dressing,
      input.dressing ? input.scrubDoes : null,
      input.note || null,
      surgeonId,
      lineSub,
      input.start,
      input.end,
      input.place ?? "skh",
      api?.client ?? null,
      api?.externalId ?? null,
      input.patientName || null,
      input.diagnosis || null,
    ],
  );
  return rows[0].id;
}

/** One of this doctor's cases that was cancelled (removed), or null. */
export async function removedCase(pool: Q, id: string, surgeonId: string): Promise<AddedCase | null> {
  const { rows } = await pool.query<CaseRow>(
    `SELECT ${COLUMNS} FROM cases c JOIN users u ON u.id = c.surgeon_id WHERE c.id = $1 AND c.surgeon_id = $2 AND c.removed_at IS NOT NULL`,
    [id, surgeonId],
  );
  return rows.length ? toCase(rows[0]) : null;
}

/** One of this doctor's cases that is still booked, or null (another doctor's, removed, or no such case). */
export async function ownCase(pool: Q, id: string, surgeonId: string): Promise<AddedCase | null> {
  const { rows } = await pool.query<CaseRow>(
    `SELECT ${COLUMNS} FROM cases c JOIN users u ON u.id = c.surgeon_id WHERE c.id = $1 AND c.surgeon_id = $2 AND c.removed_at IS NULL`,
    [id, surgeonId],
  );
  return rows.length ? toCase(rows[0]) : null;
}

/**
 * Saves a doctor's edit of their own case in place (lib/added-cases.ts checkCase and bookingChange): the day, room, HN,
 * patient's name, diagnosis, operation, room choice, scrub answer, note and time, with edited_at. `requeue` puts it at the back of its room's queue
 * (queued_at now): a new day, room choice or patient counts as a new booking. The shift and the time it was made stay.
 * Returns false when it is not theirs or was removed meanwhile.
 */
export async function updateCase(pool: Q, id: string, surgeonId: string, input: CaseInput, requeue: boolean): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE cases SET op_date = $3, room_id = $4, hn = $5, operation = $6, dressing = $7, scrub_does = $8, note = $9,
       start_min = $11, end_min = $12, patient_name = $13, diagnosis = $14,
       edited_at = now(), queued_at = CASE WHEN $10 THEN now() ELSE queued_at END
     WHERE id = $1 AND surgeon_id = $2 AND removed_at IS NULL`,
    [
      id,
      surgeonId,
      input.date,
      input.roomId,
      // A closed day's note edit of a booking from before HNs were required keeps it without one.
      input.hn || null,
      input.operation || null,
      input.dressing,
      input.dressing ? input.scrubDoes : null,
      input.note || null,
      requeue,
      input.start,
      input.end,
      input.patientName || null,
      input.diagnosis || null,
    ],
  );
  return rowCount === 1;
}

/**
 * Saves only the note of one of this doctor's cases, with edited_at: the edit of a booking whose day is closed (lib/added-
 * cases.ts bookingState), which leaves its day, room, HN, patient's name, diagnosis, operation's name and room choice as
 * the day's list has them (a booking
 * from before the form asked keeps its NULL room choice). Returns false when it is not theirs or was removed meanwhile.
 */
export async function updateNote(pool: Q, id: string, surgeonId: string, note: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "UPDATE cases SET note = $3, edited_at = now() WHERE id = $1 AND surgeon_id = $2 AND removed_at IS NULL",
    [id, surgeonId, note || null],
  );
  return rowCount === 1;
}

/** How long after a cancel the doctor can book the case back in its old place (restoreCase), in minutes. */
export const UNDO_MINUTES = 10;

/**
 * Books back one of this doctor's cases they cancelled less than UNDO_MINUTES ago, on a day that has not gone (`today`
 * on), in its old place in the queue (queued_at is untouched by a cancel). Returns false otherwise.
 */
export async function restoreCase(pool: Q, id: string, surgeonId: string, today: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE cases SET removed_at = NULL
     WHERE id = $1 AND surgeon_id = $2 AND removed_at IS NOT NULL AND removed_at > now() - make_interval(mins => $3) AND op_date >= $4`,
    [id, surgeonId, UNDO_MINUTES, today],
  );
  return rowCount === 1;
}

/** Removes one of this doctor's cases. Returns false when it is not theirs or was already removed. */
export async function removeCase(pool: Q, id: string, surgeonId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "UPDATE cases SET removed_at = now() WHERE id = $1 AND surgeon_id = $2 AND removed_at IS NULL",
    [id, surgeonId],
  );
  return rowCount === 1;
}

/** A booking the calendar API pushed (lib/calendar-api.ts), with the calendar's id of it and whether it was cancelled. */
export interface CalendarCase {
  booking: AddedCase;
  /** The calendar's own id of the record (cases.external_id). */
  externalId: string;
  /** When it was cancelled (cases.removed_at), an ISO time; null while it is booked. */
  cancelledAt: string | null;
}

interface CalendarRow extends CaseRow {
  removed_at: Date | null;
}

const toCalendarCase = (r: CalendarRow): CalendarCase => ({
  booking: toCase(r),
  externalId: r.external_id ?? "",
  cancelledAt: r.removed_at ? r.removed_at.toISOString() : null,
});

/**
 * The client's booking of one calendar record: the one booked now, else the last one cancelled (the calendar may book a
 * cancelled id again, so there can be several), or null when the calendar never pushed it.
 */
export async function calendarCase(pool: Q, client: string, externalId: string): Promise<CalendarCase | null> {
  const { rows } = await pool.query<CalendarRow>(
    `SELECT ${COLUMNS}, c.removed_at FROM cases c JOIN users u ON u.id = c.surgeon_id
     WHERE c.api_client = $1 AND c.external_id = $2
     ORDER BY (c.removed_at IS NULL) DESC, c.removed_at DESC, c.id DESC LIMIT 1`,
    [client, externalId],
  );
  return rows.length ? toCalendarCase(rows[0]) : null;
}

/** The client's bookings booked now with their day from `from` to `to` (YYYY-MM-DD), by day and queue; at most `limit`. */
export async function calendarCasesBetween(pool: Q, client: string, from: string, to: string, limit: number): Promise<CalendarCase[]> {
  const { rows } = await pool.query<CalendarRow>(
    `SELECT ${COLUMNS}, c.removed_at FROM cases c JOIN users u ON u.id = c.surgeon_id
     WHERE c.api_client = $1 AND c.removed_at IS NULL AND c.op_date BETWEEN $2 AND $3
     ORDER BY c.op_date, c.queued_at, c.id LIMIT $4`,
    [client, from, to, limit],
  );
  return rows.map(toCalendarCase);
}

/** Bookings the client pushed in the last 24 hours (cancelled ones included), for the API's own daily limit. */
export async function calendarAddedToday(pool: Q, client: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM cases WHERE api_client = $1 AND created_at > now() - interval '24 hours'",
    [client],
  );
  return rows[0].n;
}
