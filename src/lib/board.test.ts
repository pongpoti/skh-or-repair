import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_REPAIR_PERIODS } from "./repair.ts";
import { getRoom, isClosedRoom, isOpenRoom, isSelectableRoom, OPEN_ROOM_IDS, openRooms, roomLabel, unusedRoomsText } from "./rooms.ts";

// The planned repair dates (14 Nov 2026 to 17 Mar 2027); lib/repair.test.ts covers the rooms during the repair.
const REPAIR = DEFAULT_REPAIR_PERIODS;

test("rooms have kinds and zones", () => {
  assert.equal(getRoom("or-7")?.zone, 2);
  assert.equal(getRoom("r-2")?.kind, "recovery");
  assert.equal(getRoom("lift"), null);
});

// Tuesday 3 November 2026.
const NOV = "2026-11-03";

test("open OR rooms are selectable and labeled OR N", () => {
  const or5 = getRoom("or-5");
  const rr1 = getRoom("r-1");
  assert.equal(roomLabel(or5!), "OR 5");
  assert.equal(roomLabel(rr1!), "RR 1");
  assert.equal(isSelectableRoom(or5!, NOV, REPAIR), true);
  assert.equal(isSelectableRoom(rr1!, NOV, REPAIR), false);
});

test("the normal OR outside the repair: all of OR 1 to 13 are open", () => {
  const all = Array.from({ length: 13 }, (_, i) => `or-${i + 1}`);
  assert.deepEqual([...OPEN_ROOM_IDS], all, "Pong, 5 Nov 2026: all OR open according to the workday OR schedule");
  for (const date of [NOV, "2026-11-05", "2026-11-13", "2027-03-18", "2027-04-01"]) {
    assert.deepEqual(openRooms(date, REPAIR).map((room) => room.id), all, date);
    for (const id of all) {
      const room = getRoom(id)!;
      assert.equal(isClosedRoom(room, date, REPAIR), false, `${id} ${date}`);
      assert.equal(isSelectableRoom(room, date, REPAIR), true, `${id} ${date}`);
      assert.equal(isOpenRoom(room.id, date, REPAIR), true, `${id} ${date}`);
    }
    assert.equal(unusedRoomsText(date, REPAIR), "", date);
  }
  assert.equal(isClosedRoom(getRoom("r-1")!, NOV, REPAIR), false);
  assert.equal(isSelectableRoom(getRoom("r-1")!, NOV, REPAIR), false);
});
