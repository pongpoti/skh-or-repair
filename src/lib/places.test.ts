import assert from "node:assert/strict";
import { test } from "node:test";
import { BOARD_PATH, movedBoardHref, placeHref, PLACES, PLACES_PATH, THA_CHALOM_PATH } from "./places.ts";

test("the two hospitals, รพ.สมุทรสาคร's board first (Pong, 26 Nov 2026)", () => {
  assert.deepEqual(
    PLACES.map((place) => [place.id, place.name, place.href]),
    [
      ["skh", "รพ.สมุทรสาคร", BOARD_PATH],
      ["tha-chalom", "รพ.ท่าฉลอม", THA_CHALOM_PATH],
    ],
  );
  assert.equal(PLACES[0].detail, "ห้องผ่าตัด 13 ห้อง");
  assert.equal(PLACES[1].detail, "ห้องผ่าตัด 4 ห้อง");
  assert.equal(PLACES_PATH, "/");
  assert.equal(BOARD_PATH, "/skh");
});

test("an address of the board from before goes on to /skh with its query; the plain / asks for the hospital", () => {
  assert.equal(movedBoardHref({}), null);
  assert.equal(movedBoardHref({ utm: "x" }), null, "only the board's own keys");
  assert.equal(movedBoardHref({ date: "2026-12-03" }), "/skh?date=2026-12-03");
  assert.equal(movedBoardHref({ date: "2026-12-03", room: "or-12" }), "/skh?date=2026-12-03&room=or-12");
  assert.equal(movedBoardHref({ demo: "1", half: "2" }), "/skh?demo=1&half=2");
  assert.equal(movedBoardHref({ sim: "1", date: "2026-10-01" }), "/skh?sim=1&date=2026-10-01");
  assert.equal(movedBoardHref({ notices: "all" }), "/skh?notices=all");
  assert.equal(movedBoardHref({ room: ["or-1", "or-2"] }), "/skh?room=or-1&room=or-2", "a repeated key stays repeated");
  assert.equal(movedBoardHref({ room: "a&b=c" }), "/skh?room=a%26b%3Dc", "values are encoded");
  assert.equal(movedBoardHref({ room: "" }), "/skh?room=", "an empty room is still the board's");
});

test("switching hospital keeps a picked day, and otherwise opens the other board's own day", () => {
  assert.equal(placeHref(THA_CHALOM_PATH, "2026-12-03"), "/tha-chalom?date=2026-12-03");
  assert.equal(placeHref(BOARD_PATH, "2026-12-03"), "/skh?date=2026-12-03");
  assert.equal(placeHref(BOARD_PATH, null), "/skh");
  assert.equal(placeHref(THA_CHALOM_PATH, null), "/tha-chalom");
});
