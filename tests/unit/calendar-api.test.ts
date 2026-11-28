import "./_setup";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/calendar/cases/route";
import { DELETE as cancelRoute, GET as getRoute, PUT as updateRoute } from "@/app/api/v1/calendar/cases/[id]/route";
import { isCalendarApiPath } from "@/lib/calendar-api-path";
import { CALENDAR_DAILY_LIMIT, calendarId, doctorNameOf, readDateTime, readRecord } from "@/lib/calendar-api";
import { addedToday, listCasesBy, ownCase } from "@/lib/cases";
import { forgetHolidayFeeds } from "@/lib/holidays";
import { createPool, ensureSchema } from "@/lib/db";
import { calendarApiKeyHashes, ConfigError } from "@/lib/env";
import { TEST_DB } from "./_setup";

const KEY = "skhor_" + "k".repeat(43);
const OTHER_KEY = "skhor_" + "x".repeat(43);
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** A record in the shape the calendar's developer sent (27 Nov 2026): his fields, invented values (no real patient). */
const SAMPLE = {
  id: 375,
  admitDate: "2026-11-17",
  operationStart: "2026-11-17T13:00:00",
  operationEnd: null,
  type: "Surgery",
  hn: "7300375",
  citizenId: "1100000000001",
  fullName: "นายทดสอบ ตัวอย่างเคส",
  age: 21,
  rightRx: null,
  historySummary: null,
  dx: "left hemothorax",
  planOperation: "left thoracotomy with remove clot",
  linkUrl: null,
  note: null,
  status: "ได้วันผ่าตัดแล้ว นัด admit",
  doctorId: 1,
  doctorName: "นพ.ปกรณ์ หัวใจดี",
  remarks: [],
};
/** What must never come back in an answer or reach a log: the patient's details and the key. */
const SECRETS = ["1100000000001", "ตัวอย่างเคส", "hemothorax", "ได้วันผ่าตัดแล้ว", "7300375", KEY];

const BASE = "http://localhost:3999/api/v1/calendar/cases";

function call(method: string, path = "", body?: unknown, headers: Record<string, string> = {}): NextRequest {
  const text = body === undefined ? undefined : JSON.stringify(body);
  return new NextRequest(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(text !== undefined ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) } : {}),
      ...headers,
    },
    ...(text !== undefined ? { body: text } : {}),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function read(res: Response): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as Record<string, unknown>, text };
}
const post = async (body: unknown, headers?: Record<string, string>) => read(await createRoute(call("POST", "", body, headers)));
const put = async (id: string, body: unknown) => read(await updateRoute(call("PUT", `/${id}`, body), params(id)));
const del = async (id: string) => read(await cancelRoute(call("DELETE", `/${id}`), params(id)));
const get = async (id: string) => read(await getRoute(call("GET", `/${id}`), params(id)));
const list = async (query = "") => read(await listRoute(call("GET", query)));
const at = (operationStart: string | null, operationEnd: string | null = null, more: Record<string, unknown> = {}) => ({
  ...SAMPLE,
  operationStart,
  operationEnd,
  ...more,
});
const caseOf = (reply: { body: Record<string, unknown> }) => reply.body.case as Record<string, unknown>;

