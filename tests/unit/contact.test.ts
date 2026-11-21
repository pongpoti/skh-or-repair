import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cleanPhoneInput, EMAIL_RULE, normalizeEmail, normalizePhone, PHONE_RULE, phoneProblem } from "@/lib/contact";
import { MSG } from "@/lib/http";
import { normalizePhone as serverNormalizePhone } from "@/lib/phone";

// The checks the forms run as people type (Pong, 21 Nov 2026: "Make text validation for both email and Thai phone
// number ... also apply this validation to phone number login"); the server uses the same functions.

describe("lib/contact.ts", () => {
  test("the server's number rules are these, and so is its message", () => {
    assert.equal(serverNormalizePhone, normalizePhone);
    assert.equal(MSG.invalidPhone, PHONE_RULE);
    assert.equal(PHONE_RULE, "ใส่เบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 06, 08 หรือ 09");
    assert.equal(EMAIL_RULE, "อีเมลไม่ถูกต้อง เช่น name@gmail.com");
  });

  test("a number typed so far: fine, empty, still being typed, or one that can never be a Thai mobile number", () => {
    for (const ok of ["0812345678", "081-234-5678", "06 1234 5678", "+66 81 234 5678", "66812345678", "+66 (0) 81 234 5678", "๐๙๑๒๓๔๕๖๗๘"]) {
      assert.equal(phoneProblem(ok), null, ok);
    }
    for (const empty of ["", " ", "--", "( )"]) assert.equal(phoneProblem(empty), "empty", JSON.stringify(empty));
    for (const partial of ["0", "08", "081-23", "081234567", "+", "+6", "+66", "+66 8", "+66 (0) 8", "66812", "6"]) {
      assert.equal(phoneProblem(partial), "partial", partial);
    }
    for (const invalid of ["02-123-4567", "07", "05", "00", "1", "8", "9", "08123456789", "+65 81", "+66 2", "abc", "0812a", "x".repeat(41)]) {
      assert.equal(phoneProblem(invalid), "invalid", invalid);
    }
  });

  test("a number field keeps only what numbers are typed with", () => {
    assert.equal(cleanPhoneInput("๐๘๑-abc 234"), "081- 234");
    assert.equal(cleanPhoneInput("+66 (0) 81 234 5678 and more"), "+66 (0) 81 234 5678 ");
  });

  test("an email address is trimmed and lower-cased, or refused when it cannot be one", () => {
    assert.equal(normalizeEmail("  Nat.W@Example.CO.TH "), "nat.w@example.co.th");
    assert.equal(normalizeEmail("o'brien+or@skh.go.th"), "o'brien+or@skh.go.th");
    for (const bad of [
      "",
      "nat",
      "nat@",
      "@example.com",
      "nat@example",
      "nat@example.c",
      "nat w@example.com",
      "nat@exa mple.com",
      "nat..w@example.com",
      ".nat@example.com",
      "nat.@example.com",
      "nat@-example.com",
      "nat@example-.com",
      "nat@example..com",
      "nat@@example.com",
      "ณัฐ@example.com",
      "nat@ตัวอย่าง.com",
      `${"a".repeat(65)}@example.com`,
      `a@${"b".repeat(250)}.com`,
      42,
      null,
    ]) {
      assert.equal(normalizeEmail(bad), null, String(bad));
    }
  });
});
