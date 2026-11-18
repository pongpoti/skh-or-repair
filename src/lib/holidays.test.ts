import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOSPITAL_HOLIDAYS,
  botHolidayFeed,
  forgetHolidayFeeds,
  holidayIn,
  holidayOn,
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
  const warned: string[] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => void warned.push(args.map(String).join(" ")));

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
  assert.equal(warned.at(-1), "BOT holidays API answered 401 for 2026: unauthorised", "the log says why");

  // The gateway's reason on one line, cut short, and never the token even if it is echoed back.
  answer = async () => new Response(`{"message":\n  "Forbidden for key wrong-key"}${"x".repeat(400)}`, { status: 403 });
  assert.deepEqual(await botHolidayFeed(2026, { token: "wrong-key" }), { state: "failed", status: 403 });
  const refused = warned.at(-1) ?? "";
  assert.ok(refused.startsWith('BOT holidays API answered 403 for 2026: {"message": "Forbidden for key ***"}xxx'), refused);
  assert.ok(!refused.includes("wrong-key") && refused.length < 260, refused);
  answer = async () => new Response("", { status: 403 });
  await botHolidayFeed(2026, { token: "wrong-key" });
  assert.equal(warned.at(-1), "BOT holidays API answered 403 for 2026: (no body)");

  // A 200 without a list is not a year without holidays: the BOT answered 2027 with an empty body on 15 Nov 2026.
  answer = async () => new Response("");
  assert.deepEqual(await botHolidayFeed(2027, { token: "token-123" }), { state: "failed", status: 200 });
  assert.equal(warned.at(-1), "BOT holidays API answered 200 for 2027 without a holiday list: (no body)");
  answer = async () => new Response("<html>token-123 maintenance</html>");
  assert.deepEqual(await botHolidayFeed(2026, { token: "token-123" }), { state: "failed", status: 200 });
  assert.equal(warned.at(-1), "BOT holidays API answered 200 for 2026 without a holiday list: <html>*** maintenance</html>");

  answer = async () => {
    throw new TypeError("fetch failed");
  };
  assert.deepEqual(await botHolidayFeed(2026, { token: "token-123" }), { state: "failed", status: null });
  assert.equal(warned.at(-1), "BOT holidays API could not be reached: TypeError: fetch failed");

  // fetch quotes a refused header value in its error: a token with a line break inside never reaches the log
  answer = async () => {
    throw new TypeError('Headers.append: "abc\ndef" is an invalid header value.');
  };
  assert.deepEqual(await botHolidayFeed(2026, { token: "abc\ndef" }), { state: "failed", status: null });
  assert.ok(!(warned.at(-1) ?? "").includes("abc\ndef") && (warned.at(-1) ?? "").includes('"***"'), warned.at(-1));
});

