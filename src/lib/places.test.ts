import assert from "node:assert/strict";
import { test } from "node:test";
import { BOARD_PATH, homeHref, placeHref, PLACES, THA_CHALOM_PATH } from "./places.ts";

test("the two hospitals, รพ.สมุทรสาคร's board first (Pong, 26 Nov 2026)", () => {
  assert.deepEqual(
    PLACES.map((place) => [place.id, place.name, place.href]),
    [
      ["skh", "รพ.สมุทรสาคร", BOARD_PATH],
      ["tha-chalom", "รพ.ท่าฉลอม", THA_CHALOM_PATH],
    ],
  );
  assert.equal(BOARD_PATH, "/skh");
});

test("/ opens รพ.สมุทรสาคร's board (Pong, 27 Nov 2026), and an address of the board from before keeps its query", () => {
  assert.equal(homeHref({}), "/skh");
  assert.equal(homeHref({ utm_source: "line" }), "/skh", "only the board's own keys go along");
  assert.equal(homeHref({ date: "2026-12-03" }), "/skh?date=2026-12-03");
  assert.equal(homeHref({ date: "2026-12-03", room: "or-12" }), "/skh?date=2026-12-03&room=or-12");
  assert.equal(homeHref({ demo: "1", half: "2" }), "/skh", "the admins' old test modes (gone 28 Nov 2026) are no board key");
  assert.equal(homeHref({ room: "or-12", demo: "1" }), "/skh?room=or-12&demo=1", "an address with a board key keeps its whole query");
  assert.equal(homeHref({ room: ["or-1", "or-2"] }), "/skh?room=or-1&room=or-2", "a repeated key stays repeated");
  assert.equal(homeHref({ room: "a&b=c" }), "/skh?room=a%26b%3Dc", "values are encoded");
  assert.equal(homeHref({ room: "" }), "/skh?room=", "an empty room is still the board's");
});

test("switching hospital keeps a picked day, and otherwise opens the other board's own day", () => {
  assert.equal(placeHref(THA_CHALOM_PATH, "2026-12-03"), "/tha-chalom?date=2026-12-03");
  assert.equal(placeHref(BOARD_PATH, "2026-12-03"), "/skh?date=2026-12-03");
  assert.equal(placeHref(BOARD_PATH, null), "/skh");
  assert.equal(placeHref(THA_CHALOM_PATH, null), "/tha-chalom");
});
