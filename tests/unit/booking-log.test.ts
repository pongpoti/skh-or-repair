import "./_setup";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { countEntries, describeChanges, logDay, logRoom, logTime } from "@/lib/booking-log";
import { loadBookingLog } from "@/lib/booking-log-store";
import { insertCase, removeCase, restoreCase, updateCase, updateNote, withDayLock } from "@/lib/cases";
import type { CaseInput } from "@/lib/added-cases";
import { createPool, ensureSchema } from "@/lib/db";
import { TEST_DB } from "./_setup";

const BASE: CaseInput = {
  start: null,
  end: null,
  patientName: "",
  diagnosis: "",
  date: "2026-12-01",
  roomId: "or-5",
  hn: "1234567",
  operation: "ORIF",
  shift: "in",
  dressing: false,
  scrubDoes: null,
  note: "",
};

describe("booking log (database)", () => {
  const pool = createPool(TEST_DB);
  let doctor = "";

  before(async () => {
    await ensureSchema(pool);
    await pool.query("TRUNCATE tutorial_seen, cases, mx_members, users_added, user_phones, user_claims, email_codes, user_emails, users RESTART IDENTITY");
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO users (first_name, last_name, type, subtype) VALUES ('สมชาย', 'ใจดี', 'DR', 'ORTHO') RETURNING id::text AS id",
    );
    doctor = rows[0].id;
  });
  beforeEach(() => pool.query("TRUNCATE cases, case_events RESTART IDENTITY"));
  after(() => pool.end());

  const kinds = async (id: string) =>
    (await pool.query<{ kind: string; via: string; changes: unknown }>("SELECT kind, via, changes FROM case_events WHERE case_id = $1 ORDER BY id", [id])).rows;

  test("every booking, edit, move, cancel and book-back is written, with what changed", async () => {
    const id = await insertCase(pool, doctor, "U1", BASE);
    assert.ok(await updateNote(pool, id, doctor, "งดน้ำ"));
    assert.ok(await updateCase(pool, id, doctor, { ...BASE, note: "งดน้ำ", date: "2026-12-02", roomId: "or-6", start: 510, end: 600 }, true));
    assert.ok(await removeCase(pool, id, doctor));
    assert.ok(await restoreCase(pool, id, doctor, "2026-11-28"));
    // An update that changes nothing the log names (the queue's time alone) writes nothing.
    await pool.query("UPDATE cases SET queued_at = now() WHERE id = $1", [id]);

    const rows = await kinds(id);
    assert.deepEqual(
      rows.map((r) => [r.kind, r.via]),
      [["book", "board"], ["edit", "board"], ["move", "board"], ["cancel", "board"], ["restore", "board"]],
    );
    assert.deepEqual(rows[1].changes, { note: [null, "งดน้ำ"] });
    assert.deepEqual(rows[2].changes, { date: ["2026-12-01", "2026-12-02"], room: ["or-5", "or-6"], time: [null, [510, 600]] });
  });

  test("a change in a calendar transaction says so; a deleted case takes its history with it", async () => {
    const id = await withDayLock(pool, BASE.date, async (client) => {
      await client.query("SELECT set_config('orskh.via', 'calendar', true)");
      return insertCase(client, doctor, "api:calendar", BASE, { client: "calendar", externalId: "42" });
    });
    // The setting ended with its transaction: the doctor's cancel on the board is the board's.
    assert.ok(await removeCase(pool, id, doctor));
    assert.deepEqual((await kinds(id)).map((r) => [r.kind, r.via]), [["book", "calendar"], ["cancel", "board"]]);

    await pool.query("DELETE FROM cases WHERE id = $1", [id]);
    assert.equal((await kinds(id)).length, 0);
  });

  test("bookings from before the log get their history once from their own times", async () => {
    const a = await insertCase(pool, doctor, "U1", BASE);
    const b = await insertCase(pool, doctor, "U1", { ...BASE, hn: "7654321" });
    await pool.query("UPDATE cases SET edited_at = now() WHERE id = $1", [a]);
    await removeCase(pool, b, doctor);
    await pool.query("DROP TABLE case_events");
    await ensureSchema(pool);
    await ensureSchema(pool);
    assert.deepEqual((await kinds(a)).map((r) => [r.kind, r.changes]), [["book", null], ["edit", null]]);
    assert.deepEqual((await kinds(b)).map((r) => r.kind), ["book", "cancel"]);
  });

  test("the log lists bookings latest first with their history and counts", async () => {
    const a = await insertCase(pool, doctor, "U1", { ...BASE, patientName: "สมศรี", note: "n" });
    await updateCase(pool, a, doctor, { ...BASE, patientName: "สมศรี", note: "n", roomId: "or-7" }, true);
    const b = await insertCase(pool, doctor, "U1", { ...BASE, hn: "12", place: "tha-chalom", roomId: "scope" });
    await removeCase(pool, b, doctor);

    const { entries, truncated } = await loadBookingLog(pool);
    assert.equal(truncated, false);
    assert.deepEqual(entries.map((e) => e.id), [b, a]);
    const [tc, skh] = entries;
    assert.equal(tc.placeName, "ท่าฉลอม");
    assert.equal(tc.room, "ห้อง Scope");
    assert.equal(tc.hn, "0000012");
    assert.equal(tc.cancelled, true);
    assert.deepEqual(tc.events.map((e) => e.kind), ["book", "cancel"]);
    assert.equal(skh.room, "OR 7");
    assert.equal(skh.doctor, "สมชาย ใจดี");
    assert.equal(skh.patient, "สมศรี");
    assert.deepEqual(skh.events[1].changes, [{ label: "ห้อง", before: "OR 5", after: "OR 7" }]);
    assert.deepEqual(countEntries(entries), { all: 2, booked: 1, cancelled: 1, changed: 1, calendar: 0 });

    assert.equal((await loadBookingLog(pool, 1)).truncated, true);
  });
});

describe("booking log (wording)", () => {
  test("days, times and rooms", () => {
    assert.equal(logDay("2026-11-30"), "จ. 30 พ.ย. 69");
    assert.equal(logTime(new Date("2026-11-28T07:05:00Z")), "28 พ.ย. 2569 14:05 น.");
    assert.equal(logRoom("skh", "or-13"), "OR 13");
    assert.equal(logRoom("tha-chalom", "or-2"), "OR 2");
  });

  test("changes are named in Thai, each field once, unreadable ones left out", () => {
    const same = { before: "skh", after: "skh" };
    assert.deepEqual(
      describeChanges({ hn: ["123", "7654321"], dressing: [false, true], scrub: [null, true], note: ["a", null], bogus: [1, 2], time: [[510, 600], null] }, same),
      [
        { label: "เวลา", before: "08:30–10:00", after: "ไม่ระบุ" },
        { label: "HN", before: "0000123", after: "7654321" },
        { label: "ห้องทำแผล", before: "ไม่", after: "ใช่" },
        { label: "scrub ทำให้", before: "—", after: "ใช่" },
        { label: "หมายเหตุ", before: "a", after: "—" },
      ],
    );
    assert.deepEqual(describeChanges({ place: ["skh", "tha-chalom"], room: ["or-9", "scope"] }, { before: "skh", after: "tha-chalom" }), [
      { label: "โรงพยาบาล", before: "สมุทรสาคร", after: "ท่าฉลอม" },
      { label: "ห้อง", before: "OR 9", after: "ห้อง Scope" },
    ]);
    assert.deepEqual(describeChanges(null, same), []);
    assert.deepEqual(describeChanges([1, 2], same), []);
  });
});
