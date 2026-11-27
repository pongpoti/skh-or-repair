import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boardDateOf,
  boardDayAt,
  boardEyebrow,
  cycleDayOf,
  inUploadWindow,
  loadBoardDay,
  loadUploadSlot,
  nextBoardRefresh,
  PICK_AHEAD_DAYS,
  pickedDay,
  pickRange,
  relationTo,
  stepDay,
} from "./board-day.ts";
import { BOOK_AHEAD_DAYS } from "./added-cases.ts";
import { REPAIR_FROM_JAN as REPAIR } from "./repair-fixtures.ts";
import { DEFAULT_REPAIR_PERIODS } from "./repair.ts";
import { forgetHolidayFeeds, type Holiday } from "./holidays.ts";

/** A moment given as Bangkok wall time. */
const at = (local: string) => new Date(`${local}+07:00`);

// Friday 4 Dec 2026, then Saturday 5 Dec (Father's Day) with Monday 7 Dec as its substitution day, and Thursday
// 10 Dec (Constitution Day). The New Year: 31 Dec 2026 (special) and 1 Jan 2027.
const HOLIDAYS: Holiday[] = [
  { date: "2026-12-05", name: "วันพ่อแห่งชาติ" },
  { date: "2026-12-07", name: "ชดเชยวันพ่อแห่งชาติ" },
  { date: "2026-12-10", name: "วันรัฐธรรมนูญ" },
  { date: "2026-12-31", name: "วันสิ้นปี" },
  { date: "2027-01-01", name: "วันขึ้นปีใหม่" },
];

test("the cycle turns over at 16:00 Bangkok time, not at midnight", () => {
  assert.equal(cycleDayOf(at("2026-11-16T15:59:59")), "2026-11-15");
  assert.equal(cycleDayOf(at("2026-11-16T16:00:00")), "2026-11-16");
  assert.equal(cycleDayOf(at("2026-11-16T23:59:59")), "2026-11-16");
  assert.equal(cycleDayOf(at("2026-11-17T00:00:00")), "2026-11-16");
  // 09:00 UTC is 16:00 in Bangkok, whatever the server's own time zone
  assert.equal(cycleDayOf(new Date("2026-11-16T09:00:00Z")), "2026-11-16");
  assert.equal(cycleDayOf(new Date("2026-11-16T08:59:59Z")), "2026-11-15");
});

test("on a workday the board shows today before 16:00 and the next workday from 16:00", () => {
  const before = boardDayAt(at("2026-11-17T15:59:00"), []);
  assert.deepEqual(before, { today: "2026-11-17", minutes: 959, cycleDay: "2026-11-16", boardDate: "2026-11-17", relation: "today" });
  const after = boardDayAt(at("2026-11-17T16:00:00"), []);
  assert.deepEqual(after, { today: "2026-11-17", minutes: 960, cycleDay: "2026-11-17", boardDate: "2026-11-18", relation: "tomorrow" });
  assert.equal(boardDayAt(at("2026-11-18T08:00:00"), []).boardDate, "2026-11-18", "the next morning");
});

test("Friday from 16:00 and the weekend show Monday", () => {
  assert.equal(boardDayAt(at("2026-11-20T15:00:00"), []).boardDate, "2026-11-20");
  const friday = boardDayAt(at("2026-11-20T16:30:00"), []);
  assert.deepEqual([friday.cycleDay, friday.boardDate, friday.relation], ["2026-11-20", "2026-11-23", "later"]);
  assert.equal(boardDayAt(at("2026-11-21T10:00:00"), []).boardDate, "2026-11-23", "Saturday morning");
  const sunday = boardDayAt(at("2026-11-22T17:00:00"), []);
  assert.deepEqual([sunday.cycleDay, sunday.boardDate, sunday.relation], ["2026-11-22", "2026-11-23", "tomorrow"]);
  assert.equal(boardDayAt(at("2026-11-23T07:00:00"), []).boardDate, "2026-11-23", "Monday morning");
});

