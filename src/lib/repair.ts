import type { DeptCode } from "./allocation.ts";

/**
 * The air-ventilation repair layout (Pong, 14 Nov 2026, confirmed). The works run in two halves, and each room in use has
 * one fixed use every working day. Until the repair starts on 8 Dec 2026 (the go-live period) and after it ends, the board
 * shows the normal weekly OR schedule (lib/allocation.ts; Pong, 21 Nov 2026: "reschedule OR layout plan to follows
 * ช่วงเปิดใช้งานจริง", the 18 Nov "forget normal day OR schedule" no longer holds), and an admin can switch every day to
 * one schedule (ScheduleMode, repairOn).
 *
 * - First half: OR 9 emergencies, OR 10 dressing, OR 11 mixed departments, OR 12 GENSX, OR 13 ORTHO, OR 7 and 8
 *   recovery; OR 1 to 6 and the recovery area (RR 1 and 2) are closed, inside the repair zone.
 * - Second half: OR 1 dressing, OR 2 ORTHO, OR 3 emergencies, OR 4 mixed departments, OR 5 GENSX, OR 6 the instrument
 *   room; OR 7 to 13 and RR 1 are closed. RR 2 is a recovery room as usual.
 *
 * Obstetrics and gynaecology operate in the obstetric OR (อาคารแม่ ชั้น 3) during the whole repair, so their cases are
 * never placed on the board then (lib/placement.ts).
 *
 * The dates of the halves are not here: an admin can move them on /admin, so they live in the database
 * (lib/repair-store.ts) with DEFAULT_REPAIR_PERIODS as the seed and the fallback. Every function that depends on the
 * date takes the periods as an argument, with no module default, so no caller can forget the admin's dates.
 */

/** What a room is used for while the repair runs: a department's operating room, a recovery room, or the instrument room. */
export type RepairUse = DeptCode | "RR" | "INSTR";

export type RepairLayout = {
  /** 1 or 2. */
  half: 1 | 2;
  /** The operating rooms in use; any OR not listed is closed. */
  rooms: Readonly<Record<string, RepairUse>>;
  /** Where NEURO and CVT emergency cases go instead of the emergency room (the one with the fewest cases). */
  emergencyRooms: readonly string[];
  /** Recovery-area rooms (RR 1 and 2) that are closed, inside the repair zone. */
  closedRecovery: readonly string[];
  /** The closed zone drawn over the floor plan (an SVG path in the plan's 0 0 1207 1706 viewBox). */
  zone: string;
};

export const REPAIR_LAYOUTS: Readonly<Record<1 | 2, RepairLayout>> = {
  1: {
    half: 1,
    rooms: {
      "or-7": "RR",
      "or-8": "RR",
      "or-9": "EMER",
      "or-10": "INFECT",
      "or-11": "MIXED",
      "or-12": "GENSX",
      "or-13": "ORTHO",
    },
    emergencyRooms: ["or-12", "or-13"],
    closedRecovery: ["r-1", "r-2"],
    zone: "M20 20L1187 20L1187 700L400 700L400 590L20 590Z",
  },
  2: {
    half: 2,
    rooms: {
      "or-1": "INFECT",
      "or-2": "ORTHO",
      "or-3": "EMER",
      "or-4": "MIXED",
      "or-5": "GENSX",
      "or-6": "INSTR",
    },
    emergencyRooms: ["or-2"],
    closedRecovery: ["r-1"],
    zone: "M433 532L757 532L757 700L1187 700L1187 1686L20 1686L20 1093L677 1093L677 700L433 700Z",
  },
};

/** First and last day of a half, YYYY-MM-DD (Thailand), both inclusive. */
export type RepairDates = { from: string; to: string };

/**
 * Which rooms the board shows, chosen by an admin on /admin for everyone (Pong, 21 Nov 2026: "Allow admin to manually
 * switch schedule, which will affect all user display schedule"):
 * - "auto": by the dates, the normal weekly OR schedule before the repair and after it, each half's rooms within it;
 * - "normal": the normal weekly OR schedule on every day;
 * - "half1" / "half2": that half's rooms on every day.
 */
export type ScheduleMode = "auto" | "normal" | "half1" | "half2";

export const SCHEDULE_MODES: readonly ScheduleMode[] = ["auto", "normal", "half1", "half2"];

/** The admin's words for each mode (the /admin switch). */
export const SCHEDULE_MODE_TEXT: Readonly<Record<ScheduleMode, string>> = {
  auto: "อัตโนมัติตามวันที่",
  normal: "ตารางปกติ",
  half1: "ปิดซ่อม ช่วงที่ 1",
  half2: "ปิดซ่อม ช่วงที่ 2",
};

export function isScheduleMode(value: unknown): value is ScheduleMode {
  return typeof value === "string" && (SCHEDULE_MODES as readonly string[]).includes(value);
}

/**
 * The dates of both halves, as an admin set them (lib/repair-store.ts), and the admin's switch (`mode`, "auto" when
 * left out).
 */
export type RepairPeriods = { half1: RepairDates; half2: RepairDates; mode?: ScheduleMode };

