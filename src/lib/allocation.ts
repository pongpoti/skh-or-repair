import { repairOn, type RepairPeriods } from "./repair.ts";

/**
 * Which department owns each operating room, Monday to Friday.
 *
 * Source: the new proposed OR schedule (ตารางผ่าตัดใหม่ที่นำเสนอ, Pong, 4 Nov 2026). Each room has one department
 * all day, except OR 5 on Tuesday (paediatric surgery in the morning, general surgery in the afternoon) and OR 11 on
 * Friday (vascular in the morning, nephrology in the afternoon). On Mondays OR 11 and OR 13 alternate by week of the
 * month: weeks 1, 3 and 5 CVT in OR 11 and ORTHO in OR 13, weeks 2 and 4 the other way round. Periods the schedule
 * marks as over quota (*) count as the department's like any other.
 */

export type DeptCode =
  | "GENSX"
  | "SCOPE"
  | "VASCULAR"
  | "ORTHO"
  | "OBGYN"
  | "EYE"
  | "URO"
  | "PLASTIC"
  | "ENT"
  | "NEPHRO"
  | "CHEST"
  | "PEDSX"
  | "NEURO"
  | "CVT"
  | "MAXILLO"
  | "INFECT"
  | "EMER"
  | "MINOR"
  | "MIXED"
  | "UNK";

export type Department = {
  code: DeptCode;
  /** Full Thai name, as in the report's abbreviation key. */
  name: string;
  /** Short text drawn on the plan, five characters at most so every room's label is the same size: the code, or an abbreviation of it. */
  label: string;
  /** The department's colour in the report's schedule and floor plans. */
  color: string;
};

function dept(code: DeptCode, name: string, color: string, label: string = code): Department {
  return { code, name, label, color };
}

/**
 * Department names and colours. Each colour stands for what the department does (Pong approved this palette on 14 Nov
 * 2026, in place of the colours from the 4 Nov schedule image): red for emergencies, a deep heart red for CVT, vein
 * blue for vascular, surgical-drape green for general surgery, and so on (the comment on each line). Every colour is
 * dark enough that its white label clears 4.5:1 (the tests check this).
 */
export const DEPARTMENTS: Record<DeptCode, Department> = {
  GENSX: dept("GENSX", "ศัลยกรรมทั่วไป", "#1E7B3C"), // surgical drapes and scrubs
  SCOPE: dept("SCOPE", "ส่องกล้องทางเดินอาหาร", "#6B7016"), // bile, the digestive tract
  VASCULAR: dept("VASCULAR", "ศัลยกรรมหลอดเลือด", "#2E4FA8", "VAS"), // veins as anatomy drawings show them
  ORTHO: dept("ORTHO", "ออร์โธปิดิกส์", "#455A64"), // X-ray film and implant steel
  OBGYN: dept("OBGYN", "สูติ-นรีเวชกรรม", "#C2185B"), // women and mothers
  EYE: dept("EYE", "จักษุ", "#0277BD"), // the iris
  URO: dept("URO", "ศัลยกรรมทางเดินปัสสาวะ", "#9A6B00"), // urine
  PLASTIC: dept("PLASTIC", "ศัลยกรรมตกแต่ง", "#A85C52", "PLAST"), // skin
  ENT: dept("ENT", "โสต ศอ นาสิก", "#00838F"), // breath through nose and throat
  NEPHRO: dept("NEPHRO", "อายุรกรรมโรคไต", "#6B4A2E", "NEPHR"), // a kidney bean
  /** Not in the schedule: the pulmonologists in the admin list. */
  CHEST: dept("CHEST", "อายุรกรรมโรคปอด", "#5867B8"), // air and the lungs
  PEDSX: dept("PEDSX", "ศัลยกรรมเด็ก", "#C25400"), // children, cheerful
  NEURO: dept("NEURO", "ศัลยกรรมระบบประสาท", "#5E35B1"), // the brain
  CVT: dept("CVT", "ศัลยกรรมหัวใจและทรวงอก", "#931A32"), // the heart
  MAXILLO: dept("MAXILLO", "แม็กซิลโลเฟเชียล", "#8A5A83", "MAXI"), // the face and lips
  INFECT: dept("INFECT", "เคสทำแผล (ทุกสาขา)", "#8E3E12", "D/S"), // betadine on a dressing
  EMER: dept("EMER", "เคสฉุกเฉิน (ทุกสาขา)", "#D32F2F"), // an emergency
  MINOR: dept("MINOR", "เคส LA ทุกแผนก", "#5F7380"), // a quiet small case
  /** Not in the schedule: a room for any department during the ventilation repair (lib/repair.ts). */
  MIXED: dept("MIXED", "คละแผนก", "#5C5650", "OTHER"), // neutral: shared by any department
  /** Not in the schedule: the colour of a room that has cases but no department. */
  UNK: dept("UNK", "ไม่ทราบสาขา", "#7A746C"), // neutral: department not known
};

/** A department holding the room on a given day. `nth` limits it to those occurrences of the weekday in the month. */
type Turn = { dept: DeptCode; nth?: readonly number[] };
/** Empty means the room is not allocated that day. */
type Slot = readonly Turn[];
/** Monday to Friday. */
type WeekPlan = readonly [Slot, Slot, Slot, Slot, Slot];

const one = (code: DeptCode): Slot => [{ dept: code }];
const always = (code: DeptCode): WeekPlan => [one(code), one(code), one(code), one(code), one(code)];

