import assert from "node:assert/strict";
import { test } from "node:test";
import { checkHn, MAX_HN, normalizeHn } from "./hn.ts";

test("an HN is matched in one form: NFKC, no spaces or dashes, upper case, no leading zeros", () => {
  assert.equal(normalizeHn("0012345"), "12345");
  assert.equal(normalizeHn(" 12-345 "), "12345");
  assert.equal(normalizeHn("12 34\t5"), "12345");
  assert.equal(normalizeHn("ab-001"), "AB001", "leading zeros only");
  assert.equal(normalizeHn("１２３４５"), "12345", "full-width digits");
  assert.equal(normalizeHn("๐๑๒๓๔๕"), "12345", "Thai digits");
  assert.equal(normalizeHn(12345), "12345", "a number cell");
  assert.equal(normalizeHn("0000"), "0", "all zeros keeps one");
  assert.equal(normalizeHn("0"), "0");
  assert.equal(normalizeHn(0), "0");
  assert.equal(normalizeHn(""), "");
  assert.equal(normalizeHn(" - "), "");
  assert.equal(normalizeHn(null), "");
  assert.equal(normalizeHn(undefined), "");
  // anything else is kept, so two different numbers never become one
  assert.equal(normalizeHn("12/345"), "12/345");
  assert.notEqual(normalizeHn("12/345"), normalizeHn("12345"));
});

test("a booking's HN is required: up to 15 letters, digits and dashes", () => {
  assert.equal(MAX_HN, 15);
  assert.deepEqual(checkHn(" 0012-345 "), { ok: true, hn: "12345" });
  assert.deepEqual(checkHn("x9"), { ok: true, hn: "X9" });
  assert.deepEqual(checkHn("1".repeat(15)), { ok: true, hn: "1".repeat(15) });
  assert.deepEqual(checkHn("๑๒๓"), { ok: true, hn: "123" });
  for (const raw of [undefined, null, "", "  ", 123, "---", "-"]) {
    assert.deepEqual(checkHn(raw), { ok: false, error: "ใส่ HN ของผู้ป่วย" }, JSON.stringify(raw));
  }
  for (const raw of ["1".repeat(16), "12 345", "12/345", "HN.1", "ก12"]) {
    const checked = checkHn(raw);
    assert.ok(!checked.ok, raw);
    assert.equal(checked.error, "HN ใช้ได้เฉพาะตัวเลข ตัวอักษรอังกฤษ และ - ไม่เกิน 15 ตัว");
  }
});
