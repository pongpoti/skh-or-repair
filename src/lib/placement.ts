import { allocationFor, weeklyGuestRooms, type DeptCode } from "./allocation.ts";
import { isDressingOperation } from "./dressing.ts";
import { repairOn, type RepairPeriods } from "./repair.ts";
import { isOpenRoom } from "./rooms.ts";

/**
 * Where a case goes on the board, by the report's rules alone (an export's own room column is never trusted). Used for
 * the HOSxP workbook upload and for the week export (lib/week.ts), so both place a case the same way. Isomorphic and
 * pure: the caller keeps the count of cases per room (`load`) and adds each placed case to it.
 */

/**
 * A dressing case, from any sub-specialty, by its name (lib/dressing.ts, Pong's words of 15 Nov 2026). It replaced the
 * hospital's own keyword rule, which left out debridement and several other procedures; a graft still keeps a case
 * out. Doctors' bookings do not use it: the surgeon picks the room (lib/added-cases.ts).
 */
export function isDressingCase(procedure: string): boolean {
  return isDressingOperation(procedure);
}

/**
 * Operation names for the SCOPE room, matched case-insensitively: the OR-export rules doc's words (rule set C: "SCOPE
 * cases -> the SCOPE room (OR 3)"), and the misspellings the Jan-Oct 2026 exports have ("colonscope", "colooscope",
 * "sigmoidscope", "igmoidoscope").
 */
const SCOPE_INCLUDE = /\begd\b|gastroscop|esophagoscop|\bogd\b|colono|colo\w{0,3}scop|sigmoido|igmoid\w{0,2}scop|\bercp\b|endoscop|\beus\b/i;
/** ...unless they are a foreign-body removal. */
const SCOPE_EXCLUDE = /remove\s*fb|foreign body|\bfb\b/i;

/**
 * A case for the SCOPE room (Pong, 21 Nov 2026: "Move scope cases to scope room using rules"): a general surgeon's case
 * (the surgeon's own department by name, lib/workbook.ts surgeonDeptOf, or a case coded SCOPE) whose operation is an
 * endoscopy (EGD, gastroscopy, colonoscopy, sigmoidoscopy, ERCP, EUS...), not a foreign-body removal.
 */
export function isScopeCase(procedure: string, dept: DeptCode | null): boolean {
  return (dept === "GENSX" || dept === "SCOPE") && SCOPE_INCLUDE.test(procedure) && !SCOPE_EXCLUDE.test(procedure);
}

/** What placement needs to know about a case. */
export type PlaceInput = {
  /** The operation name. */
  procedure: string;
  /**
   * The case's department, or null when it is not known: the surgeon's own department by name, else the export's
   * แผนก or ชนิด (lib/workbook.ts surgeonDeptOf).
   */
  dept: DeptCode | null;
  /** Marked Stat or Emergency. */
  emergency: boolean;
  /**
   * The surgeon's choice of room (lib/added-cases.ts), which wins over the name: "dept" never goes to the dressing room,
   * whatever the name; "dressing" goes to the day's dressing room (or, with none that day, where the other rules
   * place it). Left out, the name decides (isDressingCase).
   */
  choice?: RoomChoice;
};

/** The surgeon's choice for a booking: their department's room that day, or the dressing room. */
export type RoomChoice = "dept" | "dressing";

/** Why a case is left off the board. */
export type UnplacedReason = "obgyn-building" | "no-department" | "no-room";

/** The reasons in Thai, for the upload summary. */
export const UNPLACED_TEXT: Readonly<Record<UnplacedReason, string>> = {
  "obgyn-building": "สูติ-นรีเวช ผ่าตัดที่อาคารแม่",
  "no-department": "ไม่ทราบแผนก",
  "no-room": "แผนกนี้ไม่มีห้องผ่าตัดในวันนั้น",
};

export type Placement = { ok: true; roomId: string } | { ok: false; reason: UnplacedReason };

/**
 * The operating rooms in use on `date` whose department that day (morning or afternoon) is `code`, in number order.
 * During the repair that is the half's fixed layout; at the weekend there are none.
 */
export function roomsHeldBy(code: DeptCode, date: string, periods: RepairPeriods): string[] {
  const rooms: string[] = [];
  for (let n = 1; n <= 13; n += 1) {
    const id = `or-${n}`;
    if (!isOpenRoom(id, date, periods)) continue;
    const allocation = allocationFor(id, date, periods);
    if (allocation?.am?.code === code || allocation?.pm?.code === code) rooms.push(id);
  }
  return rooms;
}

