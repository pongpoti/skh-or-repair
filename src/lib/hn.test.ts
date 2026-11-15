import assert from "node:assert/strict";
import { test } from "node:test";
import { checkHn, displayHn, HN_LENGTH, normalizeHn } from "./hn.ts";

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

test("a booking's HN is required: exactly 7 digits (Pong, 15 Nov 2026), stored without its leading zeros", () => {
  assert.equal(HN_LENGTH, 7);
  assert.deepEqual(checkHn("1234567"), { ok: true, hn: "1234567" });
  assert.deepEqual(checkHn("0012345"), { ok: true, hn: "12345" });
  assert.deepEqual(checkHn(" 123-4567 "), { ok: true, hn: "1234567" }, "spaces and dashes are taken out");
  assert.deepEqual(checkHn("๑๒๓๔๕๖๗"), { ok: true, hn: "1234567" }, "Thai digits");
  assert.deepEqual(checkHn("１２３４５６７"), { ok: true, hn: "1234567" }, "full-width digits");
  assert.deepEqual(checkHn("0000000"), { ok: true, hn: "0" });
  for (const raw of [undefined, null, "", "  ", 1234567, "---", "-"]) {
    assert.deepEqual(checkHn(raw), { ok: false, error: "ใส่ HN ของผู้ป่วย" }, JSON.stringify(raw));
  }
  for (const raw of ["123456", "12345678", "12/34567", "HN12345", "A123456", "ก123456", "1234567x"]) {
    assert.deepEqual(checkHn(raw), { ok: false, error: "HN ต้องเป็นตัวเลข 7 หลัก" }, raw);
  }
});

test("an HN is shown as people read it: digits with their leading zeros back, as 7", () => {
  assert.equal(displayHn("12345"), "0012345");
  assert.equal(displayHn("1234567"), "1234567");
  assert.equal(displayHn("0"), "0000000");
  // anything else as it is: HOSxP's own numbers, or a booking from before HNs had 7 digits
  assert.equal(displayHn("12345678"), "12345678");
  assert.equal(displayHn("AB12"), "AB12");
});
