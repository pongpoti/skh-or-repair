import "server-only";
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  addDays,
  bookAheadDays,
  bookedChoice,
  bookedRoom,
  bookingChange,
  bookingState,
  checkCase,
  deptRooms,
  firstBookingDay,
  isIsoDate,
  placeRoomName,
  roomAmong,
  timeOf,
  type AddedCase,
  type CaseErrorCode,
  type CaseInput,
} from "./added-cases";
import { startedToday } from "./booking-started";
import { checkTime, clockText } from "./booking-time";
import {
  calendarAddedToday,
  calendarCase,
  calendarCasesBetween,
  insertCase,
  listCasesOn,
  removeCase,
  updateCase,
  withDayLock,
  type CalendarCase,
} from "./cases";
import { bangkokParts, now } from "./clock";
import { calendarApiKeyHashes, ConfigError } from "./env";
import { holidaysBetween } from "./holidays";
import type { RepairPeriods } from "./repair";
import { getRepairPeriods } from "./repair-store";
import { safeEqual } from "./security";
import { normaliseName } from "./surgeons";
import { searchKey } from "./user-labels";

/**
 * The calendar API (Pong, 27 Nov 2026): a CVT surgeon's own calendar (its backend, on the hospital's network) books, moves
 * and cancels his cases on the board, server to server, with GET, POST, PUT and DELETE on /api/v1/calendar/cases
 * (src/app/api/v1/calendar/cases). Pong's decision card: "Yes, as the doctor's bookings": each calendar record is a
 * booking (cases) of the doctor it names, in that doctor's department room for its day, under the same rules as the
 * booking form (the 15:00 cut-off, 60 days ahead, workdays, holidays, the department's room; times may overlap, as Pong
 * asked for the board the same evening: "allow time of each case to be freely overlapped");
 * "This API is optionally for CVT surgeons. The manual booking is still mainstay": only doctors whose department
 * (users.subtype) is CVT can be named.
 *
 * Only what a booking holds is read from a record: the calendar's id, the operation's day and time, the HN, the planned
 * operation and the doctor's name (and its type, which must be Surgery). Everything else it sends (the patient's name,
 * national id, age, diagnosis, history, right to treatment, notes, remarks, links, admit day, status) is never read
 * past its key's name, stored, logged or sent back. No answer carries an HN or an operation either, so a stolen key
 * cannot list patients (it can still tell whether a guessed HN is booked with a CVT doctor on a day: 409 already_booked).
 * Log lines carry the method, the calendar's id, the status and a code, nothing else.
 */

/** The one caller for now, stored in cases.api_client; its bookings' line_sub is "api:calendar". */
export const CALENDAR_CLIENT = "calendar";
const LINE_SUB = `api:${CALENDAR_CLIENT}`;
/** Departments (users.subtype) whose doctors the calendar may book for (Pong, 27 Nov 2026). */
export const CALENDAR_DEPARTMENTS: ReadonlySet<string> = new Set(["CVT"]);
/** Bookings the calendar may push in 24 hours (cancelled ones included): a runaway sync stops here. */
export const CALENDAR_DAILY_LIMIT = 200;
/** The largest body read, in bytes: a record with Thai text is about 1 KB. */
export const CALENDAR_MAX_BODY = 16 * 1024;
/** The most records one GET of the list returns, and the longest span of days it covers. */
export const CALENDAR_LIST_LIMIT = 500;
export const CALENDAR_LIST_DAYS = 366;

/** What a handler answers: the route turns it into JSON (lib/http.ts json, no-store). */
export type ApiReply = { status: number; body: unknown; headers?: Record<string, string> };

/** Machine codes of the answers, besides checkCase's (CaseErrorCode). */
export type CalendarErrorCode =
  | CaseErrorCode
  | "not_found"
  | "not_configured"
  | "unavailable"
  | "unauthorized"
  | "browser_not_allowed"
  | "not_json"
  | "too_large"
  | "bad_json"
  | "bad_id"
  | "id_mismatch"
  | "bad_query"
  | "unsupported_type"
  | "no_operation_date"
  | "bad_date_time"
  | "doctor_missing"
  | "doctor_not_found"
  | "doctor_ambiguous"
  | "doctor_not_allowed"
  | "exists"
  | "cancelled"
  | "past"
  | "under_way"
  | "day_closed"
  | "already_booked"
  | "conflict"
  | "rate_limited";

