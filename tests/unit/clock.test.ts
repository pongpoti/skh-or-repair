import "./_setup";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { bangkokParts, now, today } from "@/lib/clock";
import { setTestEnv } from "./_setup";

afterEach(() => {
  delete process.env.APP_FAKE_NOW;
  delete process.env.APP_FAKE_NOW_FILE;
  setTestEnv();
});

/** True when `date` is the real time (within a few seconds). */
const isReal = (date: Date) => Math.abs(date.getTime() - Date.now()) < 5_000;

describe("the app's clock", () => {
  test("is the real time unless a test sets one", () => {
    assert.ok(isReal(now()));
  });

  test("APP_FAKE_NOW sets the time, given as an ISO time with its offset", () => {
    process.env.APP_FAKE_NOW = "2026-11-16T15:30:00+07:00";
    assert.equal(now().toISOString(), "2026-11-16T08:30:00.000Z");
    assert.equal(today(), "2026-11-16");
    process.env.APP_FAKE_NOW = "2026-11-16T17:30:00Z";
    assert.equal(today(), "2026-11-17", "already the 17th in Bangkok");
  });

  test("a time without an offset, or no time at all, is ignored", (t) => {
    const warn = t.mock.method(console, "warn", () => {});
    for (const bad of ["2026-11-16T15:30:00", "2026-11-16", "yesterday", "2026-13-45T99:00:00Z"]) {
      process.env.APP_FAKE_NOW = bad;
      assert.ok(isReal(now()), bad);
    }
    assert.ok(warn.mock.calls.length <= 1, "warned once at most");
    for (const call of warn.mock.calls) assert.doesNotMatch(String(call.arguments[0]), /2026/, "the value is not logged");
  });

  test("APP_FAKE_NOW_FILE is read again on every call, so a running server's clock can move", () => {
    const dir = mkdtempSync(join(tmpdir(), "orskh-clock-"));
    try {
      const file = join(dir, "now");
      process.env.APP_FAKE_NOW_FILE = file;
      process.env.APP_FAKE_NOW = "2026-11-14T10:00:00+07:00";
      assert.equal(now().toISOString(), "2026-11-14T03:00:00.000Z", "no file yet: APP_FAKE_NOW");
      writeFileSync(file, "2026-11-16T15:59:59+07:00\n");
      assert.equal(now().toISOString(), "2026-11-16T08:59:59.000Z");
      writeFileSync(file, "2026-11-16T16:00:00+07:00");
      assert.equal(now().toISOString(), "2026-11-16T09:00:00.000Z");
      delete process.env.APP_FAKE_NOW;
      writeFileSync(file, "");
      assert.ok(isReal(now()), "an empty file: the real time");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("is never faked on Vercel", () => {
    process.env.APP_FAKE_NOW = "2026-11-16T15:30:00+07:00";
    process.env.VERCEL = "1";
    assert.ok(isReal(now()));
  });

  test("tells the Bangkok date and the minutes since Bangkok midnight", () => {
    assert.deepEqual(bangkokParts(new Date("2026-11-16T08:59:59Z")), { date: "2026-11-16", minutes: 15 * 60 + 59 });
    assert.deepEqual(bangkokParts(new Date("2026-11-16T09:00:00Z")), { date: "2026-11-16", minutes: 16 * 60 });
    assert.deepEqual(bangkokParts(new Date("2026-11-16T16:59:59Z")), { date: "2026-11-16", minutes: 23 * 60 + 59 });
    assert.deepEqual(bangkokParts(new Date("2026-11-16T17:00:00Z")), { date: "2026-11-17", minutes: 0 });
    assert.deepEqual(bangkokParts(new Date("2026-12-31T17:00:00Z")), { date: "2027-01-01", minutes: 0 });
  });
});
