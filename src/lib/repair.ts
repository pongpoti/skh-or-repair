import type { DeptCode } from "./allocation.ts";

/**
 * The air-ventilation repair layout (Pong, 14 Nov 2026, confirmed). The works run in two halves; while a half runs the
 * weekly OR schedule (lib/allocation.ts) is set aside and each room in use has one fixed use every working day.
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

/** The dates of both halves, as an admin set them (lib/repair-store.ts). */
export type RepairPeriods = { half1: RepairDates; half2: RepairDates };

/**
 * The planned dates (Pong, 14 Nov 2026): the first half starts today and the second follows it. The database is seeded
 * with these (db/schema.sql), and the board falls back to them when the database cannot be read.
 */
export const DEFAULT_REPAIR_PERIODS: RepairPeriods = {
  half1: { from: "2026-11-14", to: "2027-01-26" },
  half2: { from: "2027-01-27", to: "2027-03-17" },
};

/** A half of the repair with its dates. */
export type RepairHalf = RepairLayout & RepairDates;

/**
 * The colour of a recovery room and of the instrument room during the repair (the app's brown, `--brand-top`; white
 * labels clear 9:1 on it). Rooms that operate keep their department's colour.
 */
export const REPAIR_COLOR = "#54402F";

/** Thai name of a room used as a recovery room during the repair, and its label on the plan. */
export const RECOVERY_USE = { name: "ห้องพักฟื้น (RR)", label: "RR" } as const;

/** Thai name of the room that holds the instruments during the second half, and its label on the plan. */
export const INSTRUMENT_USE = { name: "ห้องเก็บเครื่องมือ", label: "เครื่องมือ" } as const;

/**
 * Whether the board uses the repair layout at all. On since 14 Nov 2026; the dates in the database decide when. Set it
 * to false to go back to the weekly schedule on every date without touching the dates.
 */
export const REPAIR_IN_USE: boolean = true;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The half of the repair that `date` (YYYY-MM-DD) falls in under `periods`, or null outside both halves, when the
 * layout is not in use, or for a malformed date. Should the halves overlap (the admin form refuses that), the first
 * half wins.
 */
export function repairOn(date: string | null | undefined, periods: RepairPeriods): RepairHalf | null {
  if (!REPAIR_IN_USE || typeof date !== "string" || !ISO_DATE.test(date)) return null;
  if (date >= periods.half1.from && date <= periods.half1.to) return { ...REPAIR_LAYOUTS[1], ...periods.half1 };
  if (date >= periods.half2.from && date <= periods.half2.to) return { ...REPAIR_LAYOUTS[2], ...periods.half2 };
  return null;
}

/** A date as "8 ธ.ค. 2569" (no weekday), for the repair's dates. */
export function shortThaiDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/**
 * The board's note while the repair runs, e.g. "ปิดซ่อมห้องผ่าตัด ช่วงที่ 1 · ถึง 26 ม.ค. 2570" (short enough for one line on
 * a 360px phone; the top bar already shows the board's date).
 */
export function repairNote(half: RepairHalf): string {
  return `ปิดซ่อมห้องผ่าตัด ช่วงที่ ${half.half} · ถึง ${shortThaiDate(half.to)}`;
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
 * the second half starting after the first ends (they may not overlap, but a gap between them is allowed: the weekly
 * schedule applies then). Isomorphic, so the admin form shows the same message the server action gives.
 */
export function checkRepairPeriods(input: unknown): CheckedPeriods {
  const raw = (input ?? {}) as { half1?: { from?: unknown; to?: unknown } | null; half2?: { from?: unknown; to?: unknown } | null };
  const dates = [raw.half1?.from, raw.half1?.to, raw.half2?.from, raw.half2?.to];
  if (dates.some((value) => typeof value !== "string" || !value.trim())) return { ok: false, error: "ใส่วันที่ให้ครบทั้ง 4 ช่อง" };
  const [from1, to1, from2, to2] = dates.map((value) => (value as string).trim());
  if (![from1, to1, from2, to2].every(isCalendarDate)) return { ok: false, error: "วันที่ไม่ถูกต้อง เลือกจากปฏิทินอีกครั้ง" };
  if (from1 > to1) return { ok: false, error: "ช่วงที่ 1: วันเริ่มต้องไม่หลังวันสิ้นสุด" };
  if (from2 > to2) return { ok: false, error: "ช่วงที่ 2: วันเริ่มต้องไม่หลังวันสิ้นสุด" };
  if (from2 <= to1) return { ok: false, error: "ช่วงที่ 2 ต้องเริ่มหลังวันสุดท้ายของช่วงที่ 1" };
  return { ok: true, periods: { half1: { from: from1, to: to1 }, half2: { from: from2, to: to2 } } };
}