describe("calendar API: reading a record (no database)", () => {
  test("only the list and one record by a plain id are the API's paths", () => {
    for (const path of ["/api/v1/calendar/cases", "/api/v1/calendar/cases/375", "/api/v1/calendar/cases/123456789012345"]) {
      assert.equal(isCalendarApiPath(path), true, path);
    }
    for (const path of [
      "/api/v1/calendar",
      "/api/v1/calendar/cases/",
      "/api/v1/calendarX/cases",
      "/api/v1/calendar/casesX",
      "/api/v1/calendar/cases/0",
      "/api/v1/calendar/cases/01",
      "/api/v1/calendar/cases/1234567890123456",
      "/api/v1/calendar/cases/1/x",
      "/api/v1/calendar/cases/%2E%2E",
      "/api/v1/calendar/cases/1%2F..",
      "/API/v1/calendar/cases",
      "/api/auth/claim",
    ]) {
      assert.equal(isCalendarApiPath(path), false, path);
    }
  });

  test("ids are whole numbers of 1 to 15 digits", () => {
    assert.equal(calendarId(375), "375");
    assert.equal(calendarId("375"), "375");
    for (const bad of [0, -1, 1.5, "01", "abc", "", null, 1e15, "1234567890123456"]) assert.equal(calendarId(bad), null, String(bad));
  });

  test("a date and time is Thailand's time without an offset; with one it is turned into it", () => {
    assert.deepEqual(readDateTime("2026-11-17T13:00:00"), { date: "2026-11-17", minutes: 780 });
    assert.deepEqual(readDateTime("2026-11-17T13:00"), { date: "2026-11-17", minutes: 780 });
    assert.deepEqual(readDateTime("2026-11-17 13:15:00.1234567"), { date: "2026-11-17", minutes: 795 });
    assert.deepEqual(readDateTime("2026-11-17T06:00:00Z"), { date: "2026-11-17", minutes: 780 });
    assert.deepEqual(readDateTime("2026-11-17T13:00:00+07:00"), { date: "2026-11-17", minutes: 780 });
    assert.deepEqual(readDateTime("2026-11-16T20:00:00-0500"), { date: "2026-11-17", minutes: 480 });
    assert.deepEqual(readDateTime("2026-11-17"), { date: "2026-11-17", minutes: null });
    assert.deepEqual(readDateTime("2026-11-17T00:00:00"), { date: "2026-11-17", minutes: null }, "midnight is a day with no time");
    for (const bad of ["2026-02-30T10:00:00", "17/11/2026", "2026-11-17T25:00:00", "2026-11-17Z", 20261117, null]) {
      assert.equal(readDateTime(bad), null, String(bad));
    }
  });

  test("titles come off the doctor's name, one or several, never part of a name", () => {
    assert.equal(doctorNameOf("นพ.ปกรณ์ หัวใจดี"), "ปกรณ์ หัวใจดี");
    assert.equal(doctorNameOf("นพ. ปกรณ์   หัวใจดี "), "ปกรณ์ หัวใจดี");
    assert.equal(doctorNameOf("ผศ.นพ.ปกรณ์ หัวใจดี"), "ปกรณ์ หัวใจดี");
    assert.equal(doctorNameOf("น.พ.ปกรณ์ หัวใจดี"), "ปกรณ์ หัวใจดี");
    assert.equal(doctorNameOf("นายแพทย์ ปกรณ์ หัวใจดี"), "ปกรณ์ หัวใจดี");
    assert.equal(doctorNameOf("Dr. ปกรณ์ หัวใจดี"), "ปกรณ์ หัวใจดี");
    assert.equal(doctorNameOf("Dr.ปกรณ์ หัวใจดี"), "ปกรณ์ หัวใจดี", "Dr. with no space, like นพ.");
    assert.equal(doctorNameOf("Drake หัวใจดี"), "Drake หัวใจดี");
    assert.equal(doctorNameOf("นพดล ใจดี"), "นพดล ใจดี", "a name that starts like a title stays whole");
  });

  test("a record keeps only what a booking holds; a time is kept only when a booking can have it", () => {
    const sample = readRecord(SAMPLE);
    assert.equal(sample.ok, true);
    if (sample.ok !== true) return;
    assert.deepEqual(sample.record, {
      id: "375",
      date: "2026-11-17",
      start: null,
      end: null,
      timeWarning: "no_end",
      askedStart: 780,
      hn: "7300375",
      operation: "left thoracotomy with remove clot",
      doctorName: "นพ.ปกรณ์ หัวใจดี",
    });
    const timed = readRecord(at("2026-11-30T09:00:00", "2026-11-30T12:30:00"));
    assert.ok(timed.ok === true && timed.record.start === 540 && timed.record.end === 750 && timed.record.timeWarning === null);
    const early = readRecord(at("2026-11-30T07:30:00", "2026-11-30T10:00:00"));
    assert.ok(early.ok === true && early.record.start === null && early.record.timeWarning === "outside_hours");
    const offGrid = readRecord(at("2026-11-30T09:10:00", "2026-11-30T10:00:00"));
    assert.ok(offGrid.ok === true && offGrid.record.timeWarning === "outside_hours");
    const overnight = readRecord(at("2026-11-30T13:00:00", "2026-12-01T01:00:00"));
    assert.ok(overnight.ok === true && overnight.record.timeWarning === "end_not_same_day");
    const dateOnly = readRecord(at("2026-11-30"));
    assert.ok(dateOnly.ok === true && dateOnly.record.start === null && dateOnly.record.timeWarning === null);

    const refusedWith = (body: Record<string, unknown>) => {
      const result = readRecord(body);
      if (result.ok === true) return null;
      return result.ok === "unscheduled" ? `unscheduled:${result.reason}` : (result.reply.body as { error: string }).error;
    };
    assert.equal(refusedWith({ ...SAMPLE, type: "Clinic" }), "unscheduled:not_surgery", "another type is no operation to book");
    assert.equal(refusedWith({ ...SAMPLE, type: undefined }), "unscheduled:not_surgery");
    assert.equal(refusedWith({ ...SAMPLE, operationStart: null }), "unscheduled:no_operation_date", "no day yet: nothing to book");
    assert.equal(refusedWith({ ...SAMPLE, operationStart: "" }), "unscheduled:no_operation_date");
    assert.equal(refusedWith({ ...SAMPLE, operationStart: "17 Nov" }), "bad_date_time");
    assert.equal(refusedWith({ ...SAMPLE, operationEnd: "late" }), "bad_date_time");
    assert.equal(refusedWith({ ...SAMPLE, doctorName: " " }), "doctor_missing");
    assert.equal(refusedWith({ ...SAMPLE, id: "x1" }), "bad_id");
    assert.equal(refusedWith({ ...SAMPLE, type: " surgery " }), null, "the type in any case, with spaces");
  });
});

