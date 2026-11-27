import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeptCode } from "./allocation.ts";
import { candidateRooms, isDressingCase, isScopeCase, placeAll, placeCase, roomsHeldBy, UNPLACED_TEXT, type PlaceableCase, type PlaceInput } from "./placement.ts";
import { DEFAULT_REPAIR_PERIODS } from "./repair.ts";
import { REPAIR_FROM_JAN } from "./repair-fixtures.ts";
import * as week from "./week.ts";

const REPAIR = REPAIR_FROM_JAN;
const PAST_MONDAY = "2026-11-09"; // a day the board shows looking back: the first half's rooms, as on every day since 1 Jan 2026
const AFTER_MONDAY = "2027-03-22"; // after the repair's last day: the weekly schedule again
const FIRST_MONDAY = "2026-11-16"; // first half
const SECOND_MONDAY = "2027-02-01"; // second half

const input = (dept: DeptCode | null, more: Partial<PlaceInput> = {}): PlaceInput => ({
  procedure: "operation",
  dept,
  emergency: false,
  ...more,
});
const room = (item: PlaceInput, date: string, load: Record<string, number> = {}) => {
  const placement = placeCase(item, date, REPAIR, new Map(Object.entries(load)));
  return placement.ok ? placement.roomId : placement.reason;
};

test("the keyword rules are the same functions lib/week.ts has always exported", () => {
  assert.equal(week.isDressingCase, isDressingCase);
});

test("the weekly schedule before and after the repair (Pong, 21 Nov 2026): the go-live period and after 17 Mar 2027", () => {
  // The planned dates: the repair from 8 Dec 2026 to 17 Mar 2027. Outside it the weekly schedule's rules: dressing OR 1,
  // emergencies OR 8, GENSX OR 2, each department in its own room, obstetrics in the main OR.
  const planned = (item: PlaceInput, date: string) => {
    const placement = placeCase(item, date, DEFAULT_REPAIR_PERIODS, new Map());
    return placement.ok ? placement.roomId : placement.reason;
  };
  for (const date of [PAST_MONDAY, AFTER_MONDAY]) {
    assert.equal(planned(input("ORTHO", { procedure: "Dressing wound" }), date), "or-1", `dressing ${date}`);
    assert.equal(planned(input("ORTHO", { emergency: true }), date), "or-8", `emergency ${date}`);
    assert.equal(planned(input("GENSX"), date), "or-2", `GENSX ${date}`);
    assert.equal(planned(input("CVT"), date), "or-13", `CVT, Monday of weeks 2 and 4 ${date}`);
    assert.equal(planned(input("OBGYN"), date), "or-4", `obstetrics on the board ${date}`);
    assert.equal(planned(input("EYE"), date), "or-10", `EYE ${date}`);
  }
  // From 8 Dec 2026 the first half's rooms, by themselves.
  assert.equal(planned(input("ORTHO", { procedure: "Dressing wound" }), "2026-12-14"), "or-10");
  assert.equal(planned(input("OBGYN"), "2026-12-14"), "obgyn-building");
  // With the first half from 1 Jan 2026 a past day had the first half's rooms; after the repair the weekly schedule.
  assert.equal(room(input("ORTHO", { procedure: "Dressing wound" }), PAST_MONDAY), "or-10", "dressing");
  assert.equal(room(input("GENSX"), PAST_MONDAY), "or-12");
  assert.equal(room(input("CVT"), PAST_MONDAY), "or-11", "no CVT room: the mixed room");
  assert.deepEqual(roomsHeldBy("GENSX", PAST_MONDAY, REPAIR), ["or-12"]);
  assert.equal(room(input("GENSX"), AFTER_MONDAY), "or-2");
  assert.equal(room(input("GENSX"), "2026-11-07"), "no-room", "Saturday");
});