test("holidays are skipped, chains of them too", () => {
  // Friday 4 Dec from 16:00: Sat 5 and Sun 6, then Monday 7 (substitution day): the board shows Tuesday 8.
  assert.equal(boardDayAt(at("2026-12-04T16:00:00"), HOLIDAYS).boardDate, "2026-12-08");
  assert.equal(boardDayAt(at("2026-12-07T12:00:00"), HOLIDAYS).boardDate, "2026-12-08", "on the holiday itself");
  // The eve of a holiday: Wednesday 9 Dec from 16:00 skips Thursday 10 to Friday 11.
  assert.equal(boardDayAt(at("2026-12-09T15:30:00"), HOLIDAYS).boardDate, "2026-12-09");
  assert.equal(boardDayAt(at("2026-12-09T16:00:00"), HOLIDAYS).boardDate, "2026-12-11");
  // Without the holiday list (the weekday fallback) Monday 7 would be shown.
  assert.equal(boardDayAt(at("2026-12-04T16:00:00"), []).boardDate, "2026-12-07");
});

test("across the year end", () => {
  // Wednesday 30 Dec from 16:00: Thu 31 and Fri 1 are holidays, then the weekend: Monday 4 Jan 2027.
  const day = boardDayAt(at("2026-12-30T16:00:00"), HOLIDAYS);
  assert.deepEqual([day.cycleDay, day.boardDate, day.relation], ["2026-12-30", "2027-01-04", "later"]);
  assert.equal(boardDayAt(at("2027-01-01T09:00:00"), HOLIDAYS).cycleDay, "2026-12-31");
  assert.equal(boardDayAt(at("2027-01-01T09:00:00"), HOLIDAYS).boardDate, "2027-01-04");
  assert.equal(boardDateOf("2026-12-31", []), "2027-01-01");
});

test("a holiday list with no workday in two weeks still gives the next weekday", () => {
  const closed = Array.from({ length: 20 }, (_, i) => ({ date: `2026-12-${String(i + 1).padStart(2, "0")}`, name: "x" }));
  assert.equal(boardDateOf("2026-11-30", closed), "2026-12-01");
});

test("the top bar says today, tomorrow or neither", () => {
  assert.equal(boardEyebrow("today"), "ตารางผ่าตัดวันนี้");
  assert.equal(boardEyebrow("tomorrow"), "ตารางผ่าตัดถัดไป");
  assert.equal(boardEyebrow("later"), "ตารางผ่าตัดถัดไป");
});

test("MX uploads from 15:00:00 up to 16:00, every day", () => {
  assert.equal(inUploadWindow(at("2026-11-16T14:59:59")), false);
  assert.equal(inUploadWindow(at("2026-11-16T15:00:00")), true);
  assert.equal(inUploadWindow(at("2026-11-16T15:59:59")), true);
  assert.equal(inUploadWindow(at("2026-11-16T16:00:00")), false);
  assert.equal(inUploadWindow(at("2026-11-21T15:30:00")), true, "Saturday too");
  assert.equal(inUploadWindow(at("2026-12-05T15:30:00")), true, "a holiday too");
});

test("the board refreshes itself at 15:00, at 16:00 and at midnight", () => {
  // 15:00 too: bookings for the next workday close then, and the booking form's earliest day moves on.
  assert.equal(nextBoardRefresh(at("2026-11-16T09:00:00")).toISOString(), at("2026-11-16T15:00:00").toISOString());
  assert.equal(nextBoardRefresh(at("2026-11-16T14:59:59")).toISOString(), at("2026-11-16T15:00:00").toISOString());
  assert.equal(nextBoardRefresh(at("2026-11-16T15:00:00")).toISOString(), at("2026-11-16T16:00:00").toISOString());
  assert.equal(nextBoardRefresh(at("2026-11-16T15:59:59")).toISOString(), at("2026-11-16T16:00:00").toISOString());
  assert.equal(nextBoardRefresh(at("2026-11-16T16:00:00")).toISOString(), at("2026-11-17T00:00:00").toISOString());
  assert.equal(nextBoardRefresh(at("2026-12-31T20:00:00")).toISOString(), at("2027-01-01T00:00:00").toISOString());
  assert.equal(nextBoardRefresh(at("2026-11-17T00:00:00")).toISOString(), at("2026-11-17T15:00:00").toISOString());
});