/**
 * The planned dates (Pong, 21 Nov 2026: "the schedule will automatically reschedule to repair phase on Dec 8 plus 100
 * days"): the repair runs 100 days from 8 Dec 2026, the first half 8 Dec 2026 – 26 Jan 2027 (50 days), the second
 * 27 Jan – 17 Mar 2027 (50 days). Until 7 Dec 2026, the go-live period, the board shows the normal weekly OR schedule
 * (lib/allocation.ts), back to 1 Jan 2026 in the calendar; from 18 Mar 2027 it does again. The database is seeded with
 * these (db/schema.sql), and the board falls back to them when the database cannot be read.
 */
export const DEFAULT_REPAIR_PERIODS: RepairPeriods = {
  half1: { from: "2026-12-08", to: "2027-01-26" },
  half2: { from: "2027-01-27", to: "2027-03-17" },
};

/** A half of the repair with its dates. */
export type RepairHalf = RepairLayout & RepairDates;

/**
 * Rooms that operate during the repair keep their department's colour. A recovery room is mint and the instrument room
 * light tan: RECOVERY_ROOM and INSTRUMENT_ROOM in lib/allocation.ts, the colour list.
 */

/** Thai name of a room used as a recovery room during the repair, and its label on the plan. */
export const RECOVERY_USE = { name: "ห้องพักฟื้น (RR)", label: "RR" } as const;

/** Thai name of the room that holds the instruments during the second half, and its label on the plan. */
export const INSTRUMENT_USE = { name: "ห้องเก็บเครื่องมือ", label: "เครื่องมือ" } as const;

/**
 * Whether the board uses the repair layout at all. On since 14 Nov 2026; which days have it is up to the dates and the
 * admin's switch (repairOn). Setting it to false would bring back the weekly schedule on every date.
 */
export const REPAIR_IN_USE: boolean = true;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The half of the repair whose rooms `date` (YYYY-MM-DD) has under `periods`, or null when the board shows the normal
 * weekly OR schedule that day (lib/allocation.ts), for a malformed date, or when the layout is not in use.
 *
 * By the dates ("auto"): the normal schedule before the first half's first day (the go-live period, Pong, 21 Nov 2026)
 * and after the second half's last day; the first half's rooms from its first day until the second half starts (through
 * any gap an admin leaves between the halves); the second half's rooms from its first day to its last. An admin's switch
 * ("normal", "half1", "half2") overrides the dates on every day.
 */
export function repairOn(date: string | null | undefined, periods: RepairPeriods): RepairHalf | null {
  if (!REPAIR_IN_USE || typeof date !== "string" || !ISO_DATE.test(date)) return null;
  const first = { ...REPAIR_LAYOUTS[1], ...periods.half1 };
  const second = { ...REPAIR_LAYOUTS[2], ...periods.half2 };
  switch (periods.mode ?? "auto") {
    case "normal":
      return null;
    case "half1":
      return first;
    case "half2":
      return second;
    default:
      if (date < periods.half1.from || date > periods.half2.to) return null;
      return date < periods.half2.from ? first : second;
  }
}

/** A date as "8 ธ.ค. 2569" (no weekday), for the repair's dates. */
export function shortThaiDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export type CheckedPeriods = { ok: true; periods: RepairPeriods } | { ok: false; error: string };

function isCalendarDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Years outside 2000–2100 are typing slips (a two-digit year, a Buddhist year), not repair dates.
  return y >= 2000 && y <= 2100 && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * Checks the dates an admin typed for the two halves: four real dates, each half's first day on or before its last, and
 * the second half starting after the first ends (they may not overlap; a gap between them keeps the first half's rooms
 * until the second starts, repairOn). Isomorphic, so the admin form shows the same message the server action gives.
 */
export function checkRepairPeriods(input: unknown): CheckedPeriods {
  const raw = (input ?? {}) as {
    half1?: { from?: unknown; to?: unknown } | null;
    half2?: { from?: unknown; to?: unknown } | null;
    mode?: unknown;
  };
  const mode = raw.mode === undefined ? "auto" : raw.mode;
  if (!isScheduleMode(mode)) return { ok: false, error: "เลือกตารางที่ใช้ให้ถูกต้อง" };
  const dates = [raw.half1?.from, raw.half1?.to, raw.half2?.from, raw.half2?.to];
  if (dates.some((value) => typeof value !== "string" || !value.trim())) return { ok: false, error: "ใส่วันที่ให้ครบทั้ง 4 ช่อง" };
  const [from1, to1, from2, to2] = dates.map((value) => (value as string).trim());
  if (![from1, to1, from2, to2].every(isCalendarDate)) return { ok: false, error: "วันที่ไม่ถูกต้อง เลือกจากปฏิทิน" };
  if (from1 > to1) return { ok: false, error: "ช่วงที่ 1: วันเริ่มอยู่หลังวันสุดท้าย" };
  if (from2 > to2) return { ok: false, error: "ช่วงที่ 2: วันเริ่มอยู่หลังวันสุดท้าย" };
  if (from2 <= to1) return { ok: false, error: "ช่วงที่ 2 ต้องเริ่มหลังช่วงที่ 1 จบ" };
  return { ok: true, periods: { half1: { from: from1, to: to1 }, half2: { from: from2, to: to2 }, mode } };
}