test("a general surgeon's endoscopy goes to the SCOPE room, OR 3, in the weekly schedule (Pong, 21 Nov 2026)", () => {
  // "Move scope cases to scope room using rules": the OR-export rules doc, rule set C.
  const planned = (item: PlaceInput, date: string) => {
    const placement = placeCase(item, date, DEFAULT_REPAIR_PERIODS, new Map());
    return placement.ok ? placement.roomId : placement.reason;
  };
  const endoscopies = [
    "EGD",
    "Esophagogastroduodenoscopy [EGD]",
    "Gastroscopy",
    "Esophagoscopy",
    "OGD",
    "Colonoscope ODSสมุทรสาคร",
    "EGD + colonoscopy",
    "Set OR for screening colonoscopy under LA with MAC",
    "Flexible sigmoidoscopy with APC",
    "ERCP",
    "ERCP +-stent",
    "Endoscopic retrograde cholangiopancreatography",
    "EUS with FNA",
    // misspellings in the Jan-Oct 2026 exports
    "Colonscope ODS",
    "Colooscope",
    "Sigmoidscopy",
    "igmoidoscope under LA",
  ];
  for (const date of [PAST_MONDAY, "2026-11-11", AFTER_MONDAY]) {
    for (const procedure of endoscopies) {
      assert.equal(planned(input("GENSX", { procedure }), date), "or-3", `${procedure} ${date}`);
      assert.ok(isScopeCase(procedure, "GENSX"), procedure);
    }
    assert.equal(planned(input("SCOPE", { procedure: "colonoscopy" }), date), "or-3", "a case coded SCOPE");
    // a foreign body is taken out where the rest of general surgery's list is
    for (const procedure of ["EGD remove FB", "Esophagoscopy with removal of foreign body", "EGD FB"]) {
      assert.equal(planned(input("GENSX", { procedure }), date), "or-2", `${procedure} ${date}`);
    }
    // only a general surgeon's: another department's endoscopy stays in its own room
    assert.equal(planned(input("EYE", { procedure: "EGD" }), date), "or-10", `EYE ${date}`);
    assert.equal(planned(input("GENSX", { procedure: "Lap chole" }), date), "or-2", `not an endoscopy ${date}`);
    assert.equal(planned(input("SCOPE", { procedure: "Lap chole" }), date), "or-2", `coded SCOPE, not an endoscopy ${date}`);
    // the emergency room first, as for any emergency
    assert.equal(planned(input("GENSX", { procedure: "EGD", emergency: true }), date), "or-8", `emergency ${date}`);
  }
  for (const procedure of ["Laparoscopic cholecystectomy", "Laparoscopic sigmoidectomy", "Lap colectomy", "Colostomy closure", "Cystoscopy", "Thoracoscopy", "Colposcopy", "Set OR for change gastrostomy (under fluoroscope)"]) {
    assert.equal(isScopeCase(procedure, "GENSX"), false, procedure);
  }
  assert.equal(isScopeCase("Functional endoscopic sinus surgery", "ENT"), false, "an ENT surgeon's");
  assert.equal(isScopeCase("EGD", null), false, "no department");
  assert.equal(isScopeCase("EGD", "PEDSX"), false, "a paediatric surgeon's");
  // The repair has no SCOPE room: the GENSX room then (Pong, 19 Nov 2026, after a colonoscopy in the mixed room).
  assert.equal(planned(input("GENSX", { procedure: "EGD" }), "2026-12-14"), "or-12", "first half");
  assert.equal(planned(input("GENSX", { procedure: "EGD" }), "2027-02-01"), "or-5", "second half");
  // An admin's switch to a half's rooms has no SCOPE room either; to the weekly schedule, OR 3.
  assert.deepEqual(placeCase(input("GENSX", { procedure: "EGD" }), PAST_MONDAY, { ...DEFAULT_REPAIR_PERIODS, mode: "half1" }, new Map()), { ok: true, roomId: "or-12" });
  assert.deepEqual(placeCase(input("GENSX", { procedure: "EGD" }), "2026-12-14", { ...DEFAULT_REPAIR_PERIODS, mode: "normal" }, new Map()), { ok: true, roomId: "or-3" });
  // At the weekend no room.
  assert.equal(planned(input("GENSX", { procedure: "EGD" }), "2026-11-07"), "no-room");
});

test("chest medicine sets its cases in OR 4 on Mondays in the weekly schedule, the mixed room during the repair", () => {
  const planned = (item: PlaceInput, date: string) => {
    const placement = placeCase(item, date, DEFAULT_REPAIR_PERIODS, new Map());
    return placement.ok ? placement.roomId : placement.reason;
  };
  for (const date of [PAST_MONDAY, AFTER_MONDAY]) assert.equal(planned(input("CHEST"), date), "or-4", date);
  assert.equal(planned(input("CHEST"), "2026-11-10"), "no-room", "Tuesday: no room");
  assert.equal(planned(input("CHEST", { emergency: true }), PAST_MONDAY), "or-8", "an emergency still goes to OR 8");
  assert.equal(planned(input("CHEST", { procedure: "Dressing wound" }), PAST_MONDAY), "or-1");
  assert.equal(room(input("CHEST"), FIRST_MONDAY), "or-11", "first half: the mixed room");
  assert.equal(room(input("CHEST"), SECOND_MONDAY), "or-4", "second half: OR 4 is the mixed room");
});

