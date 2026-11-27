import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLOSED_TEXT,
  openRooms,
  roomDayText,
  THA_CHALOM_ROOM_LIST,
  thaChalomAllocation,
  thaChalomBookingRoom,
  thaChalomDay,
  thaChalomPickedDay,
  thaChalomPickRange,
  thaChalomRoomName,
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
  assert.deepEqual(openRooms(wednesday).map((entry) => entry.room.id), ["or-1", "or-2", "or-4"]);
  assert.deepEqual(openRooms(thaChalomDay("2026-12-01")).map((entry) => entry.room.id), ["or-1", "or-2", "or-4", "scope"]);
  assert.deepEqual(openRooms(thaChalomDay("2026-12-04")).map((entry) => entry.room.id), ["or-2", "or-4"]);
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

test("a doctor books their department's room in the table that day, and no other room (Pong, 27 Nov 2026)", () => {
  // Monday 16 Nov 2026 to Friday 20 Nov; Thursday 19 Nov is the month's third, 26 Nov its fourth
  assert.equal(thaChalomBookingRoom("ORTHO", "2026-11-16"), "or-1");
  assert.equal(thaChalomBookingRoom("GENSX", "2026-11-16"), null, "general surgery has no room on a Monday");
  assert.equal(thaChalomBookingRoom("GENSX", "2026-11-17"), "or-1");
  assert.equal(thaChalomBookingRoom("PLASTIC", "2026-11-17"), "scope", "the Scope room is ศัลยกรรมตกแต่ง's on Tuesdays");
  assert.equal(thaChalomBookingRoom("EYE", "2026-11-18"), "or-4", "OR 4 on a Wednesday morning");
  assert.equal(thaChalomBookingRoom("ENT", "2026-11-18"), "or-4", "and afternoon");
  assert.equal(thaChalomBookingRoom("ORTHO", "2026-11-19"), "or-4", "OR 4 in a Thursday of week 3");
  assert.equal(thaChalomBookingRoom("PLASTIC", "2026-11-26"), "or-4", "and of week 4");
  assert.equal(thaChalomBookingRoom("EYE", "2026-11-19"), "scope");
  assert.equal(thaChalomBookingRoom("VASCULAR", "2026-11-20"), "or-2");
  assert.equal(thaChalomBookingRoom("GENSX", "2026-11-20"), null, "OR 1 is ว่าง on Fridays: no borrowing it");
  assert.equal(thaChalomBookingRoom("GENSX", "2026-11-21"), null, "a Saturday");
  assert.equal(thaChalomBookingRoom("MIXED", "2026-11-17"), null, "a department the table does not name");
  assert.equal(thaChalomBookingRoom(null, "2026-11-17"), null);
});

test("who holds a room, in รพ.สมุทรสาคร's shape, and the rooms' names", () => {
  const held = (roomId: string, date: string) => {
    const allocation = thaChalomAllocation(roomId, date);
    return allocation && [allocation.am?.code ?? null, allocation.pm?.code ?? null, allocation.split];
  };
  assert.deepEqual(held("or-4", "2026-11-18"), ["EYE", "ENT", true]);
  assert.deepEqual(held("or-1", "2026-11-16"), ["ORTHO", "ORTHO", false]);
  assert.equal(held("or-3", "2026-11-16"), null, "OR 3 under works");
  assert.equal(held("scope", "2026-11-16"), null, "ว่าง");
  assert.equal(held("or-1", "2026-11-21"), null, "a Saturday");
  assert.equal(thaChalomRoomName("or-4"), "OR 4");
  assert.equal(thaChalomRoomName("scope"), "ห้อง Scope");
});
