import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBoardRows, type WorkbookCase } from "./board-rows.ts";
import { DEFAULT_REPAIR_PERIODS } from "./repair.ts";
import { simulatedBookings } from "./sim-bookings.ts";

// Pong, 22 Nov 2026: "Try create booking case of each day on Oct 2026 using similar hosxp cases. I wanna see how it
// looks like and test the rules". Made-up cases on Monday 5 Oct 2026, the weekly schedule: GENSX holds OR 2 and OR 5,
// ORTHO OR 12 and OR 13 (the first Monday), dressings OR 1, emergencies OR 8.
const DAY = "2026-10-05";
const P = DEFAULT_REPAIR_PERIODS;
const SURGEONS = ["นพ. หนึ่ง ทดสอบ", "พญ. สอง ทดสอบ", "นพ. สาม ทดสอบ", "นพ. สี่ ทดสอบ"];

function day(count: number): WorkbookCase[] {
  return Array.from({ length: count }, (_, i) => ({
    caseId: String(800000 + i),
    hn: `99${String(i).padStart(5, "0")}`,
    operation: i % 10 === 9 ? "Wound dressing" : i % 2 === 0 ? "Lap chole" : "ORIF radius",
    surgeon: SURGEONS[i % SURGEONS.length],
    dept: i % 2 === 0 ? "GENSX" : "ORTHO",
    team: null,
    urgency: i % 17 === 16 ? "Emergency" : "Elective",
    shift: "in",
    status: "scheduled",
    position: i + 1,
  }));
}

test("simulated bookings: the same every time, elective only, booked by the case's own surgeon before the cut-off", () => {
  const cases = day(120);
  const made = simulatedBookings(cases, DAY, P);
  assert.deepEqual(simulatedBookings(cases, DAY, P), made, "the same bookings on every read");
  const byId = new Map(cases.map((item) => [`sim-${item.caseId}`, item]));
  for (const booking of made) {
    const item = byId.get(booking.id);
    assert.ok(item, booking.id);
    assert.notEqual(item.urgency, "Emergency", "no emergency is booked");
    assert.equal(booking.hn, item.hn);
    assert.equal(booking.operation, item.operation);
    assert.equal(booking.surgeon, item.surgeon.replace(/^(นพ|พญ)\. /, ""), "the surgeon without the title");
    assert.equal(booking.subtype, item.dept);
    assert.equal(booking.date, DAY);
    // 2 to 8 days before, 08:00 to 14:59 Bangkok: before the 15:00 cut-off of the workday before.
    const at = new Date(booking.bookedAt ?? "");
    const bangkok = new Date(at.getTime() + 7 * 3600_000);
    const daysBefore = (Date.parse(`${DAY}T00:00:00Z`) - Date.parse(`${bangkok.toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000;
    assert.ok(daysBefore >= 2 && daysBefore <= 8, `${booking.id}: ${daysBefore} days before`);
    assert.ok(bangkok.getUTCHours() >= 8 && bangkok.getUTCHours() <= 14, `${booking.id}: at ${bangkok.getUTCHours()}`);
    assert.equal(booking.dressing, item.operation === "Wound dressing");
    assert.equal(typeof booking.scrubDoes === "boolean", booking.dressing, "a scrub answer with a dressing-room booking only");
  }
  // Oldest first, as the board reads them.
  assert.deepEqual(made.map((booking) => booking.bookedAt), made.map((booking) => booking.bookedAt).toSorted());
  // Most elective cases are booked; dressings rarely.
  const elective = cases.filter((item) => item.urgency !== "Emergency" && item.operation !== "Wound dressing").length;
  const booked = made.filter((booking) => !booking.dressing).length;
  assert.ok(booked / elective > 0.7 && booked < elective, `${booked} of ${elective} booked`);
  const dressings = made.filter((booking) => booking.dressing).length;
  assert.ok(dressings > 0 && dressings < cases.filter((item) => item.operation === "Wound dressing").length, `${dressings} dressings booked`);
});

test("simulated bookings go through the board's rules: one surgeon, one room, and every booking finds its case", () => {
  const cases = day(120);
  const made = simulatedBookings(cases, DAY, P);
  // A department with two rooms: each surgeon's bookings in one of them, and both rooms used.
  const roomsOf = new Map<string, Set<string>>();
  for (const booking of made.filter((item) => !item.dressing)) {
    const rooms = roomsOf.get(booking.surgeonId) ?? new Set<string>();
    rooms.add(booking.roomId);
    roomsOf.set(booking.surgeonId, rooms);
  }
  for (const [surgeon, rooms] of roomsOf) assert.equal(rooms.size, 1, `${surgeon}: ${[...rooms]}`);
  assert.deepEqual([...new Set(made.filter((item) => item.subtype === "GENSX").map((item) => item.roomId))].sort(), ["or-2", "or-5"]);
  assert.ok(made.filter((item) => item.dressing).every((item) => item.roomId === "or-1"), "dressings in OR 1");

  const built = buildBoardRows({ date: DAY, periods: P, workbook: cases, bookings: made, viewer: { allHn: true, userId: null } });
  assert.equal(built.matched, made.length, "every booking is matched");
  assert.equal(built.unmatched.length, 0);
  // A matched row is in its booking's room; HOSxP's cases nobody booked are flagged (not in the dressing room).
  // (A department's rows are listed in each of its rooms; the room a case is in is the row that is no copy.)
  const homes = built.rows.filter((row) => !row.shownFrom);
  const rows = new Map(homes.map((row) => [row.id, row]));
  for (const booking of made) assert.equal(rows.get(`mt-${booking.id}`)?.roomId, booking.roomId, booking.id);
  const unbooked = built.rows.filter((row) => row.source === "hosxp");
  assert.ok(unbooked.length > 0 && unbooked.every((row) => row.flag === (row.roomId === "or-1" ? null : "unbooked")));
  // No surgeon's list is split between a department's two rooms.
  const surgeonRooms = new Map<string, Set<string>>();
  for (const row of homes.filter((item) => ["or-2", "or-5", "or-12", "or-13"].includes(item.roomId))) {
    const rooms = surgeonRooms.get(row.surgeon) ?? new Set<string>();
    rooms.add(row.roomId);
    surgeonRooms.set(row.surgeon, rooms);
  }
  for (const [surgeon, rooms] of surgeonRooms) assert.equal(rooms.size, 1, `${surgeon}: ${[...rooms]}`);
});

test("simulated bookings: nothing for a day with no list, a case with no HN, surgeon or department", () => {
  assert.deepEqual(simulatedBookings([], DAY, P), []);
  const [item] = day(1);
  for (const more of [{ hn: "" }, { surgeon: " " }, { dept: null }, { operation: "" }]) {
    assert.deepEqual(simulatedBookings([{ ...item, ...more }], DAY, P), [], JSON.stringify(more));
  }
});

test("simulated bookings: a surgeon books as one department, the first case's, as a doctor has one", () => {
  // A surgeon not on the surgeon list keeps each case's own แผนก: here GENSX first, then VASCULAR.
  const cases: WorkbookCase[] = day(12).map((item, i) => ({ ...item, surgeon: "นพ. ห้า ทดสอบ", dept: i === 0 ? "GENSX" : "VASCULAR", operation: "EVLA", urgency: "Elective" }));
  const made = simulatedBookings(cases, DAY, P);
  assert.ok(made.length > 1);
  assert.deepEqual([...new Set(made.map((booking) => booking.subtype))], ["GENSX"]);
  assert.equal(new Set(made.map((booking) => booking.roomId)).size, 1, "one room");
});