const fail = (status: number, error: CalendarErrorCode, message: string, more: Record<string, unknown> = {}, headers?: Record<string, string>): ApiReply => ({
  status,
  body: { ok: false, error, message, ...more },
  ...(headers ? { headers } : {}),
});

/** A record's or a path's id: a whole number from 1 to 15 digits (the calendar's own id). */
export function calendarId(raw: unknown): string | null {
  if (typeof raw === "number") return Number.isSafeInteger(raw) && raw > 0 && raw < 1e15 ? String(raw) : null;
  if (typeof raw === "string" && /^[1-9][0-9]{0,14}$/.test(raw)) return raw;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The key

/** The key's form: "skhor_" and 43 base64url characters (scripts/calendar-api-key.mjs), so a leaked one is easy to spot. */
const BEARER = /^Bearer\s+(skhor_[A-Za-z0-9_-]{43})$/;

/**
 * Checks the caller before anything else (the body is not read until this passes): the API is on (CALENDAR_API_KEY_SHA256
 * set, else 404 as if it were not there), the call is not from a browser (an Origin header: no page may use the key;
 * there are no CORS headers either), and its bearer key hashes to one of the hashes kept. Every hash is compared, in
 * constant time. Returns null when the caller may go on.
 */
export function checkCaller(headers: Headers): ApiReply | null {
  let hashes: string[] | null;
  try {
    hashes = calendarApiKeyHashes();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`[calendar-api] not configured: ${error.names.join(", ")}`);
      return fail(503, "not_configured", "ระบบยังไม่พร้อม ติดต่อผู้ดูแล");
    }
    throw error;
  }
  if (!hashes) return fail(404, "not_found", "ไม่พบ");
  if (headers.get("origin") !== null) return fail(403, "browser_not_allowed", "ใช้จากเว็บเบราว์เซอร์ไม่ได้");
  const match = BEARER.exec(headers.get("authorization")?.trim() ?? "");
  const hash = match ? createHash("sha256").update(match[1], "utf8").digest("hex") : "";
  let ok = false;
  for (const kept of hashes) ok = safeEqual(hash, kept) || ok;
  if (!match || !ok) return fail(401, "unauthorized", "คีย์ไม่ถูกต้อง", {}, { "WWW-Authenticate": 'Bearer realm="calendar"' });
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The record

/** The keys a record's fields are read from; every other key is ignored (named in the answer's `ignored`). */
const READ = new Set(["id", "type", "operationStart", "operationEnd", "hn", "planOperation", "doctorName"]);

/** Why a record's time was not saved with its booking, which is then saved without one. */
export type TimeWarning = "no_end" | "outside_hours" | "end_not_same_day";

const TIME_WARNING_TEXT: Readonly<Record<TimeWarning, string>> = {
  no_end: "ไม่มีเวลาสิ้นสุด บันทึกแบบไม่ระบุเวลา",
  outside_hours: "เวลาต้องอยู่ระหว่าง 08:30–15:30 ทีละ 15 นาที บันทึกแบบไม่ระบุเวลา",
  end_not_same_day: "เวลาสิ้นสุดไม่ใช่วันเดียวกัน บันทึกแบบไม่ระบุเวลา",
};

/** What a record says, as a booking needs it. The HN and the operation are checked by checkCase, as the form's are. */
export type CalendarRecord = {
  id: string | null;
  date: string;
  start: number | null;
  end: number | null;
  timeWarning: TimeWarning | null;
  /** The start the record gave (minutes), also when its time was not kept: a closed day's booking keeps its own only for the same start. */
  askedStart: number | null;
  hn: unknown;
  operation: unknown;
  doctorName: string;
};

/**
 * Up to 20 of the key names not read, each a plain name or "?" (never a value): the answer lists them, so the calendar's
 * developer sees what is dropped (and can stop sending the patient's name, national id, age and diagnosis).
 */
function ignoredKeys(body: Record<string, unknown>): string[] {
  return Object.keys(body)
    .filter((key) => !READ.has(key))
    .slice(0, 20)
    .map((key) => (/^[A-Za-z0-9_]{1,40}$/.test(key) ? key : "?"));
}

/**
 * A date and a time as the calendar writes them: "2026-11-17T13:00:00" (no offset: Thailand's time, as its backend
 * writes them), also with seconds' fractions, a space for the T, "Z" or an offset (turned into Thailand's time), or a
 * date alone. Returns the day and the minutes after midnight (null for a date alone or exactly midnight, which a
 * calendar writes for a day with no time), or null when it cannot be read.
 */
