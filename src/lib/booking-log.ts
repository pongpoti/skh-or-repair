import { rangeText } from "./booking-time.ts";
import { shortThaiDay } from "./days.ts";
import { displayHn } from "./hn.ts";
import { PLACES, type PlaceId } from "./places.ts";
import { getRoom, roomLabel } from "./rooms.ts";
import { thaChalomRoomName } from "./tha-chalom-schedule.ts";

/**
 * The admin's booking log (/admin/bookings; Pong, 28 Nov 2026: "Create logged booking cases dashboard, opened from admin
 * profile"): every booking ever made on the board or by the calendar API, with what happened to it since (table
 * case_events, written by a trigger on cases: db/schema.sql). This file shapes the rows for the page, isomorphic and
 * without the database (lib/booking-log-store.ts reads them): every date and time is written out here, in Bangkok time,
 * so the browser's own clock cannot make the page differ from what the server rendered.
 */

export type LogKind = "book" | "edit" | "move" | "cancel" | "restore";
export type LogVia = "board" | "calendar";

/** What each kind of event is called on the page. */
export const KIND_LABELS: Record<LogKind, string> = {
  book: "จอง",
  edit: "แก้ไข",
  move: "ย้ายวัน/ห้อง",
  cancel: "ยกเลิก",
  restore: "จองคืน",
};

/** One changed field of an edit or move, as the log says it. */
export type LogChange = { label: string; before: string; after: string };

export type LogEvent = {
  id: string;
  kind: LogKind;
  via: LogVia;
  /** ISO time, for sorting and the period filter. */
  at: string;
  /** "28 พ.ย. 2569 14:05 น." */
  atText: string;
  /** Empty for book, cancel and restore, and for an edit from before the log began (its details were never kept). */
  changes: LogChange[];
};

export type LogEntry = {
  id: string;
  place: PlaceId;
  /** "สมุทรสาคร", "ท่าฉลอม". */
  placeName: string;
  /** "OR 5", "ห้อง Scope". */
  room: string;
  /** The operation's day, YYYY-MM-DD. */
  date: string;
  /** "จ. 30 พ.ย. 69". */
  dateText: string;
  /** "08:30–09:30", or "" without a time. */
  time: string;
  hn: string;
  patient: string;
  diagnosis: string;
  operation: string;
  /** Booked into the dressing room (ห้องทำแผล). */
  dressing: boolean;
  note: string;
  doctorId: string;
  doctor: string;
  /** The doctor's specialty code (ORTHO, ...), or "". */
  specialty: string;
  /** Who made it: the board's booking form, or the calendar API. */
  via: LogVia;
  bookedAt: string;
  bookedAtText: string;
  cancelled: boolean;
  /** The history, oldest first; the first is the booking itself. */
  events: LogEvent[];
};

const BANGKOK = "Asia/Bangkok";

/** "28 พ.ย. 2569 14:05 น." in Bangkok time. */
export function logTime(at: Date): string {
  const day = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { timeZone: BANGKOK, day: "numeric", month: "short", year: "numeric" }).format(at);
  const time = new Intl.DateTimeFormat("th-TH", { timeZone: BANGKOK, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  return `${day} ${time} น.`;
}

/** "จ. 30 พ.ย. 69": the weekday, day, month and the Buddhist year's last two digits. */
export function logDay(iso: string): string {
  const year = (Number(iso.slice(0, 4)) + 543) % 100;
  return `${shortThaiDay(iso)} ${String(year).padStart(2, "0")}`;
}

export function placeName(place: string): string {
  return PLACES.find((p) => p.id === place)?.short ?? place;
}

/** A room's name at its hospital: "OR 5" at รพ.สมุทรสาคร, "OR 2" or "ห้อง Scope" at รพ.ท่าฉลอม; the id when unknown. */
export function logRoom(place: string, roomId: string): string {
  if (place === "tha-chalom") return thaChalomRoomName(roomId);
  const room = getRoom(roomId);
  return room ? roomLabel(room) : roomId;
}

const NONE = "—";

/** The fields a change can name, in the order the log lists them, with their Thai names. */
const FIELD_LABELS: ReadonlyArray<[key: string, label: string]> = [
  ["place", "โรงพยาบาล"],
  ["date", "วันผ่าตัด"],
  ["room", "ห้อง"],
  ["time", "เวลา"],
  ["hn", "HN"],
  ["patient", "ชื่อผู้ป่วย"],
  ["diagnosis", "การวินิจฉัย"],
  ["operation", "การผ่าตัด"],
  ["dressing", "ห้องทำแผล"],
  ["scrub", "scrub ทำให้"],
  ["note", "หมายเหตุ"],
];

function yesNo(v: unknown): string {
  return v === true ? "ใช่" : v === false ? "ไม่" : NONE;
}

function timeOf(v: unknown): string {
  return Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number" ? rangeText({ start: v[0], end: v[1] }) : "ไม่ระบุ";
}

function text(v: unknown): string {
  return typeof v === "string" && v.trim() ? v : NONE;
}

/**
 * An edit's or move's changes (case_events.changes: each field as [before, after]) as the log lists them. A room is named
 * at the hospital it was in before and after (a move between hospitals changes both). Anything unreadable is left out.
 */
export function describeChanges(raw: unknown, place: { before: string; after: string }): LogChange[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const changes = raw as Record<string, unknown>;
  const out: LogChange[] = [];
  for (const [key, label] of FIELD_LABELS) {
    const pair = changes[key];
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [before, after] = pair;
    let shown: [string, string];
    switch (key) {
      case "place":
        shown = [placeName(String(before)), placeName(String(after))];
        break;
      case "date":
        shown = [typeof before === "string" ? logDay(before) : NONE, typeof after === "string" ? logDay(after) : NONE];
        break;
      case "room":
        shown = [
          typeof before === "string" ? logRoom(place.before, before) : NONE,
          typeof after === "string" ? logRoom(place.after, after) : NONE,
        ];
        break;
      case "time":
        shown = [timeOf(before), timeOf(after)];
        break;
      case "hn":
        shown = [typeof before === "string" ? displayHn(before) : NONE, typeof after === "string" ? displayHn(after) : NONE];
        break;
      case "dressing":
      case "scrub":
        shown = [yesNo(before), yesNo(after)];
        break;
      default:
        shown = [text(before), text(after)];
    }
    out.push({ label, before: shown[0], after: shown[1] });
  }
  return out;
}

/** The hospital a booking was at before and after one event, from that event's own change of hospital if it has one. */
export function placesOf(raw: unknown, current: string): { before: string; after: string } {
  const pair = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>).place : null;
  if (Array.isArray(pair) && pair.length === 2) return { before: String(pair[0]), after: String(pair[1]) };
  return { before: current, after: current };
}

/** The counts the page's tiles show for the bookings its filters pick out. */
export type LogCounts = { all: number; booked: number; cancelled: number; changed: number; calendar: number };

export function countEntries(entries: readonly LogEntry[]): LogCounts {
  const counts: LogCounts = { all: 0, booked: 0, cancelled: 0, changed: 0, calendar: 0 };
  for (const entry of entries) {
    counts.all += 1;
    if (entry.cancelled) counts.cancelled += 1;
    else counts.booked += 1;
    if (entry.events.some((e) => e.kind === "edit" || e.kind === "move")) counts.changed += 1;
    if (entry.via === "calendar") counts.calendar += 1;
  }
  return counts;
}