test("16 Dec 2026 is the hospital's special holiday, without the BOT or EXTRA_HOLIDAYS; a date both name is listed once", async (t) => {
  const saved = { token: process.env.BOT_API_TOKEN, extra: process.env.EXTRA_HOLIDAYS, url: process.env.BOT_HOLIDAYS_URL };
  t.after(() => {
    for (const [name, value] of Object.entries({ BOT_API_TOKEN: saved.token, EXTRA_HOLIDAYS: saved.extra, BOT_HOLIDAYS_URL: saved.url })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  t.mock.method(console, "warn", () => {});
  assert.deepEqual(HOSPITAL_HOLIDAYS, [{ date: "2026-12-16", name: "วันหยุดกรณีพิเศษ" }]);
  delete process.env.EXTRA_HOLIDAYS;
  delete process.env.BOT_HOLIDAYS_URL;

  // No token: the hospital's holiday still counts.
  process.env.BOT_API_TOKEN = "";
  assert.deepEqual(await holidayOn("2026-12-16"), { date: "2026-12-16", name: "วันหยุดกรณีพิเศษ" });
  assert.equal(isWorkday("2026-12-16", HOSPITAL_HOLIDAYS), false, "a Wednesday");
  assert.equal(nextWorkdayIn("2026-12-15", HOSPITAL_HOLIDAYS), "2026-12-17");

  // The BOT names the same day (a special holiday announced later): one entry, the hospital's name.
  process.env.BOT_API_TOKEN = "token";
  forgetHolidayFeeds();
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ result: { data: [{ Date: "2026-12-16", HolidayDescriptionThai: "วันหยุดพิเศษ" }, { Date: "2026-12-10", HolidayDescriptionThai: "วันรัฐธรรมนูญ" }] } })),
  );
  const list = await holidaysBetween("2026-12-01", "2026-12-31");
  assert.deepEqual(list.holidays, [
    { date: "2026-12-16", name: "วันหยุดกรณีพิเศษ" },
    { date: "2026-12-10", name: "วันรัฐธรรมนูญ" },
  ]);
  assert.deepEqual(await nextWorkdayAfter("2026-12-15"), { ok: true, date: "2026-12-17" });
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
  let empty = new Set<string>();
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    const year = new URL(url).searchParams.get("year") ?? "";
    if (down.has(year)) return new Response("down", { status: 503 });
    if (empty.has(year)) return new Response(JSON.stringify({ result: { data: [] } }));
    const data = year === "2027" ? [{ Date: "2027-01-01", HolidayDescriptionThai: "วันขึ้นปีใหม่" }] : [{ Date: "2026-12-31", HolidayDescriptionThai: "วันสิ้นปี" }];
    return new Response(JSON.stringify({ result: { data } }));
  });
  delete process.env.VERCEL;
  delete process.env.BOT_HOLIDAYS_URL;
  process.env.EXTRA_HOLIDAYS = "2026-12-30=ปิดปรับปรุง";
  forgetHolidayFeeds();

  process.env.BOT_API_TOKEN = "";
  assert.deepEqual(await nextWorkdayAfter("2026-12-29"), { ok: false, reason: "no-token" });
  const none = await holidaysBetween("2026-12-29", "2027-01-12");
  assert.deepEqual(
    none,
    {
      ok: false,
      reason: "no-token",
      holidays: [
        { date: "2026-12-16", name: "วันหยุดกรณีพิเศษ" },
        { date: "2026-12-30", name: "ปิดปรับปรุง" },
      ],
      unlisted: [2026, 2027],
    },
    "the hospital's own holiday and EXTRA_HOLIDAYS still, and neither year listed by the BOT",
  );

  process.env.BOT_API_TOKEN = "token";
  // 30 Dec closed (EXTRA_HOLIDAYS), 31 Dec and 1 Jan holidays, then the weekend: Monday 4 Jan 2027.
  assert.deepEqual(await nextWorkdayAfter("2026-12-29"), { ok: true, date: "2027-01-04" });
  const both = await holidaysBetween("2026-12-29", "2027-01-12");
  assert.equal(both.ok, true);
  assert.deepEqual(both.holidays.map((h) => h.date).sort(), ["2026-12-16", "2026-12-30", "2026-12-31", "2027-01-01"]);
  assert.deepEqual(both.unlisted, [], "both years listed");

  // The next year's list failing is a failure too, with what did come.
  down = new Set(["2028"]);
  const partial = await holidaysBetween("2027-12-25", "2028-01-08");
  assert.equal(partial.ok, false);
  assert.ok(!partial.ok && partial.reason === "failed");
  assert.deepEqual(partial.unlisted, [2028], "only the year that failed");
  assert.deepEqual(await nextWorkdayAfter("2027-12-25"), { ok: false, reason: "failed" });

  // A failure is kept for half a minute only; forget it here rather than wait.
  down = new Set();
  forgetHolidayFeeds();
  // A year the BOT answers with an empty list (not announced yet) is still ok, but unlisted.
  empty = new Set(["2029"]);
  const unannounced = await holidaysBetween("2028-12-20", "2029-01-20");
  assert.deepEqual(unannounced, {
    ok: true,
    holidays: [
      { date: "2026-12-16", name: "วันหยุดกรณีพิเศษ" },
      { date: "2026-12-30", name: "ปิดปรับปรุง" },
      { date: "2026-12-31", name: "วันสิ้นปี" },
    ],
    unlisted: [2029],
  });

  // Off Vercel a local stand-in for the BOT may be named; on Vercel it is ignored.
  process.env.BOT_HOLIDAYS_URL = "http://localhost:4010/holidays?x=1";
  await botHolidayFeed(2031, { token: "token" });
  assert.equal(urls.at(-1), "http://localhost:4010/holidays?x=1&year=2031");
  process.env.VERCEL = "1";
  await botHolidayFeed(2032, { token: "token" });
  assert.equal(urls.at(-1), "https://gateway.api.bot.or.th/financial-institutions-holidays/?year=2032");
});

