import { WEEK_DATA } from "../data/week-data.ts";
import type { DeptCode } from "./allocation.ts";
import { DAY_KEYS, DAY_NAMES, weekDates, workdayIndex, type DayKey } from "./days.ts";
import { listPhysicians, teamOf } from "./physicians.ts";
import { placeCase } from "./placement.ts";
import type { RepairPeriods } from "./repair.ts";
import type { CaseStatus, Operation, Shift } from "./schedule.ts";

// The keyword rules moved to lib/placement.ts with the rest of the placement; they stay importable from here.
export { isDressingCase, isScopeCase } from "./placement.ts";

/** One row of the OR system export, reduced to what the board shows. Built by scripts/build_week.py. */
export type WeekCase = {
  /** 0 = Monday … 4 = Friday. */
  day: number;
  dept: DeptCode | null;
  surgeon: string;
  title: string;
  proc: string;
  status: CaseStatus;
  shift: Shift | null;
  emergency: boolean;
};

export type WeekFile = {
  meta: { days: string[]; rows: number; kept: number; dropped: Record<string, number> };
  cases: WeekCase[];
};

/** Spellings in the export that differ from the physician list. */
const ALIASES: Record<string, string> = {
  "วันทนันท์ หล่อวัฒนกิจชัย": "วันทนันท์ หล่อวัฒนากิจชัย",
};

const squash = (value: string) => value.replace(/\s+/g, " ").trim();

let known: Map<string, { name: string; specialty: string }> | null = null;

/** Look a surgeon up in the supplied physician list. Unknown names are kept as the export wrote them. */
export function resolveSurgeon(name: string, title: string): { label: string; specialty: string | null; team: ReturnType<typeof teamOf> } {
  known ??= new Map(listPhysicians().map((person) => [squash(person.name), person]));
  const clean = squash(name);
  const person = known.get(ALIASES[clean] ?? clean);
  const shown = person ? person.name : clean;
  return { label: [title, shown].filter(Boolean).join(" "), specialty: person ? [person.specialty, teamOf(person.name)].filter(Boolean).join(" · ") : null,
    team: person ? teamOf(person.name) : null,
  };
}

export type DayBoard = {
  key: DayKey;
  name: (typeof DAY_NAMES)[number];
  /** Calendar date behind the day. It decides which department holds each room, not what the header shows. */
  date: string;
  operations: Operation[];
};

/**
 * Each weekday's cases in their rooms (lib/placement.ts, under the repair `periods`). The dates are the export's week,
 * or `week` when the data has none or when `onWeek` is set (the board for a real calendar week: the export's cases are
 * placed by that week's rooms). A case whose department holds no room that day is left off the board.
 */
export function weekBoard(
  data: WeekFile,
  periods: RepairPeriods,
  week: readonly string[] = data.meta.days,
  onWeek = false,
): DayBoard[] {
  return DAY_KEYS.map((key, day) => {
    const date = (onWeek ? week[day] : undefined) ?? data.meta.days[day] ?? week[day];
    const rows = data.cases.filter((item) => item.day === day);
    const load = new Map<string, number>();
    const placed = new Map<WeekCase, string | null>();

    // The export's room column is not trusted: every case is placed by the schedule's rules alone.
    for (const item of rows) {
      const team = resolveSurgeon(item.surgeon, item.title).team;
      const placement = placeCase({ procedure: item.proc, dept: item.dept, emergency: item.emergency, team }, date, periods, load);
      const roomId = placement.ok ? placement.roomId : null;
      placed.set(item, roomId);
      if (roomId) load.set(roomId, (load.get(roomId) ?? 0) + 1);
    }

    const order = new Map<string, number>();
    const operations: Operation[] = [];
    rows.forEach((item, index) => {
      const roomId = placed.get(item);
      if (!roomId) return;
      const slot = (order.get(roomId) ?? 0) + 1;
      order.set(roomId, slot);
      const surgeon = resolveSurgeon(item.surgeon, item.title);
      operations.push({
        id: `${date}-${index}`,
        roomId,
        order: slot,
        procedure: item.proc,
        surgeon: surgeon.label,
        specialty: surgeon.specialty,
        status: item.status,
        shift: item.shift,
      });
    });

    return { key, name: DAY_NAMES[day], date, operations };
  });
}

/**
 * The board for a calendar date: the export week's cases for that weekday, or null at the weekend.
 * The export covers one week only, so every Monday shows its Monday, and so on. The board is always dated in the
 * real week of `iso`, even when the export is from another week, so the rooms in use, their departments and the
 * doctors' added cases all follow the real day (the ventilation repair changes the rooms by date).
 */
export function boardFor(
  iso: string,
  periods: RepairPeriods,
  index: number | null = workdayIndex(iso),
  data: WeekFile = WEEK_DATA,
): DayBoard | null {
  return index === null ? null : weekBoard(data, periods, weekDates(iso), true)[index];
}
