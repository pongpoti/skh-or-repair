import "server-only";
import type { Pool, PoolClient } from "pg";
import { rangeText } from "./booking-time";
import {
  describeChanges,
  logDay,
  logRoom,
  logTime,
  placeName,
  placesOf,
  type LogEntry,
  type LogEvent,
  type LogKind,
  type LogVia,
} from "./booking-log";
import { displayHn } from "./hn";
import type { PlaceId } from "./places";
import { fullName } from "./user-list";

type Q = Pool | PoolClient;

/** The most bookings the log loads, the latest made first (far above the repair's whole list). */
export const LOG_LIMIT = 3000;

interface BookingRow {
  id: string;
  place: PlaceId;
  room_id: string;
  date: string;
  start_min: number | null;
  end_min: number | null;
  hn: string | null;
  patient_name: string | null;
  diagnosis: string | null;
  operation: string | null;
  dressing: boolean | null;
  note: string | null;
  surgeon_id: string;
  first_name: string;
  last_name: string;
  subtype: string | null;
  api_client: string | null;
  created_at: Date;
  removed_at: Date | null;
}

interface EventRow {
  id: string;
  case_id: string;
  at: Date;
  kind: LogKind;
  via: LogVia;
  changes: unknown;
}

/**
 * Every booking (table cases, cancelled ones included), the latest made first, at most `limit`, each with its history
 * (case_events) oldest first. A booking without any history (none should be: the trigger and the schema's one-time fill
 * write it) still shows, as booked when it was made. `truncated` says there were more than `limit`.
 */
export async function loadBookingLog(pool: Q, limit = LOG_LIMIT): Promise<{ entries: LogEntry[]; truncated: boolean }> {
  const { rows } = await pool.query<BookingRow>(
    `SELECT c.id::text AS id, c.place, c.room_id, to_char(c.op_date, 'YYYY-MM-DD') AS date, c.start_min, c.end_min, c.hn,
       c.patient_name, c.diagnosis, c.operation, c.dressing, c.note, c.surgeon_id::text AS surgeon_id, u.first_name,
       u.last_name, u.subtype, c.api_client, c.created_at, c.removed_at
     FROM cases c JOIN users u ON u.id = c.surgeon_id
     ORDER BY c.created_at DESC, c.id DESC LIMIT $1`,
    [limit + 1],
  );
  const truncated = rows.length > limit;
  const bookings = rows.slice(0, limit);
  const byCase = new Map<string, EventRow[]>();
  if (bookings.length) {
    const { rows: events } = await pool.query<EventRow>(
      `SELECT id::text AS id, case_id::text AS case_id, at, kind, via, changes FROM case_events
       WHERE case_id = ANY($1::bigint[]) ORDER BY at, id`,
      [bookings.map((b) => b.id)],
    );
    for (const event of events) {
      const list = byCase.get(event.case_id) ?? [];
      list.push(event);
      byCase.set(event.case_id, list);
    }
  }
  return { entries: bookings.map((row) => toEntry(row, byCase.get(row.id) ?? [])), truncated };
}

function toEntry(row: BookingRow, events: readonly EventRow[]): LogEntry {
  const via: LogVia = row.api_client ? "calendar" : "board";
  // The hospital it is at now; walking the history back from it names each event's rooms at the hospital of the time.
  let place: string = row.place;
  const shown: LogEvent[] = [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    const places = placesOf(event.changes, place);
    shown.unshift({
      id: event.id,
      kind: event.kind,
      via: event.via,
      at: event.at.toISOString(),
      atText: logTime(event.at),
      changes: event.kind === "edit" || event.kind === "move" ? describeChanges(event.changes, places) : [],
    });
    place = places.before;
  }
  if (!shown.some((e) => e.kind === "book")) {
    shown.unshift({ id: `made-${row.id}`, kind: "book", via, at: row.created_at.toISOString(), atText: logTime(row.created_at), changes: [] });
  }
  return {
    id: row.id,
    place: row.place,
    placeName: placeName(row.place),
    room: logRoom(row.place, row.room_id),
    date: row.date,
    dateText: logDay(row.date),
    time: row.start_min !== null && row.end_min !== null ? rangeText({ start: row.start_min, end: row.end_min }) : "",
    hn: row.hn ? displayHn(row.hn) : "",
    patient: row.patient_name ?? "",
    diagnosis: row.diagnosis ?? "",
    operation: row.operation ?? "",
    dressing: row.dressing === true,
    note: row.note ?? "",
    doctorId: row.surgeon_id,
    doctor: fullName({ firstName: row.first_name, lastName: row.last_name }),
    specialty: row.subtype ?? "",
    via,
    bookedAt: row.created_at.toISOString(),
    bookedAtText: logTime(row.created_at),
    cancelled: row.removed_at !== null,
    events: shown,
  };
}