test("first half: the half's rooms, NEURO and CVT emergencies in OR 12 or 13, obstetrics off the board", () => {
  assert.equal(room(input("ORTHO", { procedure: "Dressing wound" }), FIRST_MONDAY), "or-10", "dressing");
  assert.equal(room(input("URO", { emergency: true }), FIRST_MONDAY), "or-9", "emergency");
  assert.equal(room(input(null, { emergency: true }), FIRST_MONDAY), "or-9");
  assert.equal(room(input("NEURO", { emergency: true }), FIRST_MONDAY), "or-12", "OR 12 and 13 tie: the first");
  assert.equal(room(input("CVT", { emergency: true }), FIRST_MONDAY, { "or-12": 2, "or-13": 1 }), "or-13", "the fewest cases");
  assert.equal(room(input("NEURO"), FIRST_MONDAY), "or-11", "not an emergency: no NEURO room, so the mixed room");
  // No SCOPE room during the repair: a general surgeon's endoscopy in GENSX's room (Pong, 19 Nov 2026: "no more scope case")
  for (const procedure of ["EGD", "Colonoscope", "ERCP", "ERCP +-stent", "EUS"]) {
    assert.equal(room(input("GENSX", { procedure }), FIRST_MONDAY), "or-12", `${procedure}: GENSX's room`);
  }
  assert.equal(room(input("SCOPE", { procedure: "colonoscopy" }), FIRST_MONDAY), "or-12", "a SCOPE label: a general surgeon's");
  assert.equal(room(input("GENSX"), FIRST_MONDAY), "or-12");
  assert.equal(room(input("ORTHO"), FIRST_MONDAY), "or-13");
  assert.equal(room(input("EYE"), FIRST_MONDAY), "or-11");
  assert.equal(room(input("VASCULAR"), FIRST_MONDAY), "or-11");
  assert.equal(room(input(null), FIRST_MONDAY), "no-department");
  for (const item of [input("OBGYN"), input("OBGYN", { emergency: true }), input("OBGYN", { procedure: "dressing" })]) {
    assert.equal(room(item, FIRST_MONDAY), "obgyn-building", JSON.stringify(item));
  }
  assert.equal(room(input("GENSX"), "2026-11-21"), "no-room", "Saturday");
});

test("second half: the half's rooms, NEURO and CVT emergencies in OR 2", () => {
  assert.equal(room(input("EYE", { procedure: "ทำแผล" }), SECOND_MONDAY), "or-1");
  assert.equal(room(input("URO", { emergency: true }), SECOND_MONDAY), "or-3");
  assert.equal(room(input("NEURO", { emergency: true }), SECOND_MONDAY, { "or-2": 9 }), "or-2");
  assert.equal(room(input("CVT", { emergency: true }), SECOND_MONDAY), "or-2");
  assert.equal(room(input("GENSX"), SECOND_MONDAY), "or-5");
  assert.equal(room(input("ORTHO"), SECOND_MONDAY), "or-2");
  assert.equal(room(input("URO"), SECOND_MONDAY), "or-4");
  assert.equal(room(input("GENSX", { procedure: "colonoscopy" }), SECOND_MONDAY), "or-5", "an endoscopy in GENSX's room");
  assert.equal(room(input("OBGYN"), SECOND_MONDAY), "obgyn-building");
});

test("the reasons a case is not placed read in Thai", () => {
  assert.equal(UNPLACED_TEXT["obgyn-building"], "สูติ-นรีเวช ผ่าตัดที่อาคารแม่");
  assert.equal(UNPLACED_TEXT["no-department"], "ไม่ทราบแผนก");
  assert.equal(UNPLACED_TEXT["no-room"], "แผนกนี้ไม่มีห้องผ่าตัดในวันนั้น");
});

test("a department with no room that day is left off the board (Pong, 27 Nov 2026: \"Leave off board and display on noti bar\")", () => {
  // In place of borrowing the open room with the fewest cases (22 Nov 2026): a vascular surgeon on a Tuesday, when the
  // weekly schedule gives vascular surgery no room.
  const TUESDAY = "2027-03-23";
  const P = DEFAULT_REPAIR_PERIODS;
  assert.deepEqual(candidateRooms(input("VASCULAR"), TUESDAY, P), { ok: false, reason: "no-room" });
  const vx = (surgeon: string, more: Partial<PlaceableCase> = {}): PlaceableCase => ({ operation: "EVLA", dept: "VASCULAR", urgency: "Elective", surgeon, ...more });
  const rooms = (cases: PlaceableCase[], date = TUESDAY) => placeAll(cases, date, P).map((placement) => (placement.ok ? placement.roomId : placement.reason));
  assert.deepEqual(rooms([vx("A"), vx("B")]), ["no-room", "no-room"]);
  // A booking's room does not place it either: the board shows a matched pair in the booking's room on its own.
  assert.deepEqual(rooms([vx("A", { choice: "dept", bookedRoom: "or-9" })]), ["no-room"]);
  // The dressing and emergency cases keep their rooms.
  assert.deepEqual(rooms([vx("A", { operation: "Wound dressing" }), vx("A", { urgency: "Emergency" })]), ["or-1", "or-8"]);
  // At the weekend no room; during the repair the mixed room, as before.
  assert.equal(room(input("VASCULAR"), "2027-03-27"), "no-room", "Saturday");
  assert.equal(room(input("VASCULAR"), FIRST_MONDAY), "or-11", "the repair's mixed room");
});

