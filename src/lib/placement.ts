import { allocationFor, type DeptCode } from "./allocation.ts";
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
const unplaced = (reason: UnplacedReason): Placement => ({ ok: false, reason });

/**
 * Where a case goes on `date`.
 *
 * Outside the repair (the weekly schedule): dressing cases use the dressing room (OR 1), emergency cases the emergency
 * room (OR 8; obstetrics-gynaecology stays in its own room), and anything else the room its department holds that
 * day. Closed rooms take no case: with OR 8 closed an emergency case goes to its department's room.
 *
 * During the repair (`periods`, lib/repair.ts), with the half's rooms: obstetrics-gynaecology is not placed at all
 * (it operates in the obstetric building); dressing cases use the dressing room; emergencies the emergency room, NEURO
 * and CVT the half's own rooms for them; departments with no room of their own the mixed-department room; anything
 * else its department's room.
 *
 * There is no SCOPE rule any more (Pong, 19 Nov 2026: "now base on surgeon name and dept only, no more scope case"):
 * a general surgeon's endoscopy goes to the GENSX room like the rest of their list.
 *
 * A department with several rooms is pooled, so the case goes to the one with the fewest cases so far (`load`).
 */
export function placeCase(input: PlaceInput, date: string, periods: RepairPeriods, load: ReadonlyMap<string, number>): Placement {
  const repair = repairOn(date, periods);
  if (repair && input.dept === "OBGYN") return unplaced("obgyn-building");

  const dressing = roomsHeldBy("INFECT", date, periods);
  const toDressing = input.choice ? input.choice === "dressing" : isDressingCase(input.procedure);
  if (toDressing && dressing.length > 0) return placed(dressing[0]);

  if (input.emergency) {
    if (repair && (input.dept === "NEURO" || input.dept === "CVT")) {
      const own = repair.emergencyRooms.filter((room) => isOpenRoom(room, date, periods));
      if (own.length > 0) return placed(fewest(own, load));
    }
    const emergency = roomsHeldBy("EMER", date, periods);
    if (input.dept !== "OBGYN" && emergency.length > 0) return placed(emergency[0]);
  }

  const mixed = () => roomsHeldBy("MIXED", date, periods);
  // A case coded SCOPE is a general surgeon's.
  const dept = input.dept === "SCOPE" ? "GENSX" : input.dept;
  if (!dept) return unplaced("no-department");

  // The dressing room takes dressing cases only.
  let rooms = roomsHeldBy(dept, date, periods).filter((room) => !dressing.includes(room));
  if (rooms.length === 0) rooms = mixed();
  return rooms.length > 0 ? placed(fewest(rooms, load)) : unplaced("no-room");
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
  /** The room chosen by the surgeon of a booking that matches the case (lib/board-rows.ts), which wins over the name. */
  choice?: RoomChoice;
};

/**
 * Places a file's cases on `date` in the order given (the file's order), so a department with several rooms fills the
 * emptiest first. The rooms depend only on the cases, the day and which half of the repair (or none) the day falls
 * in, so placing the same cases again gives the same rooms. That is what lets the board place an upload again when it
 * is read: an admin may move the repair's dates after MX uploaded, and the cases must then go to the rooms in use
 * under the new dates rather than stay in rooms that are now closed.
 */
export function placeAll(cases: readonly PlaceableCase[], date: string, periods: RepairPeriods): Placement[] {
  const load = new Map<string, number>();
  return cases.map((item) => {
    const input = {
      procedure: item.operation,
      dept: item.dept,
      emergency: isEmergencyUrgency(item.urgency),
      choice: item.choice,
    };
    const placement = placeCase(input, date, periods, load);
    if (placement.ok) load.set(placement.roomId, (load.get(placement.roomId) ?? 0) + 1);
    return placement;
  });
}
