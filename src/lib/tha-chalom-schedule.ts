import { addDays } from "./days.ts";
import { DEPARTMENTS, weekdayIndex, weekOfMonth, type Department, type DeptCode } from "./allocation.ts";
import { boardEyebrow, PICK_AHEAD_DAYS, type BoardDayRelation } from "./board-day.ts";
import { isWorkday, type Holiday } from "./holidays.ts";

/**
 * รพ.ท่าฉลอม's weekly OR schedule, as Pong sent it on 26 Nov 2026 (the hospital's table "ข้อมูลการจัดตารางล่าสุด ณ วันที่
 * 25 พฤศจิกายน 2569", เฉพาะในเวลาราชการ):
 *
 * | วัน      | ช่วงเวลา | ห้อง 1       | ห้อง 2            | ห้อง 3                  | ห้อง 4                                   |
 * | จันทร์   | ตลอดวัน  | ORTHO (TKA) | ศัลยกรรมหลอดเลือด | ปรับปรุงเป็น Intervention | EYE                                     |
 * | อังคาร   | ตลอดวัน  | Gen Sx      | ศัลยกรรมหลอดเลือด |                         | ENT                                     |
 * | พุธ      | เช้า     | ORTHO (TKA) | ศัลยกรรมหลอดเลือด |                         | EYE                                     |
 * |         | บ่าย     | ORTHO (TKA) | ศัลยกรรมหลอดเลือด |                         | ENT                                     |
 * | พฤหัสบดี | ตลอดวัน  | Gen Sx      | ศัลยกรรมหลอดเลือด |                         | สัปดาห์ 1, 3, 5 ORTHO; 2, 4 ศัลยกรรมตกแต่ง |
 * | ศุกร์    | ตลอดวัน  | ว่าง         | ศัลยกรรมหลอดเลือด |                         | ENT                                     |
 *
 * and the Scope room: จันทร์ ว่าง, อังคาร ศัลยกรรมตกแต่ง, พุธ (เช้า) ว่าง, พฤหัสบดี ตา, ศุกร์ ว่าง. Wednesday afternoon in
 * the Scope room is not in the table, so it is ว่าง too. The departments are the app's own (lib/allocation.ts), in
 * their colours. Week 1 is a weekday's first occurrence in the month (weekOfMonth), as in รพ.สมุทรสาคร's schedule.
 */

/** What a room is used for in half a day. */
export type ThaChalomUse =
  | { kind: "dept"; dept: Department; note: string | null }
  | { kind: "free" }
  | { kind: "closed" };

export type ThaChalomRoom = {
  id: "or-1" | "or-2" | "or-3" | "or-4" | "scope";
  /** On the room's badge: the OR's number, or Scope. */
  number: string;
  /** The room's name, read out and in titles. */
  name: string;
  /** "OR" before the number on the badge (the ORs), or nothing (the Scope room). */
  prefix: "OR" | null;
};

/** The rooms in the table's order: OR 1 to 4 on the plan, then the Scope room (not on Pong's plan). */
export const THA_CHALOM_ROOM_LIST: readonly ThaChalomRoom[] = [
  { id: "or-1", number: "1", name: "OR 1", prefix: "OR" },
  { id: "or-2", number: "2", name: "OR 2", prefix: "OR" },
  { id: "or-3", number: "3", name: "OR 3", prefix: "OR" },
  { id: "or-4", number: "4", name: "OR 4", prefix: "OR" },
  { id: "scope", number: "Scope", name: "ห้อง Scope", prefix: null },
];

/** OR 3 is being turned into an intervention room (the table's ปรับปรุงเป็น Intervention), every day. */
export const CLOSED_TEXT = "ปรับปรุงเป็นห้อง Intervention";
/** A room no department has that day (the table's ว่าง). */
export const FREE_TEXT = "ว่าง";

type Use = { dept: DeptCode; note?: string } | "free" | "closed";
type Turn = { use: Use; nth?: readonly number[] };
type Slot = readonly Turn[];
/** Monday to Friday. */
type WeekPlan = readonly [Slot, Slot, Slot, Slot, Slot];
type RoomPlan = { am: WeekPlan; pm: WeekPlan };

const dept = (code: DeptCode, note?: string): Slot => [{ use: note ? { dept: code, note } : { dept: code } }];
const FREE: Slot = [{ use: "free" }];
const CLOSED: Slot = [{ use: "closed" }];
const whole = (plan: WeekPlan): RoomPlan => ({ am: plan, pm: plan });
const TKA = dept("ORTHO", "TKA");

