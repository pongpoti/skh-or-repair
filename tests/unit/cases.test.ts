import "./_setup";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { addedToday, doctorFor, insertCase, listCasesBy, listCasesOn, removeCase } from "@/lib/cases";
import { createPool, ensureSchema } from "@/lib/db";
import { TEST_DB } from "./_setup";

describe("added cases (database)", () => {
  const pool = createPool(TEST_DB);
  let doctor = "";
  let nurse = "";
  let other = "";
  let byNumber = "";
  /** A doctor's session: signed in by email, so it holds the user id and no number. */
  const session = (userId: string, sub: string) => ({ sub, phone: null, userId });

  before(async () => {
    await ensureSchema(pool);
    await pool.query("TRUNCATE cases, mx_members, users_added, user_claims, email_codes, user_emails, users RESTART IDENTITY");
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (first_name, last_name, type, subtype) VALUES
         ('สมชาย', 'ใจดี', 'DR', 'ORTHO'), ('สมหญิง', 'รักงาน', 'RN', 'OR'), ('สมศักดิ์', 'มีสุข', 'DR', 'GENSX'),
         ('ประวิทย์', 'เบอร์เดิม', 'DR', 'URO')
       RETURNING id::text AS id`,
    );
    [doctor, nurse, other, byNumber] = rows.map((r) => r.id);
    // doctors hold their names by email; the last one only by a number (made by hand), which holds nothing
    await pool.query(
      `INSERT INTO user_claims (user_id, phone, line_sub, via, email_verified_at) VALUES
         ($1, NULL, 'U1', 'email', now()), ($2, '0900000001', 'U2', 'phone', NULL), ($3, NULL, 'U3', 'email', now()),
         ($4, '0812345678', 'U4', 'phone', NULL)`,
      [doctor, nurse, other, byNumber],
    );
  });
  after(() => pool.end());

  test("only a doctor with a current claim (by email) can add cases", async () => {
    assert.equal((await doctorFor(pool, session(doctor, "U1")))?.id, doctor);
    assert.equal(await doctorFor(pool, session(doctor, "U-other")), null, "another LINE account");
    assert.equal(await doctorFor(pool, "0900000001"), null, "a nurse");
    assert.equal(await doctorFor(pool, "0611111111"), null, "no claim");
    assert.equal(await doctorFor(pool, "0812345678"), null, "a doctor's name held by a number");
    await pool.query("UPDATE users SET active = false WHERE id = $1", [other]);
    assert.equal(await doctorFor(pool, session(other, "U3")), null, "an inactive doctor");
    await pool.query("UPDATE users SET active = true WHERE id = $1", [other]);
  });

  test("cases list by day and by surgeon, with the HN and the surgeon's id; only the surgeon removes them", async () => {
    const a = await insertCase(pool, doctor, "U1", { date: "2026-11-04", roomId: "or-2", hn: "12345", operation: "ORIF", shift: "in", dressing: false, scrubDoes: null, note: "" });
    const b = await insertCase(pool, other, "U3", { date: "2026-11-04", roomId: "or-2", hn: "A7", operation: "Hernia", shift: "out", dressing: false, scrubDoes: null, note: "" });
    await insertCase(pool, doctor, "U1", { date: "2026-11-05", roomId: "or-5", hn: "9", operation: "TKA", shift: "in", dressing: false, scrubDoes: null, note: "" });

    const day = await listCasesOn(pool, "2026-11-04");
    assert.deepEqual(
      day.map((item) => [item.id, item.roomId, item.hn, item.operation, item.shift, item.surgeonId, item.surgeon, item.subtype, item.date]),
      [
        [a, "or-2", "12345", "ORIF", "in", doctor, "สมชาย ใจดี", "ORTHO", "2026-11-04"],
        [b, "or-2", "A7", "Hernia", "out", other, "สมศักดิ์ มีสุข", "GENSX", "2026-11-04"],
      ],
    );
    assert.deepEqual((await listCasesBy(pool, doctor, "2026-11-04")).map((item) => item.operation), ["ORIF", "TKA"]);
    assert.deepEqual((await listCasesBy(pool, doctor, "2026-11-05")).map((item) => item.operation), ["TKA"]);
    // When each was booked (the board's "วันเวลาที่จองคิว"): the row's created_at, oldest first.
    const created = await pool.query<{ at: Date }>("SELECT created_at AS at FROM cases WHERE id = ANY($1::bigint[]) ORDER BY id", [[a, b]]);
    assert.deepEqual(day.map((item) => item.bookedAt), created.rows.map((row) => row.at.toISOString()));
    assert.ok((day[0].bookedAt ?? "") <= (day[1].bookedAt ?? ""), "oldest first");

    assert.equal(await removeCase(pool, b, doctor), false, "not the surgeon");
    assert.equal(await removeCase(pool, a, doctor), true);
    assert.equal(await removeCase(pool, a, doctor), false, "already removed");
    assert.deepEqual((await listCasesOn(pool, "2026-11-04")).map((item) => item.id), [b]);
    assert.equal(await addedToday(pool, doctor), 2, "removed cases still count");
  });

  test("a booking without an operation name stores NULL and reads back as an empty name", async () => {
    const id = await insertCase(pool, doctor, "U1", { date: "2026-11-20", roomId: "or-12", hn: "77", operation: "", shift: "in", dressing: false, scrubDoes: null, note: "" });
    assert.equal((await pool.query("SELECT operation FROM cases WHERE id = $1", [id])).rows[0].operation, null);
    const [item] = await listCasesOn(pool, "2026-11-20");
    assert.deepEqual([item.id, item.operation, item.hn], [id, "", "77"]);
  });

  test("a booking's note is kept with its line breaks; none is stored as NULL and reads back as an empty note", async () => {
    const noted = await insertCase(pool, doctor, "U1", { date: "2026-11-24", roomId: "or-12", hn: "91", operation: "Lap chole", shift: "in", dressing: false, scrubDoes: null, note: "ขอ C-arm\nเตรียมเลือด 2 unit" });
    const plain = await insertCase(pool, doctor, "U1", { date: "2026-11-24", roomId: "or-12", hn: "92", operation: "Hernia", shift: "in", dressing: false, scrubDoes: null, note: "" });
    const stored = await pool.query<{ id: string; note: string | null }>("SELECT id::text AS id, note FROM cases WHERE id = ANY($1::bigint[]) ORDER BY id", [[noted, plain]]);
    assert.deepEqual(stored.rows.map((row) => row.note), ["ขอ C-arm\nเตรียมเลือด 2 unit", null]);
    assert.deepEqual((await listCasesOn(pool, "2026-11-24")).map((item) => [item.id, item.note]), [[noted, "ขอ C-arm\nเตรียมเลือด 2 unit"], [plain, ""]]);
    assert.deepEqual((await listCasesBy(pool, doctor, "2026-11-24")).map((item) => item.note), ["ขอ C-arm\nเตรียมเลือด 2 unit", ""]);
    // the table refuses a blank note and one past 500 characters, as the form does
    for (const note of ["", "   ", "ก".repeat(501)]) {
      await assert.rejects(
        pool.query("INSERT INTO cases (op_date, room_id, hn, operation, note, surgeon_id, line_sub) VALUES ('2026-11-24', 'or-12', '1', 'x', $1, $2, 'U1')", [note, doctor]),
        /cases_note_check/,
        `${note.length} characters`,
      );
    }
    await pool.query("INSERT INTO cases (op_date, room_id, hn, operation, note, surgeon_id, line_sub) VALUES ('2026-11-25', 'or-12', '1', 'x', $1, $2, 'U1')", ["ก".repeat(500), doctor]);
  });

  test("cases saved before bookings carried an HN read back with none, and with no room choice", async () => {
    await pool.query("INSERT INTO cases (op_date, room_id, operation, surgeon_id, line_sub) VALUES ('2026-11-06', 'or-3', 'Old', $1, 'U1')", [doctor]);
    const [item] = await listCasesOn(pool, "2026-11-06");
    assert.deepEqual([item.operation, item.hn, item.dressing, item.scrubDoes], ["Old", null, null, null]);
  });

  test("the doctor's room choice and scrub answer are kept with the booking", async () => {
    const yes = await insertCase(pool, doctor, "U1", { date: "2026-11-23", roomId: "or-10", hn: "81", operation: "I&D", shift: "in", dressing: true, scrubDoes: true, note: "" });
    const no = await insertCase(pool, doctor, "U1", { date: "2026-11-23", roomId: "or-10", hn: "82", operation: "D/S", shift: "in", dressing: true, scrubDoes: false, note: "" });
    // a scrub answer sent with the department's room is not kept
    const dept = await insertCase(pool, doctor, "U1", { date: "2026-11-23", roomId: "or-13", hn: "83", operation: "ORIF", shift: "in", dressing: false, scrubDoes: true, note: "" });
    const listed = await listCasesOn(pool, "2026-11-23");
    assert.deepEqual(
      listed.map((item) => [item.id, item.roomId, item.dressing, item.scrubDoes]),
      [
        [yes, "or-10", true, true],
        [no, "or-10", true, false],
        [dept, "or-13", false, null],
      ],
    );
  });

  test("the table keeps a scrub answer with a dressing-room booking, and only with one", async () => {
    for (const [dressing, scrub] of [[true, null], [false, true], [false, false], [null, true]]) {
      await assert.rejects(
        pool.query(
          "INSERT INTO cases (op_date, room_id, hn, operation, dressing, scrub_does, surgeon_id, line_sub) VALUES ('2026-11-04', 'or-10', '1', 'x', $1, $2, $3, 'U1')",
          [dressing, scrub, doctor],
        ),
        (e: { code?: string }) => e.code === "23514",
        `${dressing} ${scrub}`,
      );
    }
  });

  test("the table keeps the HN in its normalised form only", async () => {
    for (const hn of ["", "12-34", "ab", "1".repeat(16), " 12"]) {
      await assert.rejects(
        pool.query("INSERT INTO cases (op_date, room_id, hn, operation, surgeon_id, line_sub) VALUES ('2026-11-04', 'or-2', $1, 'x', $2, 'U1')", [
          hn,
          doctor,
        ]),
        (e: { code?: string }) => e.code === "23514",
        JSON.stringify(hn),
      );
    }
  });

  test("the table refuses closed-format rooms, empty or long names and other shifts", async () => {
    const bad = [
      ["or-14", "x", "in"],
      ["r-1", "x", "in"],
      ["or-2", "   ", "in"],
      ["or-2", "x".repeat(301), "in"],
      ["or-2", "x", "late"],
    ];
    for (const [room, operation, shift] of bad) {
      await assert.rejects(
        pool.query("INSERT INTO cases (op_date, room_id, operation, shift, surgeon_id, line_sub) VALUES ('2026-11-04', $1, $2, $3, $4, 'U1')", [
          room,
          operation,
          shift,
          doctor,
        ]),
        `${room} ${operation.slice(0, 5)} ${shift}`,
      );
    }
  });
});
