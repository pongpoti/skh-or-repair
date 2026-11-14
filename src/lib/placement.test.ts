import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeptCode } from "./allocation.ts";
import { isDressingCase, isScopeCase, placeCase, roomsHeldBy, UNPLACED_TEXT, type PlaceInput } from "./placement.ts";
import { DEFAULT_REPAIR_PERIODS } from "./repair.ts";
import * as week from "./week.ts";

const REPAIR = DEFAULT_REPAIR_PERIODS;
const WEEKLY_MONDAY = "2026-11-09"; // 2nd Monday, before the repair: CVT in OR 13, ORTHO in OR 11
const WEEKLY_TUESDAY = "2026-11-10";
const FIRST_MONDAY = "2026-11-16"; // first half
const SECOND_MONDAY = "2027-02-01"; // second half

const input = (dept: DeptCode | null, more: Partial<PlaceInput> = {}): PlaceInput => ({
  procedure: "operation",
  dept,
  emergency: false,
  team: null,
  ...more,
});
const room = (item: PlaceInput, date: string, load: Record<string, number> = {}) => {
  const placement = placeCase(item, date, REPAIR, new Map(Object.entries(load)));
  return placement.ok ? placement.roomId : placement.reason;
};

test("the keyword rules are the same functions lib/week.ts has always exported", () => {
  assert.equal(week.isDressingCase, isDressingCase);
  assert.equal(week.isScopeCase, isScopeCase);
});

test("outside the repair, placement is the weekly schedule's (the week export's rules)", () => {
  assert.equal(room(input("ORTHO", { procedure: "Dressing wound" }), WEEKLY_MONDAY), "or-1", "dressing: OR 1");
  assert.equal(room(input("URO", { procedure: "change vac dressing", emergency: true }), WEEKLY_MONDAY), "or-1", "dressing before emergency");
  assert.equal(room(input("ORTHO", { emergency: true }), WEEKLY_MONDAY), "or-8", "emergency: OR 8");
  assert.ok(["or-4", "or-6"].includes(room(input("OBGYN", { emergency: true }), WEEKLY_MONDAY)), "obstetrics stays in its rooms");
  assert.equal(room(input("GENSX", { procedure: "colonoscopy", team: "GENSX" }), WEEKLY_MONDAY), "or-3", "SCOPE room");
  assert.equal(room(input("GENSX", { procedure: "colonoscopy", team: "URO" }), WEEKLY_MONDAY), "or-2", "not a GENSX surgeon's");
  assert.equal(room(input("SCOPE", { procedure: "hernia" }), WEEKLY_MONDAY), "or-2", "a SCOPE-labelled case that is no endoscopy");
  assert.equal(room(input("CVT"), WEEKLY_MONDAY), "or-13");
  assert.equal(room(input("CVT"), WEEKLY_TUESDAY), "no-room", "CVT holds no room on Tuesday");
  assert.equal(room(input(null), WEEKLY_MONDAY), "no-department");
  assert.equal(room(input(null, { emergency: true }), WEEKLY_MONDAY), "or-8", "an emergency needs no department");
  assert.equal(room(input("GENSX"), "2026-11-07"), "no-room", "Saturday");
});

test("a department with several rooms gets the one with the fewest cases, the first on a tie", () => {
  // GENSX holds OR 2 and OR 5 on Monday.
  assert.deepEqual(roomsHeldBy("GENSX", WEEKLY_MONDAY, REPAIR), ["or-2", "or-5"]);
  assert.equal(room(input("GENSX"), WEEKLY_MONDAY), "or-2");
  assert.equal(room(input("GENSX"), WEEKLY_MONDAY, { "or-2": 1 }), "or-5");
  assert.equal(room(input("GENSX"), WEEKLY_MONDAY, { "or-2": 2, "or-5": 2 }), "or-2");
});

test("first half: the half's rooms, NEURO and CVT emergencies in OR 12 or 13, obstetrics off the board", () => {
  assert.equal(room(input("ORTHO", { procedure: "Dressing wound" }), FIRST_MONDAY), "or-10", "dressing");
  assert.equal(room(input("URO", { emergency: true }), FIRST_MONDAY), "or-9", "emergency");
  assert.equal(room(input(null, { emergency: true }), FIRST_MONDAY), "or-9");
  assert.equal(room(input("NEURO", { emergency: true }), FIRST_MONDAY), "or-12", "OR 12 and 13 tie: the first");
  assert.equal(room(input("CVT", { emergency: true }), FIRST_MONDAY, { "or-12": 2, "or-13": 1 }), "or-13", "the fewest cases");
  assert.equal(room(input("NEURO"), FIRST_MONDAY), "or-11", "not an emergency: no NEURO room, so the mixed room");
  assert.equal(room(input("GENSX", { procedure: "EGD", team: "GENSX" }), FIRST_MONDAY), "or-11", "SCOPE: the mixed room");
  assert.equal(room(input("SCOPE", { procedure: "hernia" }), FIRST_MONDAY), "or-12", "a SCOPE label that is no endoscopy: GENSX");
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
  assert.equal(room(input("GENSX", { procedure: "colonoscopy", team: "GENSX" }), SECOND_MONDAY), "or-4");
  assert.equal(room(input("OBGYN"), SECOND_MONDAY), "obgyn-building");
});

test("the reasons a case is not placed read in Thai", () => {
  assert.equal(UNPLACED_TEXT["obgyn-building"], "สูติ-นรีเวช ผ่าตัดที่อาคารแม่");
  assert.equal(UNPLACED_TEXT["no-department"], "ไม่ทราบแผนก");
  assert.equal(UNPLACED_TEXT["no-room"], "แผนกนี้ไม่มีห้องผ่าตัดในวันนั้น");
});