test("loading the board's day: BOT holidays when they come, weekdays and EXTRA_HOLIDAYS when they do not", async (t) => {
  const saved = { token: process.env.BOT_API_TOKEN, extra: process.env.EXTRA_HOLIDAYS, url: process.env.BOT_HOLIDAYS_URL };
  t.after(() => {
    for (const [name, value] of [["BOT_API_TOKEN", saved.token], ["EXTRA_HOLIDAYS", saved.extra], ["BOT_HOLIDAYS_URL", saved.url]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  t.mock.method(console, "warn", () => {});
  const years: string[] = [];
  let up = true;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    years.push(new URL(url).searchParams.get("year") ?? "");
    if (!up) return new Response("down", { status: 503 });
    const year = new URL(url).searchParams.get("year");
    const data = HOLIDAYS.filter((item) => item.date.startsWith(`${year}-`)).map((item) => ({ Date: item.date, HolidayDescriptionThai: item.name }));
    return new Response(JSON.stringify({ result: { data } }));
  });
  process.env.BOT_API_TOKEN = "token";
  delete process.env.BOT_HOLIDAYS_URL;
  process.env.EXTRA_HOLIDAYS = "2026-12-08=ปิดปรับปรุง";
  forgetHolidayFeeds();

  const day = await loadBoardDay(at("2026-12-04T16:00:00"));
  assert.equal(day.holidaysOk, true);
  assert.equal(day.boardDate, "2026-12-09", "the BOT's holidays and then EXTRA_HOLIDAYS' Tuesday");
  const yearEnd = await loadBoardDay(at("2026-12-30T16:00:00"));
  assert.equal(yearEnd.boardDate, "2027-01-04");
  assert.ok(years.includes("2027"), "the next year's list is fetched too");

  // A kept list stands for six hours (lib/holidays.ts keptHolidayFeed): forget it to see the BOT go down.
  const asked = years.length;
  await loadBoardDay(at("2026-12-04T16:00:00"));
  assert.equal(years.length, asked, "a year's list is kept, not asked for again");
  up = false;
  forgetHolidayFeeds();
  const fallback = await loadBoardDay(at("2026-12-04T16:00:00"));
  assert.equal(fallback.holidaysOk, false);
  assert.equal(fallback.boardDate, "2026-12-07", "weekdays only, plus EXTRA_HOLIDAYS");

  const slot = await loadUploadSlot(at("2026-12-04T15:30:00"));
  assert.deepEqual(slot, { cycleDay: "2026-12-04", target: { ok: false, reason: "failed" }, windowOpen: true });
  up = true;
  forgetHolidayFeeds();
  assert.deepEqual(await loadUploadSlot(at("2026-12-04T17:00:00")), {
    cycleDay: "2026-12-04",
    target: { ok: true, date: "2026-12-09" },
    windowOpen: false,
  });
  delete process.env.BOT_API_TOKEN;
  assert.deepEqual((await loadUploadSlot(at("2026-12-04T15:30:00"))).target, { ok: false, reason: "no-token" });
});

test("a day picked on the board: from today to the repair's last day", () => {
  // Pong, 27 Nov 2026: "Disable past day view and clear pastday data for both places" (the calendar had gone back to
  // 1 Jan 2026 since 18 Nov)
  assert.deepEqual(pickRange("2026-11-17", REPAIR), { min: "2026-11-17", max: "2027-03-17" }, "the second half included");
  assert.deepEqual(pickRange("2027-03-17", REPAIR), { min: "2027-03-17", max: "2027-03-17" }, "the repair's last day");
  // once the repair is over, as far ahead as doctors book
  assert.equal(PICK_AHEAD_DAYS, BOOK_AHEAD_DAYS);
  assert.deepEqual(pickRange("2027-03-18", REPAIR), { min: "2027-03-18", max: "2027-05-17" });
  // the planned repair from 8 Dec 2026 (Pong, 21 Nov 2026)
  const later = { ...REPAIR, half1: { ...REPAIR.half1, from: "2026-12-08" } };
  assert.deepEqual(pickRange("2026-11-17", later), { min: "2026-11-17", max: "2027-03-17" });
  assert.deepEqual(pickRange("2026-12-20", later), { min: "2026-12-20", max: "2027-03-17" });
  assert.deepEqual(pickRange("2026-11-27", DEFAULT_REPAIR_PERIODS), { min: "2026-11-27", max: "2027-03-17" });
});

test("the address's picked day: a real workday in range, else none", () => {
  const holidays = [{ date: "2026-12-07", name: "ชดเชยวันพ่อแห่งชาติ" }];
  const today = "2026-11-17";
  assert.equal(pickedDay("2026-11-18", today, REPAIR, holidays), "2026-11-18");
  assert.equal(pickedDay("2026-11-17", today, REPAIR, holidays), "2026-11-17", "today");
  assert.equal(pickedDay("2026-11-16", today, REPAIR, holidays), null, "yesterday: no past day");
  assert.equal(pickedDay("2026-01-02", today, REPAIR, holidays), null, "January's lists are gone");
  assert.equal(pickedDay("2027-02-01", today, REPAIR, holidays), "2027-02-01", "a day in the second half");
  assert.equal(pickedDay("2027-03-17", today, REPAIR, holidays), "2027-03-17", "the repair's last day");
  assert.equal(pickedDay("2027-03-18", today, REPAIR, holidays), null, "after the repair");
  assert.equal(pickedDay("2026-11-22", today, REPAIR, holidays), null, "a Sunday");
  assert.equal(pickedDay("2026-12-07", today, REPAIR, holidays), null, "a holiday");
  assert.equal(pickedDay("2026-11-31", today, REPAIR, holidays), null, "no such day");
  assert.equal(pickedDay("2026-11-1", today, REPAIR, holidays), null, "not YYYY-MM-DD");
  assert.equal(pickedDay(undefined, today, REPAIR, holidays), null);
  assert.equal(pickedDay(["2026-11-18", "2026-11-19"], today, REPAIR, holidays), null, "given twice");
});

test("how a picked day stands to today, and its eyebrow", () => {
  assert.equal(relationTo("2026-11-16", "2026-11-17"), "past");
  assert.equal(boardEyebrow("past"), "ตารางผ่าตัดย้อนหลัง");
  assert.equal(relationTo("2026-11-17", "2026-11-17"), "today");
  assert.equal(relationTo("2026-11-18", "2026-11-17"), "tomorrow");
  assert.equal(relationTo("2026-11-20", "2026-11-17"), "later");
  assert.equal(boardEyebrow(relationTo("2026-11-20", "2026-11-17")), "ตารางผ่าตัดถัดไป");
});

test("a swipe moves the board to the workday before or after, within the picker's range", () => {
  // Pong, 19 Nov 2026: "allow swipe on layout to select date"
  const range = { min: "2026-01-01", max: "2027-03-17", holidays: HOLIDAYS };
  assert.equal(stepDay("2026-11-19", 1, range), "2026-11-20");
  assert.equal(stepDay("2026-11-19", -1, range), "2026-11-18");
  assert.equal(stepDay("2026-11-20", 1, range), "2026-11-23", "over the weekend");
  assert.equal(stepDay("2026-11-23", -1, range), "2026-11-20");
  // Fri 4 Dec, then the weekend, Mon 7 Dec (a substitution day), Tue 8 Dec
  assert.equal(stepDay("2026-12-04", 1, range), "2026-12-08", "over a weekend and a holiday");
  assert.equal(stepDay("2026-12-08", -1, range), "2026-12-04");
  assert.equal(stepDay("2026-12-30", 1, range), "2027-01-04", "over the New Year");
  // the ends of the range: 1 Jan 2026 is a Thursday, the repair's last day 17 Mar 2027 a Wednesday
  assert.equal(stepDay("2026-01-02", -1, range), "2026-01-01");
  assert.equal(stepDay("2026-01-01", -1, range), null);
  assert.equal(stepDay("2027-03-17", 1, range), null);
  assert.equal(stepDay("2027-03-16", 1, range), "2027-03-17");
  // a range that starts on a weekend: the first workday in it
  assert.equal(stepDay("2026-11-20", 1, { min: "2026-11-21", max: "2026-11-30", holidays: [] }), "2026-11-23");
  assert.equal(stepDay("2026-11-23", -1, { min: "2026-11-21", max: "2026-11-30", holidays: [] }), null);
});
