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

  before(async () => {
    await ensureSchema(pool);
    await pool.query("TRUNCATE cases, mx_members, user_claims, email_codes, user_emails, users RESTART IDENTITY");
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (first_name, last_name, type, subtype) VALUES
         ('สมชาย', 'ใจดี', 'DR', 'ORTHO'), ('สมหญิง', 'รักงาน', 'RN', 'OR'), ('สมศักดิ์', 'มีสุข', 'DR', 'GENSX')
       RETURNING id::text AS id`,
    );
    [doctor, nurse, other] = rows.map((r) => r.id);
    await pool.query(
      `INSERT INTO user_claims (user_id, phone, line_sub) VALUES ($1, '0812345678', 'U1'), ($2, '0900000001', 'U2'), ($3, '0900000002', 'U3')`,
      [doctor, nurse, other],
    );
  });
  after(() => pool.end());

  test("only a doctor with a current claim can add cases", async () => {
    assert.equal((await doctorFor(pool, "0812345678"))?.id, doctor);
    assert.equal(await doctorFor(pool, "0900000001"), null, "a nurse");
    assert.equal(await doctorFor(pool, "0611111111"), null, "no claim");
    await pool.query("UPDATE users SET active = false WHERE id = $1", [other]);
    assert.equal(await doctorFor(pool, "0900000002"), null, "an inactive doctor");
    await pool.query("UPDATE users SET active = true WHERE id = $1", [other]);
  });

  test("cases list by day and by surgeon, with the HN and the surgeon's id; only the surgeon removes them", async () => {
    const a = await insertCase(pool, doctor, "U1", { date: "2026-11-04", roomId: "or-2", hn: "12345", operation: "ORIF", shift: "in" });
    const b = await insertCase(pool, other, "U3", { date: "2026-11-04", roomId: "or-2", hn: "A7", operation: "Hernia", shift: "out" });
    await insertCase(pool, doctor, "U1", { date: "2026-11-05", roomId: "or-5", hn: "9", operation: "TKA", shift: "in" });

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

    assert.equal(await removeCase(pool, b, doctor), false, "not the surgeon");
    assert.equal(await removeCase(pool, a, doctor), true);
    assert.equal(await removeCase(pool, a, doctor), false, "already removed");
    assert.deepEqual((await listCasesOn(pool, "2026-11-04")).map((item) => item.id), [b]);
    assert.equal(await addedToday(pool, doctor), 2, "removed cases still count");
  });

  test("a booking without an operation name stores NULL and reads back as an empty name", async () => {
    const id = await insertCase(pool, doctor, "U1", { date: "2026-11-20", roomId: "or-12", hn: "77", operation: "", shift: "in" });
    assert.equal((await pool.query("SELECT operation FROM cases WHERE id = $1", [id])).rows[0].operation, null);
    const [item] = await listCasesOn(pool, "2026-11-20");
    assert.deepEqual([item.id, item.operation, item.hn], [id, "", "77"]);
  });

  test("cases saved before bookings carried an HN read back with none", async () => {
    await pool.query("INSERT INTO cases (op_date, room_id, operation, surgeon_id, line_sub) VALUES ('2026-11-06', 'or-3', 'Old', $1, 'U1')", [doctor]);
    const [item] = await listCasesOn(pool, "2026-11-06");
    assert.deepEqual([item.operation, item.hn], ["Old", null]);
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
