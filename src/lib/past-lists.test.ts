import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { pastLists, splitByDay } from "./past-lists.ts";
import { REPAIR_FROM_JAN } from "./repair-fixtures.ts";
import { processSheet } from "./upload-flow.ts";
import { readXlsx } from "./xlsx.ts";

// The made-up export (tests/fixtures, every name and HN invented): rows booked for Mon 2 to Sat 7 Nov 2026. Rows 1–17
// are Thu 5 Nov's, all keyed in before 16:00 on 4 Nov; the other days' rows are mostly keyed in on the day itself.
const book = readXlsx(readFileSync(new URL("../../tests/fixtures/sample-or-export.xlsx", import.meta.url)));
assert.ok(book.ok);
const HEADER = book.rows[0];
const PERIODS = REPAIR_FROM_JAN;

test("splitByDay: the past booked dates, each with its rows keyed in before 16:00 the day before", () => {
  const split = splitByDay(book, "2026-11-06");
  assert.ok(split.ok);
  assert.deepEqual(
    split.days.map((day) => [day.date, day.fileRows, day.sheet.rows.length - 1]),
    [
      ["2026-11-02", 2, 0],
      ["2026-11-03", 3, 1],
      ["2026-11-04", 3, 1],
      ["2026-11-05", 17, 17],
    ],
  );
  // Today (6 Nov) and later are not past: the board's own lists cover them.
  assert.deepEqual(split.skipped, { later: 3, noDate: 0 });
  for (const day of split.days) assert.equal(day.sheet.rows[0], HEADER, "each day's sheet starts with the file's header");
  // Thu 5 Nov's sheet is exactly MX's file for that day.
  assert.deepEqual(split.days[3].sheet.rows, book.rows.slice(0, 18));
});

test("splitByDay: a file that is not the HOSxP export is refused with the upload's message", () => {
  const split = splitByDay({ rows: [["ชื่อ", "อื่น ๆ"], ["ก", "ข"]], date1904: false }, "2026-11-06");
  assert.equal(split.ok, false);
  assert.ok(!split.ok && split.message.includes("HOSxP"));
});

test("pastLists: each past workday goes through MX's pipeline; weekends and holidays are left out", () => {
  const split = splitByDay(book, "2026-11-30");
  assert.ok(split.ok);
  const lists = pastLists(split, { holidays: [{ date: "2026-11-03", name: "วันหยุดทดสอบ" }], periods: PERIODS });
  assert.deepEqual(
    lists.days.map((day) => [day.date, day.cases.length]),
    [
      ["2026-11-02", 0],
      ["2026-11-04", 1],
      ["2026-11-05", 9],
      ["2026-11-06", 0],
    ],
  );
  // Tue 3 Nov (a holiday here) and Sat 7 Nov.
  assert.deepEqual(lists.offDays, { days: 2, rows: 5 });

  const thursday = processSheet({ rows: book.rows.slice(0, 18), date1904: book.date1904 }, "2026-11-05", PERIODS);
  assert.ok(thursday.ok);
  const listed = lists.days.find((day) => day.date === "2026-11-05");
  assert.deepEqual(listed?.cases, thursday.cases, "the same cases, rooms and order as MX's upload of that day");
  assert.deepEqual(listed?.summary, thursday.summary);
  assert.equal(listed?.summary.repairHalf, 1, "placed in the first half's rooms");
});