export function readDateTime(raw: unknown): { date: string; minutes: number | null } | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,7})?)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(raw.trim());
  if (!m || !isIsoDate(m[1])) return null;
  const [, day, hh, mm, , zone] = m;
  if (hh === undefined) return zone ? null : { date: day, minutes: null };
  const hours = Number(hh);
  const minutes = Number(mm);
  if (hours > 23 || minutes > 59) return null;
  if (!zone) return { date: day, minutes: hours === 0 && minutes === 0 ? null : hours * 60 + minutes };
  const at = new Date(`${day}T${hh}:${mm}:00${zone === "Z" ? "Z" : zone.length === 5 ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone}`);
  if (Number.isNaN(at.getTime())) return null;
  const local = bangkokParts(at);
  return { date: local.date, minutes: local.minutes === 0 ? null : local.minutes };
}

/** Why a record is no operation to book: its type is not Surgery, or it has no operation day yet. */
export type Unscheduled = "not_surgery" | "no_operation_date";

const UNSCHEDULED_TEXT: Readonly<Record<Unscheduled, string>> = {
  not_surgery: "ไม่ใช่ type Surgery ไม่ได้จอง",
  no_operation_date: "ยังไม่มีวันผ่าตัด ไม่ได้จอง",
};

/**
 * Reads a record's fields (READ) into a CalendarRecord, or says it is no operation to book (`unscheduled`: a type other
 * than Surgery, or no operation day yet, which a calendar has while a case waits for its day), or refuses it (an id that
 * is no number, a day or time that cannot be read, no doctor). The time is kept only when it can be a booking's (both
 * ends, on the same day, 08:30 to 15:30 in 15-minute steps); otherwise the booking is saved without one, and the answer
 * says why (`timeWarning`).
 */
