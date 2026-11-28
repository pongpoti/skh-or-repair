import assert from "node:assert/strict";
import { test } from "node:test";
import { badgeText, boardNotices, bubblePlace, everyNotice } from "./board-notices.ts";
import { TUTORIAL_NOTICE } from "./tutorial.ts";

test("no notice when the board's day has its HOSxP table: the strip stays empty", () => {
  assert.deepEqual(boardNotices({ missingUpload: null }), []);
});

test("the one notice (Pong, 16 Nov 2026): no HOSxP table yet, with the database-off icon", () => {
  const notices = boardNotices({ missingUpload: "2026-11-16" });
  assert.equal(notices.length, 1);
  const [noUpload] = notices;
  assert.equal(noUpload.id, "no-upload");
  assert.equal(noUpload.icon, "no-table");
  assert.equal(noUpload.text, "ยังไม่มีตาราง HOSxP ของ 16 พ.ย. 2569");
  assert.equal(noUpload.short, "ยังไม่มี HOSxP");
  assert.equal(noUpload.tone, "alert");
  assert.equal(noUpload.testId, "no-upload-alert");
  assert.ok(noUpload.detail.includes("15:00–16:00"), "the bubble says when MX uploads");
});

test("the preview's every notice is the two badges: no holiday, load failure or mismatch badges", () => {
  const ids = everyNotice("2026-11-16").map((notice) => notice.id);
  assert.deepEqual(ids, ["no-upload", "no-room"]);
});

// Pong, 27 Nov 2026: "Leave off board and display on noti bar for both places".
test("the no-room notice: the HOSxP cases no room takes that day, per department, with a closed door", () => {
  assert.deepEqual(boardNotices({ missingUpload: null, offBoard: [] }), [], "none to count, no notice");
  const notices = boardNotices({
    missingUpload: null,
    offBoard: [
      { dept: "VASCULAR", count: 2 },
      { dept: null, count: 1 },
    ],
  });
  assert.equal(notices.length, 1);
  const [noRoom] = notices;
  assert.deepEqual(
    [noRoom.id, noRoom.tone, noRoom.icon, noRoom.testId, noRoom.text, noRoom.short],
    ["no-room", "alert", "no-room", "no-room-alert", "3 เคสไม่มีห้องผ่าตัด", "ไม่มีห้อง 3 เคส"],
  );
  assert.equal(noRoom.detail, "ไม่ได้ลงกระดาน เพราะสาขาไม่มีห้องในวันนั้น: ศัลยกรรมหลอดเลือด 2 เคส · ไม่ทราบสาขา 1 เคส");
  // Counts and departments only: no patient, no surgeon.
  assert.doesNotMatch(JSON.stringify(noRoom), /HN|\d{6,}/);
});

test("a badge says the whole message alone and its short form with others (the tutorial's)", () => {
  const [notice] = boardNotices({ missingUpload: "2026-11-16" });
  assert.equal(badgeText(notice, 1), "ยังไม่มีตาราง HOSxP ของ 16 พ.ย. 2569");
  assert.equal(badgeText(notice, 2), "ยังไม่มี HOSxP");
  assert.ok(TUTORIAL_NOTICE.short.length < TUTORIAL_NOTICE.text.length);
});

test("the bubble: centred on its badge, kept inside the strip, its tail on the badge", () => {
  // a badge in the middle of a wide strip: centred on it
  assert.deepEqual(bubblePlace({ width: 1000 }, { left: 400, width: 200 }), { left: 324, width: 352, tail: 176 });
  // a badge at the left edge of a phone: the bubble keeps its margin and the tail moves to the badge
  assert.deepEqual(bubblePlace({ width: 390 }, { left: 12, width: 140 }), { left: 12, width: 352, tail: 70 });
  // a badge at the right edge: the bubble stops at the right margin
  assert.deepEqual(bubblePlace({ width: 390 }, { left: 300, width: 80 }), { left: 26, width: 352, tail: 314 });
  // a narrow screen: as wide as fits
  assert.equal(bubblePlace({ width: 320 }, { left: 12, width: 100 }).width, 296);
  // the tail never sits in a rounded corner, even when the badge has scrolled past the edge
  assert.equal(bubblePlace({ width: 390 }, { left: -200, width: 100 }).tail, 24);
  assert.equal(bubblePlace({ width: 390 }, { left: 600, width: 100 }).tail, 352 - 24);
});