describe("calendar API: keys", () => {
  const saved = process.env.CALENDAR_API_KEY_SHA256;
  after(() => {
    if (saved === undefined) delete process.env.CALENDAR_API_KEY_SHA256;
    else process.env.CALENDAR_API_KEY_SHA256 = saved;
  });

  test("the key's hashes: unset is off, a bad list is a ConfigError naming the variable only", () => {
    delete process.env.CALENDAR_API_KEY_SHA256;
    assert.equal(calendarApiKeyHashes(), null);
    process.env.CALENDAR_API_KEY_SHA256 = ` ${sha(KEY).toUpperCase()} , ${sha(OTHER_KEY)} `;
    assert.deepEqual(calendarApiKeyHashes(), [sha(KEY), sha(OTHER_KEY)]);
    for (const bad of ["abc", `${sha(KEY)},nothex`, Array(5).fill(sha(KEY)).join(",")]) {
      process.env.CALENDAR_API_KEY_SHA256 = bad;
      assert.throws(
        () => calendarApiKeyHashes(),
        (error: unknown) => error instanceof ConfigError && error.names.join() === "CALENDAR_API_KEY_SHA256" && !error.message.includes(bad),
      );
    }
  });
});

describe("calendar API (database)", () => {
  const pool = createPool(TEST_DB);
  let cvt = "";
  let gensx = "";
  let logs: string[] = [];
  const consoleSaved = { info: console.info, error: console.error, warn: console.warn, log: console.log };

  before(async () => {
    await ensureSchema(pool);
    await pool.query("TRUNCATE tutorial_seen, cases, mx_members, users_added, user_phones, user_claims, email_codes, user_emails, users RESTART IDENTITY");
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (first_name, last_name, type, subtype, active) VALUES
         ('ปกรณ์', 'หัวใจดี', 'DR', 'CVT', true), ('ครองใจ', 'หัวใจดี', 'DR', 'GENSX', true),
         ('ศัลย์', 'หัวใจเดิม', 'DR', 'CVT', false), ('สมหญิง', 'รักงาน', 'RN', 'OR', true)
       RETURNING id::text AS id`,
    );
    [cvt, gensx] = rows.map((r) => r.id);
    process.env.CALENDAR_API_KEY_SHA256 = `${sha(KEY)},${sha(OTHER_KEY)}`;
    // Friday 27 Nov 2026, 10:00: the first day that can be booked is Monday 30 Nov (weeks 1, 3, 5: CVT in OR 11).
    process.env.APP_FAKE_NOW = "2026-11-27T10:00:00+07:00";
    for (const name of ["info", "error", "warn", "log"] as const) {
      console[name] = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };
    }
  });
  beforeEach(() => {
    logs = [];
  });
  after(async () => {
    Object.assign(console, consoleSaved);
    delete process.env.CALENDAR_API_KEY_SHA256;
    delete process.env.APP_FAKE_NOW;
    await pool.end();
  });

  test("the caller: off without the setting, a key or a browser refused before the body is read", async () => {
    delete process.env.CALENDAR_API_KEY_SHA256;
    assert.equal((await post(SAMPLE)).status, 404, "the API is off");
    process.env.CALENDAR_API_KEY_SHA256 = "not-a-hash";
    assert.equal((await post(SAMPLE)).body.error, "not_configured");
    process.env.CALENDAR_API_KEY_SHA256 = `${sha(KEY)},${sha(OTHER_KEY)}`;

    for (const authorization of ["", `Basic ${KEY}`, `Bearer ${KEY.slice(0, -1)}`, `Bearer skhor_${"z".repeat(43)}`, KEY]) {
      const reply = await read(await createRoute(call("POST", "", SAMPLE, { authorization })));
      assert.equal(reply.status, 401, authorization);
      assert.equal(reply.body.error, "unauthorized");
    }
    const unread = new NextRequest(BASE, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    assert.equal((await createRoute(unread)).status, 401, "no key: the body is never read");
    const browser = await post(SAMPLE, { origin: "http://localhost:3999" });
    assert.equal(browser.status, 403);
    assert.equal(browser.body.error, "browser_not_allowed");
    const second = await read(await listRoute(call("GET", "", undefined, { authorization: `Bearer ${OTHER_KEY}` })));
    assert.equal(second.status, 200, "a second key (a key being replaced) works too");

    const plain = await read(await createRoute(call("POST", "", SAMPLE, { "content-type": "text/plain" })));
    assert.equal(plain.status, 415);
    const big = await post({ ...SAMPLE, historySummary: "x".repeat(20_000) });
    assert.equal(big.status, 413);
    const array = await read(
      await createRoute(new NextRequest(BASE, { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: "[]" })),
    );
    assert.equal(array.body.error, "bad_json");
  });

  test("the sample as sent is refused for its day, with the first day that can be booked, and saves nothing", async () => {
    const reply = await post(SAMPLE);
    assert.equal(reply.status, 422);
    assert.equal(reply.body.error, "date_too_early");
    // Friday 10:00: CVT may book weekends too (Pong, 28 Nov 2026), so the first day is Saturday 28 Nov, not Monday.
    assert.equal(reply.body.earliest, "2026-11-28");
    assert.equal(reply.body.field, "operationStart");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM cases")).rows[0].n, 0);
  });

  test("POST books the named CVT doctor in his room; only the booking's fields are kept, nothing comes back", async () => {
    const reply = await post(at("2026-11-30T13:00:00"));
    assert.equal(reply.status, 201);
    assert.deepEqual(caseOf(reply), {
      id: 375,
      status: "booked",
      date: "2026-11-30",
      start: null,
      end: null,
      room: "OR 11",
      doctorName: "ปกรณ์ หัวใจดี",
      queuedAt: caseOf(reply).queuedAt,
      updatedAt: null,
      cancelledAt: null,
    });
    assert.deepEqual(reply.body.warnings, [{ code: "time_not_saved", reason: "no_end", message: "ไม่มีเวลาสิ้นสุด บันทึกแบบไม่ระบุเวลา" }]);
    assert.ok((reply.body.ignored as string[]).includes("citizenId"));
    for (const secret of SECRETS) assert.ok(!reply.text.includes(secret), secret);

    const { rows } = await pool.query(
      "SELECT surgeon_id::text AS surgeon, room_id, hn, operation, note, line_sub, api_client, external_id::text AS ext, dressing, shift FROM cases",
    );
    assert.deepEqual(rows, [
      {
        surgeon: cvt,
        room_id: "or-11",
        hn: "7300375",
        operation: "left thoracotomy with remove clot",
        note: null,
        line_sub: "api:calendar",
        api_client: "calendar",
        ext: "375",
        dressing: false,
        shift: "in",
      },
    ]);
    const mine = await listCasesBy(pool, cvt, "2026-11-27");
    assert.equal(mine[0].via, "calendar", "the doctor's own list says where it came from");
    assert.equal((await ownCase(pool, mine[0].id, cvt))?.via, "calendar");
    assert.equal(await addedToday(pool, cvt), 0, "the calendar's pushes are not the doctor's own daily limit");
    const again = await post(at("2026-11-30T13:00:00"));
    assert.deepEqual([again.status, again.body.result], [200, "unchanged"], "the same record again changes nothing");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM cases")).rows[0].n, 1);
  });

  test("POST books nothing for other types, and refuses unknown, inactive or non-CVT doctors and a day without the room", async () => {
    const admit = await post(at("2026-11-30T13:00:00", null, { id: 400, type: "Admit" }));
    assert.deepEqual([admit.status, admit.body.result, admit.body.reason, admit.body.case], [200, "not_booked", "not_surgery", null]);
    const refused = async (body: Record<string, unknown>) => (await post(body)).body.error;
    assert.equal(await refused(at("2026-11-30T13:00:00", null, { id: 400, doctorName: "นพ.ครองใจ หัวใจดี" })), "doctor_not_allowed");
    assert.equal(await refused(at("2026-11-30T13:00:00", null, { id: 400, doctorName: "นพ.ศัลย์ หัวใจเดิม" })), "doctor_not_found", "inactive");
    assert.equal(await refused(at("2026-11-30T13:00:00", null, { id: 400, doctorName: "นพ.ปกรณ์" })), "doctor_not_found", "a first name alone");
    assert.equal(await refused(at("2026-11-30T13:00:00", null, { id: 400, doctorName: "สมหญิง รักงาน" })), "doctor_not_found", "a nurse");
    assert.equal(await refused(at("2026-12-01T13:00:00", null, { id: 400 })), "no_room", "Tuesday: CVT has no room");
    assert.equal(await refused(at("2026-11-27T13:00:00", null, { id: 400 })), "date_too_early");
    assert.equal(await refused(at("2027-03-01T13:00:00", null, { id: 400 })), "date_too_far");
    assert.equal(await refused(at("2026-11-30T13:00:00", null, { id: 400, hn: "12345" })), "hn_invalid");
    assert.equal(await refused(at("2026-11-30T13:00:00", null, { id: 400, hn: 7300375 })), "hn_invalid", "an HN must be text");
    assert.equal(await refused(at("2026-11-30T13:00:00", null, { id: 400, planOperation: "  " })), "operation_invalid");
    assert.equal(await refused({ ...at("2026-11-30T13:00:00"), id: undefined }), "bad_id");
    const spaced = await post(at("2026-11-30T13:00:00", null, { id: 401, hn: "4444444", doctorName: "นพ.ปกรณ์หัวใจดี" }));
    assert.equal(spaced.status, 201, "the name with its space left out is still one doctor");
    assert.equal((await del("401")).status, 200);
  });

  test("PUT moves the booking (to the back of the queue), keeps a time, and changes nothing when nothing changed", async () => {
    const moved = await put("375", at("2026-12-02T09:00:00", "2026-12-02T12:00:00"));
    assert.equal(moved.status, 200);
    assert.equal(moved.body.result, "updated");
    assert.equal(moved.body.requeued, true);
    assert.equal(moved.body.warnings, undefined);
    assert.deepEqual(
      [caseOf(moved).date, caseOf(moved).room, caseOf(moved).start, caseOf(moved).end],
      ["2026-12-02", "OR 13", "09:00", "12:00"],
      "Wednesday: CVT in OR 13",
    );
    const same = await put("375", at("2026-12-02T09:00:00", "2026-12-02T12:00:00"));
    assert.deepEqual([same.status, same.body.result], [200, "unchanged"]);
    const later = await post(at("2026-12-02T09:00:00", "2026-12-02T13:00:00"));
    assert.deepEqual([later.body.result, later.body.requeued, caseOf(later).end], ["updated", false, "13:00"], "a new end keeps the place; POST changes too");
    assert.equal((await put("375", { ...at("2026-12-02T09:00:00"), id: 376 })).body.error, "id_mismatch");
    assert.equal((await put("375", at("2026-12-01T09:00:00"))).body.error, "no_room");

    const twice = await put("998", at("2026-12-02T09:00:00", null, { id: 998 }));
    assert.deepEqual([twice.status, twice.body.error, twice.body.field], [409, "already_booked", "hn"], "the same patient, doctor and day once");
    const fresh = await put("999", { ...at("2026-12-02T14:00:00", "2026-12-02T15:00:00", { hn: "7777777" }), id: undefined });
    assert.deepEqual([fresh.status, fresh.body.result, caseOf(fresh).id, caseOf(fresh).start], [201, "created", 999, "14:00"], "PUT books an id not booked yet");
    assert.equal((await del("999")).status, 200);
    for (const secret of SECRETS) assert.ok(!later.text.includes(secret), secret);
  });

  test("times overlap freely (Pong, 27 Nov 2026, for the board too): a time another booking in the room has is saved", async () => {
    const overlap = await post(at("2026-12-02T10:00:00", "2026-12-02T11:00:00", { id: 380, hn: "1234567" }));
    assert.equal(overlap.status, 201);
    assert.deepEqual([caseOf(overlap).room, caseOf(overlap).start, caseOf(overlap).end], ["OR 13", "10:00", "11:00"], "inside 375's 09:00-13:00");
    assert.equal(overlap.body.warnings, undefined);
  });

  test("GET reads one booking and lists them by day, without HN or operation", async () => {
    const one = await get("375");
    assert.equal(one.status, 200);
    assert.equal(caseOf(one).date, "2026-12-02");
    assert.equal((await get("997")).status, 404);
    const all = await list("?from=2026-11-27&to=2026-12-31");
    assert.deepEqual(
      (all.body.cases as { id: number }[]).map((item) => item.id),
      [375, 380],
    );
    assert.equal((await list()).status, 200, "today and 60 days on by default");
    assert.equal((await list("?from=2026-12-31&to=2026-12-01")).body.error, "bad_query");
    assert.equal((await list("?from=2026-01-01&to=2027-12-31")).body.error, "bad_query");
    for (const query of ["?from=2026-12", "?from=", "?from=01/12/2026", "?to=2026-12"]) {
      const bad = await list(query);
      assert.deepEqual([bad.status, bad.body.error], [400, "bad_query"], query);
    }
    for (const secret of SECRETS) assert.ok(!all.text.includes(secret), secret);
  });

  test("DELETE cancels (again is no error); a cancelled id is booked again by sending it again", async () => {
    const cancelled = await del("380");
    assert.deepEqual([cancelled.status, cancelled.body.result, caseOf(cancelled).status], [200, "cancelled", "cancelled"]);
    const twice = await del("380");
    assert.deepEqual([twice.status, twice.body.result], [200, "unchanged"]);
    assert.equal(caseOf(await get("380")).status, "cancelled");
    const again = await put("380", at("2026-12-02T13:00:00", "2026-12-02T14:00:00", { id: 380, hn: "1234567" }));
    assert.deepEqual([again.status, again.body.result], [201, "created"]);
    assert.equal(caseOf(await get("380")).status, "booked");
    assert.equal((await del("996")).status, 404);
  });

  test("a record with no operation to book any more (no day, another type) cancels its booking", async () => {
    assert.equal((await post(at("2026-11-30T13:00:00", null, { id: 395, hn: "5555555" }))).status, 201);
    const undated = await put("395", at(null, null, { id: 395, hn: "5555555" }));
    assert.deepEqual([undated.status, undated.body.result, undated.body.reason, caseOf(undated).status], [200, "cancelled", "no_operation_date", "cancelled"]);
    const admit = await put("395", at("2026-11-30T13:00:00", null, { id: 395, hn: "5555555", type: "Admit" }));
    assert.deepEqual([admit.status, admit.body.result, caseOf(admit).status], [200, "not_booked", "cancelled"]);
  });

  test("another doctor named: the booking goes to that doctor, at the back of the queue", async () => {
    await pool.query("INSERT INTO users (first_name, last_name, type, subtype) VALUES ('หัวใจ', 'ใหม่', 'DR', 'CVT')");
    const moved = await put("380", at("2026-12-02T13:00:00", "2026-12-02T14:00:00", { id: 380, hn: "1234567", doctorName: "หัวใจ ใหม่" }));
    assert.equal(moved.status, 200);
    assert.equal(moved.body.result, "updated");
    assert.equal(moved.body.requeued, true);
    assert.equal(caseOf(moved).doctorName, "หัวใจ ใหม่");
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM cases WHERE external_id = 380 AND removed_at IS NULL");
    assert.equal(rows[0].n, 1, "one live booking per calendar id");
  });

  test("CVT books weekends and holidays in OR 13; such a day closes at 15:00 the day before", async () => {
    const sunday = await post(at("2026-11-29T09:00:00", "2026-11-29T11:00:00", { id: 700, hn: "7300380" }));
    assert.equal(sunday.status, 201);
    assert.deepEqual([caseOf(sunday).date, caseOf(sunday).room, caseOf(sunday).start], ["2026-11-29", "OR 13", "09:00"]);
    // 16 Dec 2026, a Wednesday the hospital closes (HOSPITAL_HOLIDAYS): OR 13 too, not CVT's room of the day.
    const holiday = await post(at("2026-12-16T13:00:00", null, { id: 701, hn: "7300381" }));
    assert.deepEqual([holiday.status, caseOf(holiday).room], [201, "OR 13"]);
    const saturday = await post(at("2026-12-05T13:00:00", null, { id: 702, hn: "7300382" }));
    assert.deepEqual([saturday.status, caseOf(saturday).room], [201, "OR 13"], "a Saturday too (Pong: \"Sat is considered holiday\")");
    assert.equal(caseOf(await get("700")).room, "OR 13", "read back in OR 13");
    process.env.APP_FAKE_NOW = "2026-11-28T15:30:00+07:00";
    try {
      const closed = await put("700", at("2026-11-29T13:00:00", "2026-11-29T15:00:00", { id: 700, hn: "7300380" }));
      assert.deepEqual([closed.status, closed.body.error], [409, "day_closed"], "Saturday 15:00 closes Sunday");
      const late = await post(at("2026-11-29T13:00:00", null, { id: 703, hn: "7300383" }));
      assert.deepEqual([late.status, late.body.error], [422, "date_too_early"]);
    } finally {
      process.env.APP_FAKE_NOW = "2026-11-27T10:00:00+07:00";
    }
    for (const id of ["700", "701", "702"]) assert.equal((await del(id)).status, 200);
  });

  test("BOT holidays and special holidays: the same URL and request book OR 13 (Pong: no change to the endpoint or request)", async (t) => {
    const saved = { token: process.env.BOT_API_TOKEN, url: process.env.BOT_HOLIDAYS_URL };
    t.after(() => {
      for (const [name, value] of [["BOT_API_TOKEN", saved.token], ["BOT_HOLIDAYS_URL", saved.url]] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      forgetHolidayFeeds();
    });
    // The BOT feed: Constitution Day (Thu 10 Dec) and a special holiday announced at short notice (Mon 7 Dec, invented).
    const bot = [
      { Date: "2026-12-07", HolidayDescriptionThai: "วันหยุดพิเศษ (เพิ่มเติม)" },
      { Date: "2026-12-10", HolidayDescriptionThai: "วันรัฐธรรมนูญ" },
    ];
    t.mock.method(globalThis, "fetch", async (url: string) => {
      const year = new URL(url).searchParams.get("year");
      return new Response(JSON.stringify({ result: { data: bot.filter((item) => item.Date.startsWith(`${year}-`)) } }));
    });
    process.env.BOT_API_TOKEN = "token";
    delete process.env.BOT_HOLIDAYS_URL;
    forgetHolidayFeeds();

    const workday = await post(at("2026-12-09T13:00:00", null, { id: 710, hn: "7300390" }));
    assert.equal(workday.status, 201);
    assert.notEqual(caseOf(workday).room, "OR 13", "a workday keeps CVT's room of the day");
    const special = await post(at("2026-12-07T09:00:00", "2026-12-07T11:00:00", { id: 711, hn: "7300391" }));
    assert.deepEqual([special.status, caseOf(special).date, caseOf(special).room], [201, "2026-12-07", "OR 13"], "a BOT special holiday");
    const constitution = await post(at("2026-12-10T13:00:00", null, { id: 712, hn: "7300392" }));
    assert.deepEqual([constitution.status, caseOf(constitution).room], [201, "OR 13"], "a BOT public holiday");
    // Moving a booking from a workday onto a holiday is the same PUT, and it lands in OR 13.
    const moved = await put("710", at("2026-12-10T09:00:00", null, { id: 710, hn: "7300390" }));
    assert.deepEqual([moved.status, caseOf(moved).room], [200, "OR 13"]);
    for (const id of ["710", "711", "712"]) assert.equal((await del(id)).status, 200);
  });

  test("once the day is closed (15:00 the workday before) the booking can move or be cancelled, not change", async () => {
    await post(at("2026-11-30T13:00:00", "2026-11-30T14:00:00", { id: 390, hn: "7654321" }));
    const noEnd = await post(at("2026-11-30T09:00:00", null, { id: 389, hn: "6543210" }));
    assert.deepEqual([noEnd.status, caseOf(noEnd).start], [201, null], "saved without a time: no end");
    process.env.APP_FAKE_NOW = "2026-11-27T15:30:00+07:00";
    try {
      assert.equal((await put("390", at("2026-11-30T13:00:00", "2026-11-30T14:00:00", { id: 390, hn: "7654321" }))).body.result, "unchanged");
      const noEnd = await put("390", at("2026-11-30T13:00:00", null, { id: 390, hn: "7654321" }));
      assert.deepEqual([noEnd.body.result, caseOf(noEnd).start], ["unchanged", "13:00"], "a time it cannot give keeps the booking's own");
      const closed = await put("390", at("2026-11-30T13:00:00", "2026-11-30T15:00:00", { id: 390, hn: "7654321" }));
      assert.equal(closed.status, 409);
      assert.equal(closed.body.error, "day_closed");
      // a booking saved without its time: the same record again is still no change, with the same warning
      const again = await put("389", at("2026-11-30T09:00:00", null, { id: 389, hn: "6543210" }));
      assert.deepEqual([again.status, again.body.result, (again.body.warnings as { reason: string }[])[0].reason], [200, "unchanged", "no_end"]);
      // another start with no end is a change (refused), not the booking's own time kept
      const moved = await put("390", at("2026-11-30T09:00:00", null, { id: 390, hn: "7654321" }));
      assert.deepEqual([moved.status, moved.body.error], [409, "day_closed"]);
      const away = await put("390", at("2026-12-02", null, { id: 390, hn: "7654321" }));
      assert.equal(away.status, 200, "it can still move to an open day");
      assert.equal(caseOf(away).date, "2026-12-02");
      assert.equal((await del("390")).status, 200);
    } finally {
      process.env.APP_FAKE_NOW = "2026-11-27T10:00:00+07:00";
    }
  });

  test("past days cannot change; the daily limit stops a runaway sync", async () => {
    await post(at("2026-11-30T13:00:00", null, { id: 391, hn: "7654321" }));
    process.env.APP_FAKE_NOW = "2026-12-01T10:00:00+07:00";
    try {
      assert.equal((await put("391", at("2026-12-02", null, { id: 391, hn: "7654321" }))).body.error, "past");
      const resent = await put("391", at("2026-11-30T13:00:00", null, { id: 391, hn: "7654321" }));
      assert.deepEqual([resent.status, resent.body.result], [200, "unchanged"], "the same record again (a later save in the calendar) is no error");
      assert.equal((await put("391", at("2026-11-30T13:00:00", null, { id: 391, hn: "7654321", planOperation: "redo" }))).body.error, "past");
      assert.equal((await del("391")).body.error, "past");
    } finally {
      process.env.APP_FAKE_NOW = "2026-11-27T10:00:00+07:00";
    }
    await pool.query(
      `INSERT INTO cases (op_date, room_id, hn, operation, shift, dressing, surgeon_id, line_sub, api_client, external_id, removed_at)
       SELECT '2026-11-30', 'or-11', '1', 'x', 'in', false, $1, 'api:calendar', 'calendar', 10000 + n, now() FROM generate_series(1, $2) n`,
      [cvt, CALENDAR_DAILY_LIMIT],
    );
    const limited = await post(at("2026-11-30", null, { id: 392 }));
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error, "rate_limited");
    // another doctor named is a new booking of theirs: under the same limit
    const handed = await put("380", at("2026-12-02T13:00:00", "2026-12-02T14:00:00", { id: 380, hn: "1234567" }));
    assert.deepEqual([handed.status, handed.body.error], [429, "rate_limited"]);
    assert.equal(caseOf(await get("380")).doctorName, "หัวใจ ใหม่", "still the other doctor's");
  });

  test("a case HOSxP lists as started today can be neither moved nor cancelled, by any call; the same record again is no error", async () => {
    await pool.query("DELETE FROM cases WHERE removed_at IS NOT NULL AND external_id > 10000");
    const booked = await post(at("2026-11-30T09:00:00", "2026-11-30T10:00:00", { id: 394, hn: "3216540" }));
    assert.equal(booked.status, 201, booked.text);
    process.env.APP_FAKE_NOW = "2026-11-30T10:00:00+07:00";
    try {
      const upload = await pool.query<{ id: string }>(
        "INSERT INTO workbook_uploads (target_date, cycle_day, uploaded_by) VALUES ('2026-11-30', '2026-11-27', 'test') RETURNING id::text AS id",
      );
      await pool.query(
        `INSERT INTO workbook_cases (upload_id, case_id, hn, operation, surgeon, dept, room_id, shift, status, position)
         VALUES ($1, '1', '3216540', 'thoracotomy', 'ปกรณ์ หัวใจดี', 'CVT', 'or-11', 'in', 'in-progress', 1)`,
        [upload.rows[0].id],
      );
      const same = at("2026-11-30T09:00:00", "2026-11-30T10:00:00", { id: 394, hn: "3216540" });
      assert.deepEqual([(await put("394", same)).body.result], ["unchanged"]);
      for (const [what, reply] of [
        ["move", await put("394", { ...same, operationStart: "2026-12-02", operationEnd: null })],
        ["cancel", await del("394")],
        ["no day any more", await put("394", { ...same, operationStart: null })],
        ["another type", await put("394", { ...same, type: "Admit" })],
      ] as const) {
        assert.deepEqual([reply.status, reply.body.error], [409, "under_way"], what);
      }
      assert.equal(caseOf(await get("394")).status, "booked");
    } finally {
      process.env.APP_FAKE_NOW = "2026-11-27T10:00:00+07:00";
      await pool.query("DELETE FROM workbook_uploads");
    }
  });

  test("calls racing on one record each answer what they saved, and leave one booking at most", async () => {
    const record = (doctorName: string) => at("2026-12-02", null, { id: 386, hn: "2223334", doctorName });
    for (let round = 0; round < 6; round += 1) {
      assert.ok((await put("386", record("นพ.ปกรณ์ หัวใจดี"))).status < 300);
      const replies = await Promise.all([put("386", record("หัวใจ ใหม่")), del("386"), put("386", record("นพ.ปกรณ์ หัวใจดี"))]);
      for (const reply of replies) {
        assert.ok([200, 201, 409].includes(reply.status), reply.text);
        if (reply.status === 409) assert.equal(reply.body.error, "conflict", reply.text);
        if (reply.body.result === "cancelled") assert.equal(caseOf(reply).status, "cancelled", "a cancel answers a cancelled booking");
        if (reply.body.result === "updated" || reply.body.result === "created") assert.equal(caseOf(reply).status, "booked");
      }
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM cases WHERE external_id = 386 AND removed_at IS NULL");
      assert.ok(rows[0].n <= 1, `live bookings of one record: ${rows[0].n}`);
    }
    await del("386");
  });

  test("a call that waited for the record while it changed is answered conflict (sent again), never saved over the change", async () => {
    /** Holds the record's lock (as a call does), runs `call`, changes the booking meanwhile, then lets the call go on. */
    const meanwhile = async (id: string, call: () => Promise<Awaited<ReturnType<typeof put>>>, change: () => Promise<unknown>) => {
      const holder = await pool.connect();
      try {
        await holder.query("BEGIN");
        await holder.query("SELECT pg_advisory_xact_lock(hashtext('cases-api:' || $1 || ':' || $2))", ["calendar", id]);
        const waiting = call();
        for (let i = 0; i < 200; i += 1) {
          const { rows } = await pool.query("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted");
          if (rows[0].n > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await change();
        await holder.query("COMMIT");
        return await waiting;
      } finally {
        holder.release();
      }
    };
    const record = (more: Record<string, unknown> = {}) => at("2026-12-02", null, { id: 387, hn: "2223335", ...more });
    assert.equal((await put("387", record())).status, 201);

    // moved on the board meanwhile: the call's time is not saved over it
    const stale = await meanwhile(
      "387",
      () => put("387", record({ operationStart: "2026-12-02T14:00:00", operationEnd: "2026-12-02T15:00:00" })),
      () => pool.query("UPDATE cases SET hn = '2223336', edited_at = now() WHERE external_id = 387 AND removed_at IS NULL"),
    );
    assert.deepEqual([stale.status, stale.body.error], [409, "conflict"]);
    const again = await put("387", record({ operationStart: "2026-12-02T14:00:00", operationEnd: "2026-12-02T15:00:00" }));
    assert.deepEqual([again.status, again.body.result, caseOf(again).start], [200, "updated", "14:00"], "sent again, it is saved");

    // given to another doctor meanwhile: the cancel cancels the booking as it is then
    const other = (await pool.query("SELECT id::text AS id FROM users WHERE first_name = 'หัวใจ'")).rows[0].id;
    const cancelled = await meanwhile(
      "387",
      () => del("387"),
      async () => {
        await pool.query("UPDATE cases SET removed_at = now() WHERE external_id = 387 AND removed_at IS NULL");
        await pool.query(
          `INSERT INTO cases (op_date, room_id, hn, operation, shift, dressing, surgeon_id, line_sub, api_client, external_id)
           VALUES ('2026-12-02', 'or-13', '2223335', 'x', 'in', false, $1, 'api:calendar', 'calendar', 387)`,
          [other],
        );
      },
    );
    assert.deepEqual([cancelled.status, cancelled.body.result, caseOf(cancelled).status], [200, "cancelled", "cancelled"]);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM cases WHERE external_id = 387 AND removed_at IS NULL");
    assert.equal(rows[0].n, 0, "nothing left booked");
  });

  test("logs carry the method, the id, the status and a code, never a patient's details or the key", () => {
    // beforeEach emptied the log: run one more call and look at everything it wrote.
    return (async () => {
      await pool.query(
        `INSERT INTO cases (op_date, room_id, hn, operation, shift, dressing, surgeon_id, line_sub, api_client, external_id, removed_at)
         SELECT '2026-11-30', 'or-11', '1', 'x', 'in', false, $1, 'api:calendar', 'calendar', 20000 + n, now() FROM generate_series(1, $2) n`,
        [cvt, CALENDAR_DAILY_LIMIT],
      );
      await post(at("2026-11-30T13:00:00", null, { id: 393 }));
      await put("375", at("2026-12-02T09:00:00", "2026-12-02T13:00:00", { note: "secret note" }));
      assert.ok(logs.length > 0);
      for (const line of logs) {
        for (const secret of [...SECRETS, "secret note", gensx === "" ? "?" : "ครองใจ"]) assert.ok(!line.includes(secret), `${secret} in ${line}`);
      }
      assert.ok(logs.some((line) => /^\[calendar-api\] POST - 429 rate_limited$/.test(line)), logs.join("\n"));
    })();
  });
});
