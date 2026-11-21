import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_REPAIR_PERIODS } from "./repair.ts";
import { REPAIR_FROM_JAN } from "./repair-fixtures.ts";
import { getRoom, isClosedRoom, isOpenRoom, isSelectableRoom, OPEN_ROOM_IDS, openRooms, roomLabel, unusedRoomsText } from "./rooms.ts";

// The planned repair dates (the first half from 1 Jan 2026, the second to 17 Mar 2027); lib/repair.test.ts covers the
// rooms of each half.
const REPAIR = REPAIR_FROM_JAN;

test("rooms have kinds and zones", () => {
  assert.equal(getRoom("or-7")?.zone, 2);
  assert.equal(getRoom("r-2")?.kind, "recovery");
  assert.equal(getRoom("lift"), null);
});

// Tuesday 3 November 2026.
const NOV = "2026-11-03";

test("open OR rooms are selectable and labeled OR N", () => {
  const or12 = getRoom("or-12");
  const rr1 = getRoom("r-1");
  assert.equal(roomLabel(or12!), "OR 12");
  assert.equal(roomLabel(rr1!), "RR 1");
  assert.equal(isSelectableRoom(or12!, NOV, REPAIR), true);
  assert.equal(isSelectableRoom(rr1!, NOV, REPAIR), false);
});

test("the normal OR with all 13 rooms open until 7 Dec 2026, the repair's rooms from 8 Dec, the normal OR after 17 Mar 2027", () => {
  // Pong, 21 Nov 2026: "reschedule OR layout plan to follows ช่วงเปิดใช้งานจริง" and "the schedule will automatically
  // reschedule to repair phase on Dec 8 plus 100 days".
  const all = Array.from({ length: 13 }, (_, i) => `or-${i + 1}`);
  assert.deepEqual([...OPEN_ROOM_IDS], all);
  const first = ["or-9", "or-10", "or-11", "or-12", "or-13"];
  const second = ["or-1", "or-2", "or-3", "or-4", "or-5"];
  const days = [
    [NOV, all],
    ["2026-01-05", all],
    ["2026-12-07", all],
    ["2026-12-08", first],
    ["2027-01-26", first],
    ["2027-01-27", second],
    ["2027-03-17", second],
    ["2027-03-18", all],
    ["2027-04-01", all],
  ] as const;
  for (const [date, rooms] of days) {
    assert.deepEqual(openRooms(date, DEFAULT_REPAIR_PERIODS).map((room) => room.id), rooms, date);
    for (const id of all) {
      const room = getRoom(id)!;
      const open = (rooms as readonly string[]).includes(id);
      assert.equal(isSelectableRoom(room, date, DEFAULT_REPAIR_PERIODS), open, `${id} ${date}`);
      assert.equal(isOpenRoom(room.id, date, DEFAULT_REPAIR_PERIODS), open, `${id} ${date}`);
    }
    assert.equal(unusedRoomsText(date, DEFAULT_REPAIR_PERIODS) === "", rooms.length === 13, date);
  }
  assert.equal(isClosedRoom(getRoom("or-2")!, NOV, REPAIR), true, "with the first half from 1 Jan 2026");
  assert.equal(isClosedRoom(getRoom("or-2")!, NOV, DEFAULT_REPAIR_PERIODS), false);
  assert.equal(isSelectableRoom(getRoom("r-1")!, NOV, REPAIR), false);
});
