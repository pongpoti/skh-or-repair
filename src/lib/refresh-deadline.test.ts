import assert from "node:assert/strict";
import { test } from "node:test";
import { refreshDeadline } from "./refresh-deadline.ts";

test("the wait counts from when a render was first seen, so a page brought back by Back does not start again", () => {
  // The board is rendered at 15:05 with 55 minutes to 16:00 and first seen at t = 1,000.
  assert.equal(refreshDeadline("render-a", 55 * 60_000, 1_000), 1_000 + 55 * 60_000);
  // An hour later Back brings the same render back from the router's cache and the component mounts again: the
  // deadline is the one it had, already past, so the board refreshes at once.
  assert.equal(refreshDeadline("render-a", 55 * 60_000, 1_000 + 60 * 60_000), 1_000 + 55 * 60_000);
  // A new render (a refresh, a new visit) counts from its own first sight.
  assert.equal(refreshDeadline("render-b", 5_000, 90_000), 95_000);
});

test("only the latest renders are remembered", () => {
  refreshDeadline("first", 1_000, 0);
  for (let i = 0; i < 60; i += 1) refreshDeadline(`later-${i}`, 1_000, 10);
  // Forgotten, so seen afresh: counted from now.
  assert.equal(refreshDeadline("first", 1_000, 500), 1_500);
  assert.equal(refreshDeadline("later-59", 1_000, 500), 1_010);
});
