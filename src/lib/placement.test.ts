import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeptCode } from "./allocation.ts";
import { isDressingCase, placeCase, roomsHeldBy, UNPLACED_TEXT, type PlaceInput } from "./placement.ts";
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
  // Pong, 19 Nov 2026: "now base on surgeon name and dept only, no more scope case"
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