test("the pages keep each year's answer: a list for six hours, a year not announced yet for an hour, a failure for half a minute; calls at once share one", async (t) => {
  const saved = process.env.BOT_API_TOKEN;
  t.after(() => {
    if (saved === undefined) delete process.env.BOT_API_TOKEN;
    else process.env.BOT_API_TOKEN = saved;
  });
  t.mock.method(console, "warn", () => {});
  let clock = 1_000_000;
  t.mock.method(Date, "now", () => clock);
  const asked: string[] = [];
  let answer = (year: string) => new Response(JSON.stringify({ result: { data: year === "2026" ? [{ Date: "2026-12-10", HolidayDescriptionThai: "วันรัฐธรรมนูญ" }] : [] } }));
  t.mock.method(globalThis, "fetch", async (url: string) => {
    const year = new URL(url).searchParams.get("year") ?? "";
    asked.push(year);
    return answer(year);
  });
  process.env.BOT_API_TOKEN = "token";
  forgetHolidayFeeds();

  // Two pages at once ask once; then the answer is kept.
  await Promise.all([holidaysBetween("2026-12-01", "2027-01-31"), holidaysBetween("2026-12-01", "2027-01-31")]);
  assert.deepEqual(asked.sort(), ["2026", "2027"]);
  await holidaysBetween("2026-12-01", "2027-01-31");
  assert.equal(asked.length, 2, "kept");

  // 2027 (an empty list: not announced yet) is asked again after an hour, 2026's list after six hours.
  clock += 60 * 60 * 1000 + 1;
  await holidaysBetween("2026-12-01", "2027-01-31");
  assert.deepEqual(asked.slice(2), ["2027"]);
  clock += 5 * 60 * 60 * 1000;
  await holidaysBetween("2026-12-01", "2027-01-31");
  assert.deepEqual(asked.slice(3).sort(), ["2026", "2027"]);

  // A failure is asked about again after half a minute, and a new token is a new question.
  answer = () => new Response("down", { status: 503 });
  forgetHolidayFeeds();
  assert.equal((await holidaysBetween("2026-12-01", "2026-12-31")).ok, false);
  assert.equal((await holidaysBetween("2026-12-01", "2026-12-31")).ok, false);
  assert.equal(asked.filter((year) => year === "2026").length, 3, "the failure is kept a moment");
  answer = (year) => new Response(JSON.stringify({ result: { data: year === "2026" ? [{ Date: "2026-12-10", HolidayDescriptionThai: "วันรัฐธรรมนูญ" }] : [] } }));
  process.env.BOT_API_TOKEN = "new-token";
  assert.equal((await holidaysBetween("2026-12-01", "2026-12-31")).ok, true, "a fixed token is asked at once");
  process.env.BOT_API_TOKEN = "token";
  clock += 30 * 1000 + 1;
  assert.equal((await holidaysBetween("2026-12-01", "2026-12-31")).ok, true, "and the old one after half a minute");
});

test("a call to the BOT gives up after a few seconds, and a malformed BOT_HOLIDAYS_URL is a failed answer, not a crash", async (t) => {
  const saved = { token: process.env.BOT_API_TOKEN, url: process.env.BOT_HOLIDAYS_URL, vercel: process.env.VERCEL };
  t.after(() => {
    for (const [name, value] of Object.entries({ BOT_API_TOKEN: saved.token, BOT_HOLIDAYS_URL: saved.url, VERCEL: saved.vercel })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    forgetHolidayFeeds();
  });
  t.mock.method(console, "warn", () => {});
  process.env.BOT_API_TOKEN = "token";
  delete process.env.VERCEL;
  delete process.env.BOT_HOLIDAYS_URL;
  forgetHolidayFeeds();

  // Every page shares one call per year, so the call carries a time limit.
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    signal = init.signal ?? undefined;
    return new Response(JSON.stringify({ result: { data: [] } }));
  });
  await holidaysBetween("2026-12-01", "2026-12-31");
  assert.ok(signal instanceof AbortSignal, "the call has a time limit");

  // A relative address cannot be fetched: the pages hear "failed" and carry on.
  process.env.BOT_HOLIDAYS_URL = "/financial-institutions-holidays/";
  forgetHolidayFeeds();
  const between = await holidaysBetween("2026-12-01", "2026-12-31");
  assert.equal(between.ok, false);
});
