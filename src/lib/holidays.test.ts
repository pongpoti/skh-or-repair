import assert from "node:assert/strict";
import { test } from "node:test";
import {
  botHolidayFeed,
  holidayIn,
  holidaysBetween,
  isWorkday,
  nextWorkdayAfter,
  nextWorkdayIn,
  parseBotHolidays,
  parseExtraHolidays,
} from "./holidays.ts";

test("reads the Bank of Thailand holiday list", () => {
  const json = {
    result: {
      api: "Financial Institutions' Holidays",
      timestamp: "2026-10-27 09:00:00",
      data: [
        { HolidayWeekDay: "Friday", HolidayWeekDayThai: "ศุกร์", Date: "2026-10-23", DateThai: "23/10/2569", HolidayDescription: "King Chulalongkorn Memorial Day", HolidayDescriptionThai: "วันปิยมหาราช" },
        { Date: "2026-12-31", HolidayDescription: "Additional special holiday" },
        { Date: "not a date", HolidayDescriptionThai: "x" },
      ],
    },
  };
  assert.deepEqual(parseBotHolidays(json), [
    { date: "2026-10-23", name: "วันปิยมหาราช" },
    { date: "2026-12-31", name: "Additional special holiday" },
  ]);
  assert.deepEqual(parseBotHolidays(null), []);
  assert.deepEqual(parseBotHolidays({ result: {} }), []);
  assert.deepEqual(parseBotHolidays({ error: "unauthorised" }), []);
});

test("reads extra closures and finds the holiday on a date", () => {
  const extra = parseExtraHolidays(" 2026-12-30=ปิดปรับปรุง , 2026-12-31,nope, ");
  assert.deepEqual(extra, [
    { date: "2026-12-30", name: "ปิดปรับปรุง" },
    { date: "2026-12-31", name: "วันหยุด" },
  ]);
  assert.deepEqual(parseExtraHolidays(undefined), []);
  assert.equal(holidayIn(extra, "2026-12-31")?.name, "วันหยุด");
  assert.equal(holidayIn(extra, "2026-12-29"), null);
});

test("the feed says why there are no holidays: no token, a refused token, or no answer", async (t) => {
  const calls: { url: string; auth: string | null; cache: string | null; revalidate: number | null }[] = [];
  let answer: () => Promise<Response> = async () => new Response(JSON.stringify({ result: { data: [{ Date: "2026-12-10", HolidayDescriptionThai: "วันรัฐธรรมนูญ" }] } }));
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    const next = (init as { next?: { revalidate?: number } } | undefined)?.next;
    calls.push({ url, auth: new Headers(init?.headers).get("Authorization"), cache: init?.cache ?? null, revalidate: next?.revalidate ?? null });
    return answer();
  });
  t.mock.method(console, "warn", () => {});

  // An explicit empty token, so the test does not read BOT_API_TOKEN from the shell.
  assert.deepEqual(await botHolidayFeed(2026, { token: "" }), { state: "no-token" });
  assert.deepEqual(await botHolidayFeed(2026, { token: "  \n" }), { state: "no-token" });
  assert.equal(calls.length, 0, "no token, no request");

  assert.deepEqual(await botHolidayFeed(2026, { token: " token-123\n" }), { state: "ok", holidays: [{ date: "2026-12-10", name: "วันรัฐธรรมนูญ" }] });
  assert.deepEqual(calls.at(-1), {
    url: "https://gateway.api.bot.or.th/financial-institutions-holidays/?year=2026",
    auth: "token-123",
    cache: null,
    revalidate: 21600, // the board's answer is kept for six hours
  });

  answer = async () => new Response("unauthorised", { status: 401 });
  assert.deepEqual(await botHolidayFeed(2026, { token: "wrong" }), { state: "failed", status: 401 });

  answer = async () => new Response("not json");
  assert.deepEqual(await botHolidayFeed(2026, { token: "token-123" }), { state: "failed", status: null });

  answer = async () => {
    throw new TypeError("fetch failed");
  };
  assert.deepEqual(await botHolidayFeed(2026, { token: "token-123" }), { state: "failed", status: null });
});

