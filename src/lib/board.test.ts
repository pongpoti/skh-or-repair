import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_REPAIR_PERIODS } from "./repair.ts";
import { getRoom, isClosedRoom, isOpenRoom, isSelectableRoom, OPEN_ROOM_IDS, openRooms, roomLabel, unusedRoomsText } from "./rooms.ts";

// The planned repair dates (the first half from 1 Jan 2026, the second to 17 Mar 2027); lib/repair.test.ts covers the
// rooms of each half.
const REPAIR = DEFAULT_REPAIR_PERIODS;

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

test("no day has the normal OR with all 13 rooms open: before the repair's planned start the first half's rooms, after its end the second's", () => {
  // Pong, 18 Nov 2026: "This OR repair repo, not orskh repo. So you need to forget normal day OR schedule". The list of
  // the normal OR's rooms stays (Pong, 5 Nov 2026: "all OR open according to the workday OR schedule"), unused.
  const all = Array.from({ length: 13 }, (_, i) => `or-${i + 1}`);
  assert.deepEqual([...OPEN_ROOM_IDS], all);
  const first = ["or-9", "or-10", "or-11", "or-12", "or-13"];
  const second = ["or-1", "or-2", "or-3", "or-4", "or-5"];
  for (const [date, rooms] of [[NOV, first], ["2026-11-05", first], ["2026-11-13", first], ["2027-03-18", second], ["2027-04-01", second]] as const) {
    assert.deepEqual(openRooms(date, REPAIR).map((room) => room.id), rooms, date);
    for (const id of all) {
      const room = getRoom(id)!;
      const open = (rooms as readonly string[]).includes(id);
      assert.equal(isSelectableRoom(room, date, REPAIR), open, `${id} ${date}`);
      assert.equal(isOpenRoom(room.id, date, REPAIR), open, `${id} ${date}`);
    }
    assert.notEqual(unusedRoomsText(date, REPAIR), "", date);
  }
  assert.equal(isClosedRoom(getRoom("or-2")!, NOV, REPAIR), true);
  assert.equal(isSelectableRoom(getRoom("r-1")!, NOV, REPAIR), false);
});