const PLAN: Record<ThaChalomRoom["id"], RoomPlan> = {
  "or-1": whole([TKA, dept("GENSX"), TKA, dept("GENSX"), FREE]),
  "or-2": whole([dept("VASCULAR"), dept("VASCULAR"), dept("VASCULAR"), dept("VASCULAR"), dept("VASCULAR")]),
  "or-3": whole([CLOSED, CLOSED, CLOSED, CLOSED, CLOSED]),
  "or-4": {
    am: [dept("EYE"), dept("ENT"), dept("EYE"), [{ use: { dept: "ORTHO" }, nth: [1, 3, 5] }, { use: { dept: "PLASTIC" }, nth: [2, 4] }], dept("ENT")],
    pm: [dept("EYE"), dept("ENT"), dept("ENT"), [{ use: { dept: "ORTHO" }, nth: [1, 3, 5] }, { use: { dept: "PLASTIC" }, nth: [2, 4] }], dept("ENT")],
  },
  scope: whole([FREE, dept("PLASTIC"), FREE, dept("EYE"), FREE]),
};

export type ThaChalomRoomDay = {
  room: ThaChalomRoom;
  am: ThaChalomUse;
  pm: ThaChalomUse;
  /** Morning and afternoon differ (OR 4 on Wednesdays: EYE, then ENT). */
  split: boolean;
};

function useOf(slot: Slot, nth: number): ThaChalomUse {
  const turn = slot.find((item) => !item.nth || item.nth.includes(nth));
  if (!turn || turn.use === "free") return { kind: "free" };
  if (turn.use === "closed") return { kind: "closed" };
  return { kind: "dept", dept: DEPARTMENTS[turn.use.dept], note: turn.use.note ?? null };
}

/** A use's key, to tell whether morning and afternoon are the same. */
function keyOf(use: ThaChalomUse): string {
  return use.kind === "dept" ? `${use.dept.code}:${use.note ?? ""}` : use.kind;
}

/** Every room's use on `date` (YYYY-MM-DD), in the table's order; empty on a weekend or for anything not a date. */
export function thaChalomDay(date: string): ThaChalomRoomDay[] {
  const day = weekdayIndex(date);
  const nth = weekOfMonth(date);
  if (day === null || nth === null || day > 4) return [];
  return THA_CHALOM_ROOM_LIST.map((room) => {
    const plan = PLAN[room.id];
    const am = useOf(plan.am[day], nth);
    const pm = useOf(plan.pm[day], nth);
    return { room, am, pm, split: keyOf(am) !== keyOf(pm) };
  });
}

/** How a use reads in the room list: the department's Thai name (with its note), ว่าง, or the renovation. */
export function usageText(use: ThaChalomUse): string {
  if (use.kind === "free") return FREE_TEXT;
  if (use.kind === "closed") return CLOSED_TEXT;
  return use.note ? `${use.dept.name} (${use.note})` : use.dept.name;
}

/** A room's day in words, e.g. "OR 4 · เช้า จักษุ · บ่าย โสต ศอ นาสิก". */
export function roomDayText(entry: ThaChalomRoomDay): string {
  const parts = entry.split ? [`เช้า ${usageText(entry.am)}`, `บ่าย ${usageText(entry.pm)}`] : [usageText(entry.am)];
  return [entry.room.name, ...parts].join(" · ");
}

/** The rooms a department has for at least half of `date`. */
export function openRoomCount(day: readonly ThaChalomRoomDay[]): number {
  return day.filter((entry) => entry.am.kind === "dept" || entry.pm.kind === "dept").length;
}

/**
 * The days ท่าฉลอม's date picker offers: today to PICK_AHEAD_DAYS ahead. Days before today are not offered: the table is
 * the hospital's latest, and an earlier day may have run another.
 */
export function thaChalomPickRange(today: string): { min: string; max: string } {
  return { min: today, max: addDays(today, PICK_AHEAD_DAYS) };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The day in the page's address (?date=YYYY-MM-DD), or null when there is none or it is not a workday in the range. */
export function thaChalomPickedDay(value: unknown, today: string, holidays: readonly Holiday[]): string | null {
  if (typeof value !== "string" || !ISO_DAY.test(value) || addDays(value, 0) !== value) return null;
  const { min, max } = thaChalomPickRange(today);
  if (value < min || value > max) return null;
  return isWorkday(value, holidays) ? value : null;
}

/** The top bar's line above the date: the hospital, then how the day stands to today (ตารางผ่าตัดวันนี้, ถัดไป). */
export function thaChalomEyebrow(relation: BoardDayRelation): string {
  return `รพ.ท่าฉลอม · ${boardEyebrow(relation)}`;
}