test("a workday is a weekday that is not a holiday; the next one is found within two weeks", () => {
  const holidays = [{ date: "2026-12-07", name: "ชดเชยวันพ่อแห่งชาติ" }];
  assert.equal(isWorkday("2026-12-04", holidays), true, "Friday");
  assert.equal(isWorkday("2026-12-05", holidays), false, "Saturday");
  assert.equal(isWorkday("2026-12-07", holidays), false, "a holiday on a Monday");
  assert.equal(nextWorkdayIn("2026-12-04", holidays), "2026-12-08");
  assert.equal(nextWorkdayIn("2026-12-04", []), "2026-12-07");
  assert.equal(nextWorkdayIn("2026-12-04", holidays, 3), null, "nothing within three days");
});

test("the holidays between two days, and the next workday after one, say why when the BOT does not answer", async (t) => {
  const saved = { token: process.env.BOT_API_TOKEN, extra: process.env.EXTRA_HOLIDAYS, url: process.env.BOT_HOLIDAYS_URL, vercel: process.env.VERCEL };
  t.after(() => {
    for (const [name, value] of Object.entries({ BOT_API_TOKEN: saved.token, EXTRA_HOLIDAYS: saved.extra, BOT_HOLIDAYS_URL: saved.url, VERCEL: saved.vercel })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  t.mock.method(console, "warn", () => {});
  const urls: string[] = [];
  let down = new Set<string>();
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    const year = new URL(url).searchParams.get("year") ?? "";
    if (down.has(year)) return new Response("down", { status: 503 });
    const data = year === "2027" ? [{ Date: "2027-01-01", HolidayDescriptionThai: "วันขึ้นปีใหม่" }] : [{ Date: "2026-12-31", HolidayDescriptionThai: "วันสิ้นปี" }];
    return new Response(JSON.stringify({ result: { data } }));
  });
  delete process.env.VERCEL;
  delete process.env.BOT_HOLIDAYS_URL;
  process.env.EXTRA_HOLIDAYS = "2026-12-30=ปิดปรับปรุง";

  process.env.BOT_API_TOKEN = "";
  assert.deepEqual(await nextWorkdayAfter("2026-12-29"), { ok: false, reason: "no-token" });
  const none = await holidaysBetween("2026-12-29", "2027-01-12");
  assert.deepEqual(none, { ok: false, reason: "no-token", holidays: [{ date: "2026-12-30", name: "ปิดปรับปรุง" }] }, "EXTRA_HOLIDAYS still");

  process.env.BOT_API_TOKEN = "token";
  // 30 Dec closed (EXTRA_HOLIDAYS), 31 Dec and 1 Jan holidays, then the weekend: Monday 4 Jan 2027.
  assert.deepEqual(await nextWorkdayAfter("2026-12-29"), { ok: true, date: "2027-01-04" });
  const both = await holidaysBetween("2026-12-29", "2027-01-12");
  assert.equal(both.ok, true);
  assert.deepEqual(both.holidays.map((h) => h.date).sort(), ["2026-12-30", "2026-12-31", "2027-01-01"]);

  // The next year's list failing is a failure too, with what did come.
  down = new Set(["2028"]);
  const partial = await holidaysBetween("2027-12-25", "2028-01-08");
  assert.equal(partial.ok, false);
  assert.ok(!partial.ok && partial.reason === "failed");
  assert.deepEqual(await nextWorkdayAfter("2027-12-25"), { ok: false, reason: "failed" });

  // Off Vercel a local stand-in for the BOT may be named; on Vercel it is ignored.
  process.env.BOT_HOLIDAYS_URL = "http://localhost:4010/holidays?x=1";
  await botHolidayFeed(2031, { token: "token" });
  assert.equal(urls.at(-1), "http://localhost:4010/holidays?x=1&year=2031");
  process.env.VERCEL = "1";
  await botHolidayFeed(2032, { token: "token" });
  assert.equal(urls.at(-1), "https://gateway.api.bot.or.th/financial-institutions-holidays/?year=2032");
});
