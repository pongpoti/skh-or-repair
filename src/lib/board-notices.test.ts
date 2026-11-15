import assert from "node:assert/strict";
import { test } from "node:test";
import { badgeText, boardNotices, bubblePlace } from "./board-notices.ts";

const NONE = { closed: false, holiday: null, failed: false, missingUpload: null, mismatches: 0 };

test("no notices on an ordinary day: the strip stays empty", () => {
  assert.deepEqual(boardNotices(NONE), []);
});

test("each notice: its whole message, short form, tone and test id", () => {
  const [noUpload] = boardNotices({ ...NONE, missingUpload: "2026-11-16" });
  assert.equal(noUpload.id, "no-upload");
  assert.equal(noUpload.text, "ยังไม่มีตาราง HOSxP ของ 16 พ.ย. 2569");
  assert.equal(noUpload.short, "ยังไม่มี HOSxP");
  assert.equal(noUpload.tone, "warning");
  assert.equal(noUpload.testId, "no-upload-alert");

  const [mismatch] = boardNotices({ ...NONE, mismatches: 6 });
  assert.equal(mismatch.text, "ไม่ตรงกับการจอง 6 รายการ");
  assert.equal(mismatch.short, "ไม่ตรง 6");
  assert.equal(mismatch.testId, "mismatch-alert");

  const [failed] = boardNotices({ ...NONE, failed: true });
  assert.equal(failed.text, "โหลดเคสไม่สำเร็จ ลองรีเฟรช");
  assert.equal(failed.tone, "danger");

  assert.equal(boardNotices({ ...NONE, closed: true, holiday: "วันปิยมหาราช" })[0].text, "วันหยุด วันปิยมหาราช · ไม่มีตารางผ่าตัด");
  assert.equal(boardNotices({ ...NONE, closed: true })[0].text, "วันนี้เป็นวันหยุด ไม่มีตารางผ่าตัด");
  for (const notice of boardNotices({ closed: true, holiday: null, failed: true, missingUpload: "2026-11-16", mismatches: 1 })) {
    assert.ok(notice.detail.length > 0, `${notice.id} has a message for its bubble`);
    assert.ok(notice.short.length < notice.text.length, `${notice.id}: the short form is shorter`);
  }
});

test("the order: holiday, cases not loaded, no upload, mismatches", () => {
  const all = boardNotices({ closed: true, holiday: null, failed: true, missingUpload: "2026-11-16", mismatches: 2 });
  assert.deepEqual(
    all.map((notice) => notice.id),
    ["holiday", "failed", "no-upload", "mismatch"],
  );
});

test("a badge says the whole message alone and its short form with others", () => {
  const [notice] = boardNotices({ ...NONE, missingUpload: "2026-11-16" });
  assert.equal(badgeText(notice, 1), "ยังไม่มีตาราง HOSxP ของ 16 พ.ย. 2569");
  assert.equal(badgeText(notice, 2), "ยังไม่มี HOSxP");
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
