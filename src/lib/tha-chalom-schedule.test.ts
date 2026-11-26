import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLOSED_TEXT,
  openRoomCount,
  roomDayText,
  THA_CHALOM_ROOM_LIST,
  thaChalomDay,
  thaChalomPickedDay,
  thaChalomPickRange,
  type ThaChalomRoomDay,
  type ThaChalomUse,
} from "./tha-chalom-schedule.ts";

/** A use as a short code: the department (with its note), FREE or CLOSED. */
function code(use: ThaChalomUse): string {
  if (use.kind === "dept") return use.note ? `${use.dept.code} (${use.note})` : use.dept.code;
  return use.kind === "free" ? "FREE" : "CLOSED";
}

/** A day as room → code, "am / pm" where the halves differ. */
function table(day: readonly ThaChalomRoomDay[]): Record<string, string> {
  return Object.fromEntries(day.map((entry) => [entry.room.id, entry.split ? `${code(entry.am)} / ${code(entry.pm)}` : code(entry.am)]));
}

test("ท่าฉลอม's rooms: OR 1 to 4, then the Scope room", () => {
  assert.deepEqual(
    THA_CHALOM_ROOM_LIST.map((room) => [room.id, room.prefix, room.number, room.name]),
    [
      ["or-1", "OR", "1", "OR 1"],
      ["or-2", "OR", "2", "OR 2"],
      ["or-3", "OR", "3", "OR 3"],
      ["or-4", "OR", "4", "OR 4"],
      ["scope", null, "Scope", "ห้อง Scope"],
    ],
  );
});

test("each weekday as in the hospital's table of 25 Nov 2026", () => {
  // 30 Nov 2026 is a Monday; 3 Dec is the month's first Thursday.
  assert.deepEqual(table(thaChalomDay("2026-11-30")), {
    "or-1": "ORTHO (TKA)",
    "or-2": "VASCULAR",
    "or-3": "CLOSED",
    "or-4": "EYE",
    scope: "FREE",
  });
  assert.deepEqual(table(thaChalomDay("2026-12-01")), {
    "or-1": "GENSX",
    "or-2": "VASCULAR",
    "or-3": "CLOSED",
    "or-4": "ENT",
    scope: "PLASTIC",
  });
  assert.deepEqual(table(thaChalomDay("2026-12-02")), {
    "or-1": "ORTHO (TKA)",
    "or-2": "VASCULAR",
    "or-3": "CLOSED",
    "or-4": "EYE / ENT",
    scope: "FREE",
  });
  assert.deepEqual(table(thaChalomDay("2026-12-03")), {
    "or-1": "GENSX",
    "or-2": "VASCULAR",
    "or-3": "CLOSED",
    "or-4": "ORTHO",
    scope: "EYE",
  });
  assert.deepEqual(table(thaChalomDay("2026-12-04")), {
    "or-1": "FREE",
    "or-2": "VASCULAR",
    "or-3": "CLOSED",
    "or-4": "ENT",
    scope: "FREE",
  });
});

test("OR 4 on Thursdays: ORTHO in weeks 1, 3 and 5, ศัลยกรรมตกแต่ง in weeks 2 and 4", () => {
  const or4 = (date: string) => table(thaChalomDay(date))["or-4"];
  assert.equal(or4("2026-12-03"), "ORTHO");
  assert.equal(or4("2026-12-10"), "PLASTIC");
  assert.equal(or4("2026-12-17"), "ORTHO");
  assert.equal(or4("2026-12-24"), "PLASTIC");
  assert.equal(or4("2026-12-31"), "ORTHO");
});

test("no rooms at the weekend or for anything not a date", () => {
  assert.deepEqual(thaChalomDay("2026-11-28"), []);
  assert.deepEqual(thaChalomDay("2026-11-29"), []);
  assert.deepEqual(thaChalomDay("2026-02-30"), []);
  assert.deepEqual(thaChalomDay("not a date"), []);
});

test("a room's day in words, and how many rooms are open", () => {
  const wednesday = thaChalomDay("2026-12-02");
  assert.deepEqual(wednesday.map(roomDayText), [
    "OR 1 · ออร์โธปิดิกส์ (TKA)",
    "OR 2 · ศัลยกรรมหลอดเลือด",
    `OR 3 · ${CLOSED_TEXT}`,
    "OR 4 · เช้า จักษุ · บ่าย โสต ศอ นาสิก",
    "ห้อง Scope · ว่าง",
  ]);
  assert.equal(openRoomCount(wednesday), 3);
  assert.equal(openRoomCount(thaChalomDay("2026-12-01")), 4);
  assert.equal(openRoomCount(thaChalomDay("2026-12-04")), 2);
});

test("the picker offers today to 60 days ahead, workdays only", () => {
  const holidays = [{ date: "2026-12-07", name: "วันพ่อแห่งชาติ (ชดเชย)" }];
  assert.deepEqual(thaChalomPickRange("2026-11-26"), { min: "2026-11-26", max: "2027-01-25" });
  assert.equal(thaChalomPickedDay("2026-11-27", "2026-11-26", holidays), "2026-11-27");
  assert.equal(thaChalomPickedDay("2026-11-26", "2026-11-26", holidays), "2026-11-26");
  assert.equal(thaChalomPickedDay("2026-11-25", "2026-11-26", holidays), null);
  assert.equal(thaChalomPickedDay("2026-11-28", "2026-11-26", holidays), null);
  assert.equal(thaChalomPickedDay("2026-12-07", "2026-11-26", holidays), null);
  assert.equal(thaChalomPickedDay("2027-01-26", "2026-11-26", holidays), null);
  assert.equal(thaChalomPickedDay("2026-13-01", "2026-11-26", holidays), null);
  assert.equal(thaChalomPickedDay(["2026-11-27"], "2026-11-26", holidays), null);
  assert.equal(thaChalomPickedDay(undefined, "2026-11-26", holidays), null);
});