/** The room with the fewest cases so far; on a tie the first in number order. */
function fewest(rooms: readonly string[], load: ReadonlyMap<string, number>): string {
  return rooms.reduce((best, room) => ((load.get(room) ?? 0) < (load.get(best) ?? 0) ? room : best));
}

const placed = (roomId: string): Placement => ({ ok: true, roomId });
const unplaced = (reason: UnplacedReason): { ok: false; reason: UnplacedReason } => ({ ok: false, reason });

/**
 * Where a case goes on `date`.
 *
 * Outside the repair (the weekly schedule): dressing cases use the dressing room (OR 1), emergency cases the emergency
 * room (OR 8; obstetrics-gynaecology stays in its own room), a general surgeon's endoscopy the SCOPE room (OR 3,
 * isScopeCase), and anything else the room its department holds that day, or, for a department with no period of its
 * own, the room it sets its cases in as a guest (chest medicine: OR 4 on Mondays, lib/allocation.ts GUESTS). A
 * department with no room that day has none: its cases are left off the board and the strip's notice counts them (Pong,
 * 27 Nov 2026: "Leave off board and display on noti bar for both places", in place of borrowing the open room with the
 * fewest cases, 22 Nov 2026). The SCOPE room takes no other case. Closed rooms take no case: with OR 8 closed an
 * emergency case goes to its department's room.
 *
 * During the repair (`periods`, lib/repair.ts), with the half's rooms: obstetrics-gynaecology is not placed at all
 * (it operates in the obstetric building); dressing cases use the dressing room; emergencies the emergency room, NEURO
 * and CVT the half's own rooms for them; departments with no room of their own the mixed-department room; anything
 * else its department's room.
 *
 * The repair has no SCOPE room, so a general surgeon's endoscopy goes to the GENSX room like the rest of their list then
 * (Pong, 19 Nov 2026: "no more scope case", after a colonoscopy showed in the mixed room).
 *
 * A department with several rooms is pooled: placeCase puts the case in the one with the fewest cases so far (`load`),
 * candidateRooms gives the whole pool, and placeAll keeps each surgeon's cases in one of them.
 */
export function placeCase(input: PlaceInput, date: string, periods: RepairPeriods, load: ReadonlyMap<string, number>): Placement {
  const candidates = candidateRooms(input, date, periods);
  return candidates.ok ? placed(fewest(candidates.rooms, load)) : candidates;
}

/** The rooms a case may go to: one, or a department's pool of several, in number order. */
export type Candidates = { ok: true; rooms: string[] } | { ok: false; reason: UnplacedReason };

/** The rooms placeCase chooses from for `input` on `date` (its rules are there), or why the case has none. */
export function candidateRooms(input: PlaceInput, date: string, periods: RepairPeriods): Candidates {
  const repair = repairOn(date, periods);
  if (repair && input.dept === "OBGYN") return unplaced("obgyn-building");
  const pool = (rooms: string[]): Candidates => ({ ok: true, rooms });

  const dressing = roomsHeldBy("INFECT", date, periods);
  const toDressing = input.choice ? input.choice === "dressing" : isDressingCase(input.procedure);
  if (toDressing && dressing.length > 0) return pool([dressing[0]]);

  if (input.emergency) {
    if (repair && (input.dept === "NEURO" || input.dept === "CVT")) {
      const own = repair.emergencyRooms.filter((room) => isOpenRoom(room, date, periods));
      if (own.length > 0) return pool(own);
    }
    const emergency = roomsHeldBy("EMER", date, periods);
    if (input.dept !== "OBGYN" && emergency.length > 0) return pool([emergency[0]]);
  }

  // A general surgeon's endoscopy goes to the SCOPE room on a day that has one (OR 3 in the weekly schedule).
  if (isScopeCase(input.procedure, input.dept)) {
    const scope = roomsHeldBy("SCOPE", date, periods);
    if (scope.length > 0) return pool(scope);
  }
  // Any other case coded SCOPE is a general surgeon's.
  const dept = input.dept === "SCOPE" ? "GENSX" : input.dept;
  if (!dept) return unplaced("no-department");

  // The dressing room takes dressing cases only.
  let rooms = roomsHeldBy(dept, date, periods).filter((room) => !dressing.includes(room));
  if (rooms.length === 0 && !repair) rooms = weeklyGuestRooms(dept, date).filter((room) => isOpenRoom(room, date, periods));
  if (rooms.length === 0) rooms = roomsHeldBy("MIXED", date, periods);
  // The weekly schedule has no mixed room: a department with no room that day (a vascular surgeon on a Monday) has none
  // (Pong, 27 Nov 2026: "Leave off board and display on noti bar"). The repair always has its mixed room.
  return rooms.length > 0 ? pool(rooms) : unplaced("no-room");
}