/** Monday's turns in OR 11 and OR 13: `odd` in weeks 1, 3 and 5 of the month, `even` in weeks 2 and 4. */
const mondayTurns = (odd: DeptCode, even: DeptCode): Slot => [
  { dept: odd, nth: [1, 3, 5] },
  { dept: even, nth: [2, 4] },
];

type RoomPlan = { am: WeekPlan; pm: WeekPlan };
const whole = (plan: WeekPlan): RoomPlan => ({ am: plan, pm: plan });

const PLAN: Record<string, RoomPlan> = {
  "or-1": whole(always("INFECT")),
  "or-2": whole(always("GENSX")),
  "or-3": whole(always("SCOPE")),
  "or-4": whole([one("OBGYN"), one("ENT"), one("ENT"), one("ENT"), one("ENT")]),
  "or-5": {
    am: [one("GENSX"), one("PEDSX"), one("PEDSX"), one("GENSX"), one("GENSX")],
    pm: [one("GENSX"), one("GENSX"), one("PEDSX"), one("GENSX"), one("GENSX")],
  },
  "or-6": whole(always("OBGYN")),
  "or-7": whole(always("URO")),
  "or-8": whole(always("EMER")),
  "or-9": whole([one("PLASTIC"), one("MAXILLO"), one("PLASTIC"), one("PLASTIC"), one("OBGYN")]),
  "or-10": whole(always("EYE")),
  "or-11": {
    am: [mondayTurns("CVT", "ORTHO"), one("ORTHO"), one("ORTHO"), one("ORTHO"), one("VASCULAR")],
    pm: [mondayTurns("CVT", "ORTHO"), one("ORTHO"), one("ORTHO"), one("ORTHO"), one("NEPHRO")],
  },
  "or-12": whole([one("ORTHO"), one("NEURO"), one("ORTHO"), one("NEURO"), one("ORTHO")]),
  "or-13": whole([mondayTurns("ORTHO", "CVT"), one("ORTHO"), one("CVT"), one("ORTHO"), one("ORTHO")]),
};

export type RoomAllocation = {
  /** Morning owner, or null when the room is not allocated. */
  am: Department | null;
  /** Afternoon owner. Same as `am` for rooms that are not split. */
  pm: Department | null;
  /** Morning and afternoon belong to different departments. */
  split: boolean;
  /** The ventilation repair's fixed use, not the weekly schedule (the department keeps its own colour). */
  repair: boolean;
};

/** 0 = Monday … 6 = Sunday, or null for anything that is not a calendar date. */
export function weekdayIndex(iso: string): number | null {
  const date = parseDate(iso);
  return date ? (date.getUTCDay() + 6) % 7 : null;
}

/** Which occurrence of its weekday this date is within the month (1–5). */
export function weekOfMonth(iso: string): number | null {
  const date = parseDate(iso);
  return date ? Math.floor((date.getUTCDate() - 1) / 7) + 1 : null;
}

function parseDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? date : null;
}

function owner(slot: Slot, nth: number): Department | null {
  const turn = slot.find((item) => !item.nth || item.nth.includes(nth));
  return turn ? DEPARTMENTS[turn.dept] : null;
}

/**
 * Who holds `roomId` on `date` (YYYY-MM-DD). Null when the schedule says nothing:
 * a weekend, an unknown room, or an invalid date.
 *
 * During the ventilation repair (`periods`, lib/repair.ts) the weekly schedule is set aside: a room in use holds its
 * one department all day, in the department's own colour (Pong, 14 Nov 2026), and a recovery, instrument or closed
 * room holds none.
 */
export function allocationFor(roomId: string, date: string, periods: RepairPeriods): RoomAllocation | null {
  const plan = PLAN[roomId];
  const day = weekdayIndex(date);
  const nth = weekOfMonth(date);
  if (!plan || day === null || nth === null || day > 4) return null;

  const repair = repairOn(date, periods);
  if (repair) {
    const use = repair.rooms[roomId];
    if (!use || use === "RR" || use === "INSTR") return null;
    const dept = DEPARTMENTS[use];
    return { am: dept, pm: dept, split: false, repair: true };
  }

  const am = owner(plan.am[day], nth);
  const pm = owner(plan.pm[day], nth);
  return { am, pm, split: am?.code !== pm?.code, repair: false };
}

/** Plain-text owner for labels and tooltips, e.g. "เช้า ศัลยกรรมทางเดินปัสสาวะ · บ่าย ศัลยกรรมตกแต่ง". */
export function allocationText(allocation: RoomAllocation): string {
  if (allocation.split) {
    return [
      `เช้า ${allocation.am?.name ?? "ไม่จัดสรร"}`,
      `บ่าย ${allocation.pm?.name ?? "ไม่จัดสรร"}`,
    ].join(" · ");
  }
  return allocation.am?.name ?? "ไม่จัดสรร";
}

/** Same as the UI ink. Dark text on every department colour clears 4.5:1 at this value. */
export const INK = "#241c16";

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** White or ink, whichever reads better on `hex` (#rrggbb). */
export function readableTextOn(hex: string): string {
  const light = luminance(hex);
  const againstWhite = 1.05 / (light + 0.05);
  const againstInk = (light + 0.05) / (luminance(INK) + 0.05);
  return againstWhite >= againstInk ? "#ffffff" : INK;
}
