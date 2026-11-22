import { bookingRoom, cleanOperation, deptRooms, MAX_OPERATION, roomAmong, type AddedCase } from "./added-cases.ts";
import { withoutTitle, type WorkbookCase } from "./board-rows.ts";
import { addDays } from "./days.ts";
import { isDressingCase, isEmergencyUrgency } from "./placement.ts";
import { normalizeHn } from "./hn.ts";
import type { RepairPeriods } from "./repair.ts";

/**
 * Simulated bookings (Pong, 22 Nov 2026: "Try create booking case of each day on Oct 2026 using similar hosxp cases. I
 * wanna see how it looks like and test the rules"): an admin's /?sim=1 shows a day's stored HOSxP list as if its
 * surgeons had booked their cases in the app beforehand, so the matching, the rooms and the order of a real day can be
 * seen. Nothing is saved: the bookings are made each time the board is read, from the list alone, and the day's real
 * bookings are not read. Pure and isomorphic.
 *
 * Which cases are booked, by the booking rules (booking-form rules of 15 Nov 2026): elective only, so no Stat or
 * Emergency case; a dressing is rarely booked, so one in three, in the dressing room (ห้องทำแผล) with the scrub answer
 * either way; of the rest about one in six is left unbooked, so the board's ! marks show. A case whose surgeon's
 * department has no room that day cannot be booked, as in the form. Each booking is made 2 to 8 days before at 08:00 to
 * 14:59, before the 15:00 cut-off, and they take their rooms in that order, as the server does (lib/added-cases.ts
 * roomAmong: a doctor's first booking of the day in a department with several rooms takes the one with fewer bookings,
 * the later ones join it).
 */

/** A small stable number from a text, so each case is booked (or not) the same way on every reload. */
function seed(text: string): number {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  // Mixed again, so texts that differ only in their last digits spread over every remainder.
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

/** When a simulated booking was made: 2 to 8 days before `date`, 08:00 to 14:59 Bangkok, as an ISO time. */
function bookedAtFor(date: string, mix: number): string {
  const day = addDays(date, -(2 + (mix % 7)));
  const hour = 8 + ((mix >>> 4) % 7);
  const minute = (mix >>> 8) % 60;
  return new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07:00`).toISOString();
}

/** The surgeon as one doctor, whatever spaces the file puts in the name. */
function surgeonKey(surgeon: string): string {
  return surgeon.trim().replace(/\s+/g, " ");
}

/** The day's simulated bookings for `cases` (a stored HOSxP list of `date`), oldest first, as lib/cases.ts lists them. */
export function simulatedBookings(cases: readonly WorkbookCase[], date: string, periods: RepairPeriods): AddedCase[] {
  type Draft = Omit<AddedCase, "roomId"> & { bookedAt: string };
  const drafts: Draft[] = [];
  for (const item of [...cases].sort((a, b) => a.position - b.position)) {
    const hn = normalizeHn(item.hn);
    const operation = cleanOperation(item.operation).slice(0, MAX_OPERATION);
    const surgeon = surgeonKey(item.surgeon);
    if (!hn || !operation || !surgeon || !item.dept || isEmergencyUrgency(item.urgency)) continue;
    const mix = seed(`${date}|${item.caseId}`);
    const dressing = isDressingCase(operation);
    if (dressing ? mix % 3 !== 0 : mix % 6 === 0) continue;
    drafts.push({
      id: `sim-${item.caseId}`,
      date,
      hn,
      operation,
      shift: item.shift ?? "in",
      dressing,
      scrubDoes: dressing ? (mix >>> 3) % 2 === 0 : null,
      note: "",
      surgeonId: `sim-${seed(surgeon)}`,
      surgeon: withoutTitle(surgeon),
      subtype: item.dept,
      bookedAt: bookedAtFor(date, seed(`${item.caseId}|${date}|at`)),
    });
  }
  drafts.sort((a, b) => a.bookedAt.localeCompare(b.bookedAt) || a.id.localeCompare(b.id));
  // The rooms in booking order, as the server gives them.
  const made: AddedCase[] = [];
  for (const draft of drafts) {
    const room = bookingRoom(draft.subtype, draft.operation, date, periods, draft.dressing ? "dressing" : "dept");
    if (!room.ok) continue;
    const rooms = room.dressing ? [] : deptRooms(draft.subtype, draft.operation, date, periods);
    const roomId = rooms.length > 1 ? roomAmong(rooms, draft.surgeonId, date, made, periods) : room.roomId;
    made.push({ ...draft, roomId });
  }
  return made;
}