export function readRecord(
  body: Record<string, unknown>,
): { ok: true; record: CalendarRecord } | { ok: "unscheduled"; id: string | null; reason: Unscheduled } | { ok: false; reply: ApiReply } {
  const given = body.id !== undefined && body.id !== null;
  const id = given ? calendarId(body.id) : null;
  if (given && id === null) return { ok: false, reply: fail(400, "bad_id", "id ต้องเป็นตัวเลข", { field: "id" }) };
  if (typeof body.type !== "string" || body.type.trim().toLowerCase() !== "surgery") return { ok: "unscheduled", id, reason: "not_surgery" };
  if (body.operationStart === undefined || body.operationStart === null || body.operationStart === "") {
    return { ok: "unscheduled", id, reason: "no_operation_date" };
  }
  const start = readDateTime(body.operationStart);
  if (!start) return { ok: false, reply: fail(422, "bad_date_time", "อ่านวันเวลาผ่าตัดไม่ได้", { field: "operationStart" }) };
  const hasEnd = body.operationEnd !== undefined && body.operationEnd !== null && body.operationEnd !== "";
  const end = hasEnd ? readDateTime(body.operationEnd) : null;
  if (hasEnd && !end) return { ok: false, reply: fail(422, "bad_date_time", "อ่านเวลาสิ้นสุดไม่ได้", { field: "operationEnd" }) };
  if (typeof body.doctorName !== "string" || !body.doctorName.trim()) {
    return { ok: false, reply: fail(422, "doctor_missing", "ใส่ชื่อแพทย์", { field: "doctorName" }) };
  }

  let time: { start: number; end: number } | null = null;
  let timeWarning: TimeWarning | null = null;
  if (start.minutes !== null) {
    if (!end || end.minutes === null) timeWarning = "no_end";
    else if (end.date !== start.date) timeWarning = "end_not_same_day";
    else {
      const checked = checkTime(start.minutes, end.minutes);
      if (checked.ok && checked.time) time = checked.time;
      else timeWarning = "outside_hours";
    }
  }
  return {
    ok: true,
    record: {
      id,
      date: start.date,
      start: time?.start ?? null,
      end: time?.end ?? null,
      timeWarning,
      askedStart: start.minutes,
      hn: body.hn,
      operation: body.planOperation,
      doctorName: body.doctorName,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The doctor

/**
 * Titles before a doctor's name, one or more ("ผศ.นพ."): each ends in its dot (Dr. too; so a name such as นพดล stays whole), a
 * space or none after it; or written out (นายแพทย์, แพทย์หญิง, ทันตแพทย์(หญิง), Dr) with a space after it.
 */
const TITLE = /^(?:(?:ศ|รศ|ผศ|อ|ดร|นพ|น\.\s?พ|พญ|พ\.\s?ญ|ทพ|ทพญ|พ\.อ|พ\.ท|พ\.ต|ร\.อ|ร\.ท|ร\.ต|น\.อ|น\.ท|น\.ต|dr)\.\s*|(?:นายแพทย์|แพทย์หญิง|ทันตแพทย์หญิง|ทันตแพทย์|dr)\s+)/i;

/** "ผศ.นพ. ปกรณ์  หัวใจดี" → "ปกรณ์ หัวใจดี" (normaliseName: no invisible characters, single spaces, NFC). */
export function doctorNameOf(raw: string): string {
  let name = normaliseName(raw);
  for (let i = 0; i < 4; i += 1) {
    const next = name.replace(TITLE, "").trim();
    if (next === name) break;
    name = next;
  }
  return name;
}

type Doctor = { id: string; name: string; subtype: string };

/**
 * The active doctor (users type DR) a record names, or why not: the name without its titles must be one doctor's first
 * and last name exactly, or, failing that, exactly one doctor's with the spaces left out. Never a part of a name, nor a
 * guess. The doctor must be in one of CALENDAR_DEPARTMENTS. The calendar's own doctorId is not ours and is not used.
 */
export async function findDoctor(pool: Pool | PoolClient, rawName: string): Promise<{ ok: true; doctor: Doctor } | { ok: false; reply: ApiReply }> {
  const name = doctorNameOf(rawName);
  const { rows } = await pool.query<{ id: string; first_name: string; last_name: string; subtype: string }>(
    "SELECT id::text AS id, first_name, last_name, subtype FROM users WHERE active AND type = 'DR'",
  );
  const doctors = rows.map((r) => ({ id: r.id, name: normaliseName(`${r.first_name} ${r.last_name}`), subtype: r.subtype }));
  let found = doctors.filter((d) => d.name === name);
  if (found.length === 0) found = doctors.filter((d) => searchKey(d.name) === searchKey(name));
  // `searched`: the name looked for, without its titles (a doctor's name, never a patient's), for the developer to check.
  if (found.length === 0) return { ok: false, reply: fail(422, "doctor_not_found", "ไม่พบชื่อแพทย์ในรายชื่อ", { field: "doctorName", searched: name }) };
  if (found.length > 1) return { ok: false, reply: fail(422, "doctor_ambiguous", "ชื่อแพทย์ซ้ำกันหลายคน", { field: "doctorName" }) };
  if (!CALENDAR_DEPARTMENTS.has(found[0].subtype)) {
    return { ok: false, reply: fail(422, "doctor_not_allowed", `ใช้ได้เฉพาะแพทย์ ${[...CALENDAR_DEPARTMENTS].join(", ")}`, { field: "doctorName" }) };
  }
  return { ok: true, doctor: found[0] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Answers

/** A booking as the API shows it: where and when, never the HN or the operation (the calendar has them). */
export function caseView(item: CalendarCase, periods: RepairPeriods) {
  const { booking } = item;
  const room = bookedRoom(booking, periods);
  return {
    id: Number(item.externalId),
    status: item.cancelledAt ? "cancelled" : "booked",
    date: booking.date,
    start: booking.start === null ? null : clockText(booking.start),
    end: booking.end === null ? null : clockText(booking.end),
    room: placeRoomName(room.roomId, booking.place),
    doctorName: booking.surgeon,
    queuedAt: booking.bookedAt ?? null,
    updatedAt: booking.editedAt ?? null,
    cancelledAt: item.cancelledAt,
  };
}

/** The checkCase refusal as an answer: 409 when only the day's being closed stops it, else 422. */
function refused(checked: { error: string; code: CaseErrorCode; field?: string; earliest?: string }): ApiReply {
  const more: Record<string, unknown> = {};
  if (checked.field) more.field = FIELD_NAMES[checked.field] ?? checked.field;
  if (checked.earliest) more.earliest = checked.earliest;
  if (checked.code === "note_only") return fail(409, "day_closed", "ปิดรับแก้ไขวันนั้นแล้ว (หลัง 15.00 น. วันทำการก่อนหน้า)", more);
  return fail(422, checked.code, checked.error, more);
}

/** The form's field names as the calendar's. */
const FIELD_NAMES: Readonly<Record<string, string>> = {
  date: "operationStart",
  time: "operationStart",
  hn: "hn",
  operation: "planOperation",
};

const warningsOf = (warning: TimeWarning | null) => (warning ? { warnings: [{ code: "time_not_saved", reason: warning, message: TIME_WARNING_TEXT[warning] }] } : {});

// ---------------------------------------------------------------------------------------------------------------------
// The rules' clock

type Rules = { today: string; earliest: string; periods: RepairPeriods; holidays: Awaited<ReturnType<typeof holidaysBetween>>["holidays"]; ahead: number };

/** Today, the first day that can be booked, the repair's dates and the holidays, as a doctor's booking has them (no admin). */
async function rulesNow(pool: Pool): Promise<Rules> {
  const ahead = bookAheadDays(false);
  const { date: today, minutes } = bangkokParts(now());
  const [periods, { holidays }] = await Promise.all([getRepairPeriods(pool), holidaysBetween(today, addDays(today, ahead))]);
  return { today, earliest: firstBookingDay(false, today, minutes, holidays), periods, holidays, ahead };
}

/** The input checkCase reads, from a record: the department's room, in hours, no note (a calendar's note is not shown). */
const formInput = (record: CalendarRecord, time: boolean) => ({
  date: record.date,
  hn: record.hn,
  operation: record.operation,
  shift: "in",
  room: "dept",
  note: "",
  start: time ? record.start : null,
  end: time ? record.end : null,
});

/**
 * Takes the record's lock inside a day's lock (withDayLock), so two calls about one record never interleave, and marks
 * the transaction as the calendar's: the booking log's trigger (db/schema.sql case_events) then says the change came from
 * the calendar.
 */
async function lockRecord(client: PoolClient, externalId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('cases-api:' || $1 || ':' || $2))", [CALENDAR_CLIENT, externalId]);
  await client.query("SELECT set_config('orskh.via', 'calendar', true)");
}

/** In a department with several rooms that day: the doctor's own room there, else the emptier one (as a new booking). */
function pickRoom(value: CaseInput, doctor: Doctor, day: readonly AddedCase[], periods: RepairPeriods): void {
  const rooms = deptRooms(doctor.subtype, value.operation, value.date, periods);
  if (rooms.length > 1) value.roomId = roomAmong(rooms, doctor.id, value.date, day, periods, timeOf(value));
}

// ---------------------------------------------------------------------------------------------------------------------
// The calls

/** What a save did: booked anew, changed, nothing to change, cancelled (no operation to book any more), or nothing saved. */
export type SaveResult = "created" | "updated" | "unchanged" | "cancelled" | "not_booked";

const saved = (status: number, result: SaveResult, item: CalendarCase | null, periods: RepairPeriods, more: Record<string, unknown> = {}): ApiReply => ({
  status,
  body: { ok: true, result, ...more, case: item ? caseView(item, periods) : null },
});

/** The same patient booked by the same doctor on the same day in another booking (the board's or the calendar's). */
const ALREADY_TEXT = "แพทย์จองผู้ป่วยคนนี้วันนั้นไว้แล้ว ยกเลิกรายการเดิมก่อน";
const sameDay = (day: readonly AddedCase[], doctor: Doctor, hn: string, self: string | null) =>
  day.some((item) => item.surgeonId === doctor.id && item.hn === hn && item.id !== self);

/**
 * POST and PUT: saves a whole calendar record by its id (PUT's path, or the body's for POST; when both are given they
 * must agree). The same record sent again changes nothing, so the calendar may send every record it changes, by either
 * method, as often as it likes:
 * - not booked now (never, or cancelled): booked as a new booking, at the back of its room's queue (201 `created`), under
 *   a new booking's rules (the day from the earliest on, the doctor's room that day, no other booking of the patient by
 *   the doctor that day);
 * - booked now: changed as a doctor's edit (editCase): a new day, room or HN goes to the back of the queue; its own day
 *   needs no day check, and from 15:00 the workday before nothing on it can change, though it can move to an open day
 *   (200 `updated`, or `unchanged`). Another doctor named: cancelled and booked anew for that doctor;
 * - no operation to book (another type than Surgery, or no operation day): its booking, if any, is cancelled (200
 *   `cancelled`), else nothing is saved (200 `not_booked`).
 * A time is saved even when another booking in the room has it (times overlap freely, as on the board).
 */
export async function saveBooking(pool: Pool, pathId: string | null, body: Record<string, unknown>): Promise<ApiReply> {
  const read = readRecord(body);
  if (read.ok === false) return read.reply;
  const bodyId = read.ok === true ? read.record.id : read.id;
  if (pathId !== null && bodyId !== null && pathId !== bodyId) return fail(400, "id_mismatch", "id ในข้อมูลไม่ตรงกับ id ในลิงก์", { field: "id" });
  const externalId = pathId ?? bodyId;
  if (externalId === null) return fail(400, "bad_id", "ใส่ id ของรายการ", { field: "id" });
  const ignored = { ignored: ignoredKeys(body) };
  const current = await calendarCase(pool, CALENDAR_CLIENT, externalId);
  const live = current && !current.cancelledAt ? current : null;

  if (read.ok === "unscheduled") {
    const reason = { reason: read.reason, message: UNSCHEDULED_TEXT[read.reason], ...ignored };
    if (!live) return saved(200, "not_booked", current, await getRepairPeriods(pool), reason);
    const cancelled = await cancelLive(pool, live);
    return "reply" in cancelled ? cancelled.reply : saved(200, "cancelled", cancelled.item, cancelled.periods, reason);
  }
  const { record } = read;
  const found = await findDoctor(pool, record.doctorName);
  if (!found.ok) return found.reply;
  const rules = await rulesNow(pool);
  if (live) return withIgnored(await change(pool, live, record, found.doctor, rules), ignored);
  const created = await create(pool, externalId, record, found.doctor, rules);
  if (created !== "exists") return withIgnored(created, ignored);
  // Another call booked it meanwhile: this one changes it (or, cancelled already, is sent again).
  const booked = await calendarCase(pool, CALENDAR_CLIENT, externalId);
  if (!booked || booked.cancelledAt) return fail(409, "conflict", CONFLICT_TEXT);
  return withIgnored(await change(pool, booked, record, found.doctor, rules), ignored);
}

function withIgnored(reply: ApiReply, ignored: { ignored: string[] }): ApiReply {
  return reply.status < 300 ? { ...reply, body: { ...(reply.body as Record<string, unknown>), ...ignored } } : reply;
}

const CONFLICT_TEXT = "รายการนี้เพิ่งเปลี่ยน ส่งใหม่อีกครั้ง";
const limited = () => fail(429, "rate_limited", `รับได้ไม่เกิน ${CALENDAR_DAILY_LIMIT} รายการใน 24 ชั่วโมง`, {}, { "Retry-After": "3600" });

/** A new booking of the record (saveBooking), or "exists" when one was booked meanwhile. */
async function create(pool: Pool, externalId: string, record: CalendarRecord, doctor: Doctor, rules: Rules): Promise<ApiReply | "exists"> {
  const checked = checkCase(formInput(record, true), { ...rules, subtype: doctor.subtype, place: "skh" });
  if (!checked.ok) return refused(checked);
  if ((await calendarAddedToday(pool, CALENDAR_CLIENT)) >= CALENDAR_DAILY_LIMIT) return limited();
  const value = checked.value;
  const done = await withDayLock(pool, value.date, async (client) => {
    await lockRecord(client, externalId);
    const booked = await calendarCase(client, CALENDAR_CLIENT, externalId);
    if (booked && !booked.cancelledAt) return "exists" as const;
    const day = await listCasesOn(client, value.date, "skh");
    if (sameDay(day, doctor, value.hn, null)) return "already" as const;
    pickRoom(value, doctor, day, rules.periods);
    await insertCase(client, doctor.id, LINE_SUB, value, { client: CALENDAR_CLIENT, externalId });
    return "saved" as const;
  });
  if (done === "exists") return "exists";
  if (done === "already") return fail(409, "already_booked", ALREADY_TEXT, { field: "hn" });
  const item = await calendarCase(pool, CALENDAR_CLIENT, externalId);
  if (!item) throw new Error("calendar booking not found after saving");
  return { ...saved(201, "created", item, rules.periods, warningsOf(record.timeWarning)), headers: { Location: `/api/v1/calendar/cases/${externalId}` } };
}

/**
 * Whether a record leaves a booking that can no longer change (its day gone or closed, or under way) as it is: false
 * when it would change it, else the warning its answer carries (null for none). The same record sent again is no change.
 * So is one with the booking's own start whose time the calendar cannot give as a booking's (no end, out of hours): the
 * booking keeps its time, as a closed day's would on the board.
 */
function keptAsIs(record: CalendarRecord, editing: AddedCase, context: Parameters<typeof checkCase>[1]): TimeWarning | null | false {
  if (record.date !== editing.date) return false;
  const as = (start: number | null, end: number | null) => checkCase({ ...formInput(record, false), start, end }, context).ok;
  if (as(record.start, record.end)) return record.timeWarning;
  const ownStart = record.start === null && record.timeWarning !== null && record.askedStart === editing.start;
  return ownStart && as(editing.start, editing.end) ? null : false;
}

/** What a booking was when a call read it: a change by anyone since (the board, another call) makes it differ. */
const stateOf = (b: AddedCase) => JSON.stringify([b.id, b.date, b.roomId, b.hn, b.operation, b.start, b.end, b.surgeonId, b.bookedAt ?? null, b.editedAt ?? null]);

/** The change of a booked record (saveBooking). */
async function change(pool: Pool, current: CalendarCase, record: CalendarRecord, doctor: Doctor, rules: Rules): Promise<ApiReply> {
  const booking = current.booking;
  const externalId = current.externalId;
  const sameDoctor = doctor.id === booking.surgeonId;
  const editing = { ...booking, subtype: doctor.subtype };
  const context = { ...rules, subtype: doctor.subtype, place: "skh" as const, ...(sameDoctor ? { editing } : {}) };
  // A booking that can no longer change (its day gone, under way today, or its day closed): the same record again is
  // no change, and anything else is refused below.
  if (sameDoctor && booking.date < rules.earliest) {
    const kept = keptAsIs(record, editing, context);
    if (kept !== false) return saved(200, "unchanged", current, rules.periods, { requeued: false, ...warningsOf(kept) });
  }
  if (bookingState(booking.date, rules.today, rules.earliest) === "past") return fail(409, "past", "ผ่านวันผ่าตัดแล้ว แก้ไม่ได้");
  if (await startedToday(pool, booking, rules.today, booking.surgeonId, rules.periods)) return fail(409, "under_way", "เคสนี้เริ่มแล้ว แก้ไขไม่ได้");

  const checked = checkCase(formInput(record, true), context);
  if (!checked.ok) return refused(checked);
  const value = checked.value;
  // Another doctor named: a new booking of theirs, under the same limit as one.
  if (!sameDoctor && (await calendarAddedToday(pool, CALENDAR_CLIENT)) >= CALENDAR_DAILY_LIMIT) return limited();

  const done = await withDayLock(pool, value.date, async (client) => {
    await lockRecord(client, externalId);
    // Changed meanwhile (another call, or the doctor on the board): this call was worked out on what it read, so it is
    // sent again rather than saved over the change.
    const latest = await calendarCase(client, CALENDAR_CLIENT, externalId);
    if (!latest || latest.cancelledAt || stateOf(latest.booking) !== stateOf(booking)) return "gone" as const;
    const day = (await listCasesOn(client, value.date, "skh")).filter((item) => item.id !== booking.id);
    if (sameDay(day, doctor, value.hn, booking.id)) return "already" as const;
    if (!sameDoctor) {
      pickRoom(value, doctor, day, rules.periods);
    } else {
      const sameRoom = value.date === booking.date && bookedChoice(editing, rules.periods) === "dept";
      const rooms = deptRooms(doctor.subtype, value.operation, value.date, rules.periods);
      if (sameRoom && rooms.includes(bookedRoom(editing, rules.periods).roomId)) value.roomId = bookedRoom(editing, rules.periods).roomId;
      else if (rooms.length > 1) value.roomId = roomAmong(rooms, doctor.id, value.date, day, rules.periods, timeOf(value));
    }
    if (!sameDoctor) {
      if (!(await removeCase(client, booking.id, booking.surgeonId))) return "gone" as const;
      await insertCase(client, doctor.id, LINE_SUB, value, { client: CALENDAR_CLIENT, externalId });
      return { changed: true, requeue: true };
    }
    // The note, the patient's name and the diagnosis are the board's (the API sets none; it never reads the record's):
    // the booking keeps whatever it has.
    value.note = booking.note;
    value.patientName = booking.patientName;
    value.diagnosis = booking.diagnosis;
    const what = bookingChange(editing, value, rules.periods);
    if (!what.changed) return { changed: false, requeue: false };
    if (!(await updateCase(client, booking.id, booking.surgeonId, value, what.requeue))) return "gone" as const;
    return { changed: true, requeue: what.requeue };
  });
  if (done === "gone") return fail(409, "conflict", CONFLICT_TEXT);
  if (done === "already") return fail(409, "already_booked", ALREADY_TEXT, { field: "hn" });
  const item = await calendarCase(pool, CALENDAR_CLIENT, externalId);
  if (!item) throw new Error("calendar booking not found after saving");
  return saved(200, done.changed ? "updated" : "unchanged", item, rules.periods, { requeued: done.requeue, ...warningsOf(record.timeWarning) });
}

/**
 * Cancels a booked record, unless its day has gone or HOSxP says the case is under way. Under the record's lock, on the
 * booking as it is then (a call changing it meanwhile may have moved it, or given it to another doctor).
 */
async function cancelLive(pool: Pool, live: CalendarCase): Promise<{ reply: ApiReply } | { item: CalendarCase; periods: RepairPeriods }> {
  const periods = await getRepairPeriods(pool);
  const today = bangkokParts(now()).date;
  const refusal = await withDayLock(pool, live.booking.date, async (client) => {
    await lockRecord(client, live.externalId);
    const latest = await calendarCase(client, CALENDAR_CLIENT, live.externalId);
    if (!latest || latest.cancelledAt) return null;
    const { booking } = latest;
    if (booking.date < today) return fail(409, "past", "ผ่านวันผ่าตัดแล้ว ยกเลิกไม่ได้");
    if (await startedToday(client, booking, today, booking.surgeonId, periods)) return fail(409, "under_way", "เคสนี้เริ่มแล้ว ยกเลิกไม่ได้");
    // The doctor may cancel it on the board meanwhile (no record lock there): cancelled either way.
    await removeCase(client, booking.id, booking.surgeonId);
    return null;
  });
  if (refusal) return { reply: refusal };
  const item = await calendarCase(pool, CALENDAR_CLIENT, live.externalId);
  if (!item) throw new Error("calendar booking not found after cancelling");
  return { item, periods };
}

/**
 * DELETE: cancels the record's booking (its row stays, with removed_at). Again for a cancelled one is no error. 404 when
 * the calendar never booked the id; 409 when its day has gone or HOSxP says the case is under way.
 */
export async function cancelBooking(pool: Pool, externalId: string): Promise<ApiReply> {
  const current = await calendarCase(pool, CALENDAR_CLIENT, externalId);
  if (!current) return fail(404, "not_found", "ไม่พบรายการนี้");
  if (current.cancelledAt) return saved(200, "unchanged", current, await getRepairPeriods(pool));
  const cancelled = await cancelLive(pool, current);
  return "reply" in cancelled ? cancelled.reply : saved(200, "cancelled", cancelled.item, cancelled.periods);
}

/** GET one: the record's booking now (or the last one cancelled), 404 when the calendar never booked the id. */
export async function getBooking(pool: Pool, externalId: string): Promise<ApiReply> {
  const item = await calendarCase(pool, CALENDAR_CLIENT, externalId);
  if (!item) return fail(404, "not_found", "ไม่พบรายการนี้");
  return { status: 200, body: { ok: true, case: caseView(item, await getRepairPeriods(pool)) } };
}

/**
 * GET the list: the calendar's bookings booked now with their day from `from` to `to` (YYYY-MM-DD; today and 60 days
 * on when left out), at most CALENDAR_LIST_DAYS days apart and CALENDAR_LIST_LIMIT records.
 */
export async function listBookings(pool: Pool, query: URLSearchParams): Promise<ApiReply> {
  const today = bangkokParts(now()).date;
  const from = query.get("from") ?? today;
  // (addDays throws on a day that is no date: `from` is checked first.)
  const to = query.get("to") ?? (isIsoDate(from) ? addDays(from, bookAheadDays(false)) : "");
  if (!isIsoDate(from) || !isIsoDate(to) || to < from || to > addDays(from, CALENDAR_LIST_DAYS)) {
    return fail(400, "bad_query", `from และ to ต้องเป็น YYYY-MM-DD ห่างกันไม่เกิน ${CALENDAR_LIST_DAYS} วัน`);
  }
  const [items, periods] = await Promise.all([calendarCasesBetween(pool, CALENDAR_CLIENT, from, to, CALENDAR_LIST_LIMIT), getRepairPeriods(pool)]);
  return { status: 200, body: { ok: true, from, to, cases: items.map((item) => caseView(item, periods)) } };
}