test("a department with two rooms keeps each surgeon's cases in one room (Pong, 22 Nov 2026)", () => {
  // Monday 23 Nov 2026, the weekly schedule: GENSX holds OR 2 and OR 5.
  const MONDAY = "2026-11-23";
  assert.deepEqual(roomsHeldBy("GENSX", MONDAY, DEFAULT_REPAIR_PERIODS), ["or-2", "or-5"]);
  const gx = (surgeon: string, more: Partial<PlaceableCase> = {}): PlaceableCase => ({ operation: "Lap chole", dept: "GENSX", urgency: "Elective", surgeon, ...more });
  const rooms = (cases: PlaceableCase[], date = MONDAY) =>
    placeAll(cases, date, DEFAULT_REPAIR_PERIODS).map((placement) => (placement.ok ? placement.roomId : placement.reason));

  // In file order A, B, A, C, A, B: A has the longest list and takes OR 2, B then the emptier OR 5, C joins B's OR 5.
  // Spread one by one, as before, A's three cases went to OR 2, OR 2 and OR 5.
  assert.deepEqual(rooms([gx("A"), gx("B"), gx("A"), gx("C"), gx("A"), gx("B")]), ["or-2", "or-5", "or-2", "or-5", "or-2", "or-5"]);
  // The same surgeon however the file spaces the name.
  assert.deepEqual(rooms([gx("นพ. ก  ข"), gx("นพ. ก ข "), gx("นพ. ค ง")]), ["or-2", "or-2", "or-5"]);
  // On a tie, the surgeon who comes first in the file, in the first room.
  assert.deepEqual(rooms([gx("B"), gx("A"), gx("A"), gx("B")]), ["or-2", "or-5", "or-5", "or-2"]);
  // A case with no surgeon's name counts as its own surgeon.
  assert.deepEqual(rooms([gx(""), gx(""), gx("")]), ["or-2", "or-5", "or-2"]);

  // A booked case keeps its booking's room, and the surgeon's other cases join it; the others fill the emptier room.
  assert.deepEqual(rooms([gx("A"), gx("B"), gx("A", { choice: "dept", bookedRoom: "or-5" }), gx("A"), gx("B")]), ["or-5", "or-2", "or-5", "or-5", "or-2"]);
  // Two bookings in different rooms (made before this rule) each keep theirs; the rest follow the first in the file.
  assert.deepEqual(
    rooms([gx("A", { choice: "dept", bookedRoom: "or-5" }), gx("A", { choice: "dept", bookedRoom: "or-2" }), gx("A")]),
    ["or-5", "or-2", "or-5"],
  );
  // A booking's room that is not one of the department's rooms that day does not count.
  assert.deepEqual(rooms([gx("A", { choice: "dept", bookedRoom: "or-12" }), gx("B"), gx("B")]), ["or-5", "or-2", "or-2"]);

  // Other rules first: an emergency to OR 8, an endoscopy to OR 3, a dressing to OR 1, and a department with one room
  // that day (EYE, OR 10) is not pooled.
  assert.deepEqual(
    rooms([gx("A", { urgency: "Emergency" }), gx("A", { operation: "EGD" }), gx("A", { operation: "Wound dressing" }), gx("A"), { operation: "Phaco", dept: "EYE", urgency: null, surgeon: "A" }]),
    ["or-8", "or-3", "or-1", "or-2", "or-10"],
  );
  // ORTHO's two rooms (OR 11 and OR 12 on this 4th Monday) the same way.
  const ortho = (surgeon: string): PlaceableCase => ({ operation: "ORIF", dept: "ORTHO", urgency: "Elective", surgeon });
  assert.deepEqual(rooms([ortho("X"), ortho("Y"), ortho("X")]), ["or-11", "or-12", "or-11"]);
  // During the repair a department has one room: nothing changes.
  assert.deepEqual(rooms([gx("A"), gx("B"), gx("A")], "2026-12-14"), ["or-12", "or-12", "or-12"]);
});