/** The export's urgency labels (ความเร่งด่วน) that mark an emergency. */
export function isEmergencyUrgency(urgency: string | null): boolean {
  return urgency === "Stat" || urgency === "Emergency";
}

/** What placing a workbook case needs, as lib/workbook-store.ts keeps it. */
export type PlaceableCase = {
  operation: string;
  dept: DeptCode | null;
  /** The urgency label as the export has it (Elective, Urgency, Stat, Emergency), or null. */
  urgency: string | null;
  /** The surgeon as the file names them, so a department with several rooms keeps each surgeon's cases in one. */
  surgeon?: string;
  /** The room chosen by the surgeon of a booking that matches the case (lib/board-rows.ts), which wins over the name. */
  choice?: RoomChoice;
  /** The room that booking is in (lib/added-cases.ts bookedRoom), which the case keeps when it is one of its pool. */
  bookedRoom?: string;
};

/**
 * Places a file's cases on `date`. A case with one room to go to takes it. A department with several rooms that day
 * (GENSX in OR 2 and OR 5 on a Monday of the weekly schedule) keeps each surgeon's cases in one of them (Pong, 22 Nov
 * 2026, "How to deal with matching cases of dept that has 2 OR rooms ?"; before, the cases were spread one by one and
 * split half the surgeons' lists between the rooms):
 *
 * 1. a case matched to a booking stays in the booking's room, which the doctor saw when booking (lib/added-cases.ts:
 *    a doctor's first booking of the day takes the room with fewer bookings, and the later ones join it);
 * 2. the surgeon's other cases join the room of their first booked case in the file;
 * 3. a surgeon with no booking takes the room with the fewest cases so far, the surgeons with the most cases first (on
 *    a tie, the one who comes first in the file, and the first room in number order).
 *
 * A case with no surgeon's name counts as its own surgeon. The rooms depend only on the cases, their bookings, the day
 * and which half of the repair (or none) the day falls in, so placing the same cases again gives the same rooms. That
 * is what lets the board place an upload again when it is read: an admin may move the repair's dates after MX
 * uploaded, and the cases must then go to the rooms in use under the new dates rather than stay in rooms that are now
 * closed.
 */
export function placeAll(cases: readonly PlaceableCase[], date: string, periods: RepairPeriods): Placement[] {
  const load = new Map<string, number>();
  const put = (room: string, count = 1) => load.set(room, (load.get(room) ?? 0) + count);
  const result: Placement[] = cases.map(() => unplaced("no-room"));
  /** The cases of one surgeon with one pool of rooms, in file order. */
  type Group = { rooms: string[]; members: number[]; room: string | null };
  const groups = new Map<string, Group>();
  cases.forEach((item, index) => {
    const input = { procedure: item.operation, dept: item.dept, emergency: isEmergencyUrgency(item.urgency), choice: item.choice };
    const candidates = candidateRooms(input, date, periods);
    if (!candidates.ok) {
      result[index] = candidates;
      return;
    }
    const { rooms } = candidates;
    const surgeon = item.surgeon?.trim().replace(/\s+/g, " ") || `#${index}`;
    if (rooms.length === 1) {
      result[index] = placed(rooms[0]);
      put(rooms[0]);
      return;
    }
    const key = `${rooms.join(",")}|${surgeon}`;
    const group = groups.get(key) ?? { rooms, members: [], room: null };
    groups.set(key, group);
    // 1. A booked case keeps its booking's room; the first one gives the surgeon's other cases theirs.
    if (item.bookedRoom && rooms.includes(item.bookedRoom)) {
      result[index] = placed(item.bookedRoom);
      put(item.bookedRoom);
      group.room ??= item.bookedRoom;
    } else {
      group.members.push(index);
    }
  });
  // 2. The surgeon's other cases join their booked room.
  const free: Group[] = [];
  for (const group of groups.values()) {
    if (group.members.length === 0) continue;
    if (group.room === null) {
      free.push(group);
      continue;
    }
    for (const index of group.members) result[index] = placed(group.room);
    put(group.room, group.members.length);
  }
  // 3. The surgeons with no booking, the longest list first, each in the room with the fewest cases so far.
  free.sort((a, b) => b.members.length - a.members.length || a.members[0] - b.members[0]);
  for (const group of free) {
    const room = fewest(group.rooms, load);
    for (const index of group.members) result[index] = placed(room);
    put(room, group.members.length);
  }
  return result;
}
