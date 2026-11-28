import "./_setup";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { addedToday, doctorFor, insertCase, listCasesBy, listCasesOn, ownCase, removeCase, removedCase, restoreCase, UNDO_MINUTES, updateCase, updateNote, withDayLock } from "@/lib/cases";
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
    await pool.query("TRUNCATE tutorial_seen, cases, mx_members, users_added, user_phones, user_claims, email_codes, user_emails, users RESTART IDENTITY");
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
    const a = await insertCase(pool, doctor, "U1", { start: null, end: null, patientName: "", diagnosis: "", date: "2026-11-04", roomId: "or-2", hn: "12345", operation: "ORIF", shift: "in", dressing: false, scrubDoes: null, note: "" });
    const b = await insertCase(pool, other, "U3", { start: null, end: null, patientName: "", diagnosis: "", date: "2026-11-04", roomId: "or-2", hn: "A7", operation: "Hernia", shift: "out", dressing: false, scrubDoes: null, note: "" });
    await insertCase(pool, doctor, "U1", { start: null, end: null, patientName: "", diagnosis: "", date: "2026-11-05", roomId: "or-5", hn: "9", operation: "TKA", shift: "in", dressing: false, scrubDoes: null, note: "" });

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
    // When each was booked (the board's "วันเวลาที่จองคิว"): its queue time, the row's created_at until it moves.
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
    const id = await insertCase(pool, doctor, "U1", { start: null, end: null, patientName: "", diagnosis: "", date: "2026-11-20", roomId: "or-12", hn: "77", operation: "", shift: "in", dressing: false, scrubDoes: null, note: "" });
    assert.equal((await pool.query("SELECT operation FROM cases WHERE id = $1", [id])).rows[0].operation, null);
    const [item] = await listCasesOn(pool, "2026-11-20");
    assert.deepEqual([item.id, item.operation, item.hn], [id, "", "77"]);
  });

  test("a booking's note is kept with its line breaks; none is stored as NULL and reads back as an empty note", async () => {
    const noted = await insertCase(pool, doctor, "U1", { start: null, end: null, patientName: "", diagnosis: "", date: "2026-11-24", roomId: "or-12", hn: "91", operation: "Lap chole", shift: "in", dressing: false, scrubDoes: null, note: "ขอ C-arm\nเตรียมเลือด 2 unit" });
    const plain = await insertCase(pool, doctor, "U1", { start: null, end: null, patientName: "", diagnosis: "", date: "2026-11-24", roomId: "or-12", hn: "92", operation: "Hernia", shift: "in", dressing: false, scrubDoes: null, note: "" });
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
    const yes = await insertCase(pool, doctor, "U1", { start: null, end: null, patientName: "", diagnosis: "", date: "2026-11-23", roomId: "or-10", hn: "81", operation: "I&D", shift: "in", dressing: true, scrubDoes: true, note: "" });
    const no = await insertCase(pool, doctor, "U1", { start: null, end: null, patientName: "", diagnosis: "", date: "2026-11-23", roomId: "or-10", hn: "82", operation: "D/S", shift: "in", dressing: true, scrubDoes: false, note: "" });
    // a scrub answer sent with the department's room is not kept
    const dept = await insertCase(pool, doctor, "U1", { start: null, end: null, patientName: "", diagnosis: "", date: "2026-11-23", roomId: "or-13", hn: "83", operation: "ORIF", shift: "in", dressing: false, scrubDoes: true, note: "" });
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

  // Pong, 25 Nov 2026: "on DR case row : allow surgeon to edit, move date, delete and other functions".
  test("a doctor's edit of their own booking is saved in place; a new day, room or patient takes the back of the queue", async () => {
    const base = { start: null, end: null, patientName: "", diagnosis: "", date: "2026-12-01", roomId: "or-12", hn: "11", operation: "Lap chole", shift: "in" as const, dressing: false, scrubDoes: null, note: "" };
    const first = await insertCase(pool, other, "U3", { ...base, hn: "21" });
    const mine = await insertCase(pool, doctor, "U1", { ...base, hn: "22", note: "ขอ C-arm" });
    const last = await insertCase(pool, other, "U3", { ...base, hn: "23" });
    // queue times a minute apart, as bookings made one after another
    await pool.query("UPDATE cases SET queued_at = created_at - make_interval(mins => $2) WHERE id = $1", [first, 3]);
    await pool.query("UPDATE cases SET queued_at = created_at - make_interval(mins => $2) WHERE id = $1", [mine, 2]);
    await pool.query("UPDATE cases SET queued_at = created_at - make_interval(mins => $2) WHERE id = $1", [last, 1]);
    const order = async () => (await listCasesOn(pool, "2026-12-01")).map((item) => item.id);
    assert.deepEqual(await order(), [first, mine, last]);

    assert.equal((await ownCase(pool, mine, doctor))?.note, "ขอ C-arm");
    assert.equal(await ownCase(pool, mine, other), null, "another doctor's");
    assert.equal(await ownCase(pool, "999999", doctor), null);

    // the note and the name: saved, its place kept, edited_at set
    const before = (await ownCase(pool, mine, doctor))!;
    assert.equal(before.editedAt, undefined, "never edited");
    assert.equal(await updateCase(pool, mine, doctor, { ...base, hn: "22", operation: "Lap chole + IOC", note: "" }, false), true);
    const noted = (await ownCase(pool, mine, doctor))!;
    assert.deepEqual([noted.operation, noted.note, noted.bookedAt], ["Lap chole + IOC", "", before.bookedAt]);
    assert.ok(noted.editedAt, "edited_at is set");
    assert.equal((await pool.query("SELECT note FROM cases WHERE id = $1", [mine])).rows[0].note, null, "no note is NULL");
    assert.deepEqual(await order(), [first, mine, last]);

    // another patient: the back of the queue
    assert.equal(await updateCase(pool, mine, doctor, { ...base, hn: "24" }, true), true);
    assert.deepEqual(await order(), [first, last, mine]);
    const requeued = (await ownCase(pool, mine, doctor))!;
    assert.ok((requeued.bookedAt ?? "") > (before.bookedAt ?? ""), "a later queue time, which the row shows");
    const created = await pool.query<{ created: Date; queued: Date }>("SELECT created_at AS created, queued_at AS queued FROM cases WHERE id = $1", [mine]);
    assert.ok(created.rows[0].queued > created.rows[0].created, "the time it was made stays");

    // a move to another day and the dressing room, with the scrub answer; the shift stays
    await pool.query("UPDATE cases SET shift = 'out' WHERE id = $1", [mine]);
    assert.equal(await updateCase(pool, mine, doctor, { ...base, date: "2026-12-02", roomId: "or-10", hn: "24", dressing: true, scrubDoes: false, shift: "in" }, true), true);
    assert.deepEqual(await order(), [first, last]);
    const moved = (await listCasesOn(pool, "2026-12-02")).find((item) => item.id === mine)!;
    assert.deepEqual([moved.roomId, moved.dressing, moved.scrubDoes, moved.shift], ["or-10", true, false, "out"]);
    // a scrub answer with the department's room is not kept
    assert.equal(await updateCase(pool, mine, doctor, { ...base, date: "2026-12-02", hn: "24", scrubDoes: true }, true), true);
    assert.deepEqual(((await ownCase(pool, mine, doctor))!).scrubDoes, null);
    // a closed day's note edit of a booking from before HNs were required keeps it without one
    await pool.query("UPDATE cases SET hn = NULL WHERE id = $1", [mine]);
    assert.equal(await updateCase(pool, mine, doctor, { ...base, date: "2026-12-02", hn: "", note: "x" }, false), true);
    assert.equal(((await ownCase(pool, mine, doctor))!).hn, null);

    // not theirs, or cancelled meanwhile: nothing changes
    assert.equal(await updateCase(pool, first, doctor, { ...base, hn: "21", note: "hijack" }, false), false);
    assert.equal(((await ownCase(pool, first, other))!).note, "");
    assert.equal(await removeCase(pool, mine, doctor), true);
    assert.equal(await updateCase(pool, mine, doctor, { ...base, hn: "24" }, false), false);
    assert.equal(await ownCase(pool, mine, doctor), null, "a cancelled booking is no longer theirs to edit");
  });

  // Pong, 28 Nov 2026: "add form input diagnosis and patient name, both are not required".
  test("a booking's patient's name and diagnosis are saved, read back, edited and cleared (NULL when none); the table refuses blanks and long ones", async () => {
    const base = { start: null, end: null, date: "2026-12-04", roomId: "or-12", hn: "61", operation: "Lap chole", shift: "in" as const, dressing: false, scrubDoes: null, note: "" };
    const id = await insertCase(pool, doctor, "U1", { ...base, patientName: "นาย ตัวอย่าง", diagnosis: "Symptomatic gallstone" });
    const read = (await ownCase(pool, id, doctor))!;
    assert.deepEqual([read.patientName, read.diagnosis], ["นาย ตัวอย่าง", "Symptomatic gallstone"]);
    assert.deepEqual(
      (await listCasesOn(pool, "2026-12-04")).filter((item) => item.id === id).map((item) => [item.patientName, item.diagnosis]),
      [["นาย ตัวอย่าง", "Symptomatic gallstone"]],
      "the day's list carries them (the board hands them on only to who may see the HN)",
    );
    const queued = read.bookedAt;
    // changed, then taken away: NULL in the table, "" in the app; the place in the queue kept
    assert.equal(await updateCase(pool, id, doctor, { ...base, patientName: "นาง อื่น", diagnosis: "Cholecystitis" }, false), true);
    assert.deepEqual([(await ownCase(pool, id, doctor))!.patientName, (await ownCase(pool, id, doctor))!.diagnosis], ["นาง อื่น", "Cholecystitis"]);
    assert.equal(await updateCase(pool, id, doctor, { ...base, patientName: "", diagnosis: "" }, false), true);
    const cleared = (await ownCase(pool, id, doctor))!;
    assert.deepEqual([cleared.patientName, cleared.diagnosis, cleared.bookedAt], ["", "", queued]);
    const stored = await pool.query("SELECT patient_name, diagnosis FROM cases WHERE id = $1", [id]);
    assert.deepEqual(stored.rows[0], { patient_name: null, diagnosis: null }, "none is NULL, never an empty string");
    // a closed day's note edit leaves them as they are
    assert.equal(await updateCase(pool, id, doctor, { ...base, patientName: "นาย ตัวอย่าง", diagnosis: "Gallstone" }, false), true);
    assert.equal(await updateNote(pool, id, doctor, "NPO"), true);
    const noted = (await ownCase(pool, id, doctor))!;
    assert.deepEqual([noted.patientName, noted.diagnosis, noted.note], ["นาย ตัวอย่าง", "Gallstone", "NPO"]);
    // the table's own checks: no blank, at most 100 and 300 characters
    for (const [column, value] of [
      ["patient_name", " "],
      ["patient_name", "ก".repeat(101)],
      ["diagnosis", ""],
      ["diagnosis", "x".repeat(301)],
    ] as const) {
      await assert.rejects(
        pool.query(`INSERT INTO cases (op_date, room_id, operation, surgeon_id, line_sub, ${column}) VALUES ('2026-12-04', 'or-12', 'x', $1, 'U1', $2)`, [doctor, value]),
        (e: { code?: string }) => e.code === "23514",
        `${column}: ${value.length} characters`,
      );
    }
    await pool.query("INSERT INTO cases (op_date, room_id, operation, surgeon_id, line_sub, patient_name, diagnosis) VALUES ('2026-12-04', 'or-12', 'x', $1, 'U1', $2, $3)", [
      doctor,
      "ก".repeat(100),
      "x".repeat(300),
    ]);
  });

  test("a closed day's edit saves the note alone: a booking from before the room choice keeps its NULL choice and its place", async () => {
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO cases (op_date, room_id, operation, surgeon_id, line_sub) VALUES ('2026-12-05', 'or-10', 'D/S', $1, 'U1') RETURNING id::text AS id",
      [doctor],
    );
    const id = rows[0].id;
    const before = (await ownCase(pool, id, doctor))!;
    assert.deepEqual([before.dressing, before.scrubDoes, before.hn], [null, null, null]);
    assert.equal(await updateNote(pool, id, doctor, "NPO หลังเที่ยงคืน"), true);
    const after = (await ownCase(pool, id, doctor))!;
    assert.deepEqual([after.note, after.dressing, after.scrubDoes, after.roomId, after.bookedAt], ["NPO หลังเที่ยงคืน", null, null, "or-10", before.bookedAt]);
    assert.ok(after.editedAt);
    assert.equal(await updateNote(pool, id, doctor, ""), true);
    assert.equal((await pool.query("SELECT note FROM cases WHERE id = $1", [id])).rows[0].note, null, "no note is NULL");
    assert.equal(await updateNote(pool, id, other, "x"), false, "another doctor's");
  });

  test("a cancel can be undone for a few minutes, in its old place in the queue, while its day has not gone", async () => {
    const base = { start: null, end: null, patientName: "", diagnosis: "", date: "2026-12-03", roomId: "or-12", hn: "31", operation: "Hernia", shift: "in" as const, dressing: false, scrubDoes: null, note: "" };
    const a = await insertCase(pool, doctor, "U1", base);
    const b = await insertCase(pool, other, "U3", { ...base, hn: "32" });
    await pool.query("UPDATE cases SET queued_at = created_at - interval '5 minutes' WHERE id = $1", [a]);
    assert.equal(UNDO_MINUTES, 10);

    assert.equal(await restoreCase(pool, a, doctor, "2026-11-25"), false, "not cancelled");
    assert.equal(await removeCase(pool, a, doctor), true);
    assert.deepEqual((await listCasesOn(pool, "2026-12-03")).map((item) => item.id), [b]);
    assert.equal(await restoreCase(pool, a, other, "2026-11-25"), false, "another doctor's");
    assert.equal(await restoreCase(pool, a, doctor, "2026-11-25"), true);
    assert.deepEqual((await listCasesOn(pool, "2026-12-03")).map((item) => item.id), [a, b], "back first, as it was booked first");
    assert.equal(await restoreCase(pool, a, doctor, "2026-11-25"), false, "once");

    // too late: more than UNDO_MINUTES since the cancel
    assert.equal(await removeCase(pool, a, doctor), true);
    await pool.query("UPDATE cases SET removed_at = now() - make_interval(mins => $2) WHERE id = $1", [a, UNDO_MINUTES + 1]);
    assert.equal(await restoreCase(pool, a, doctor, "2026-11-25"), false);
    // its day has gone
    await pool.query("UPDATE cases SET removed_at = now() WHERE id = $1", [a]);
    assert.equal(await restoreCase(pool, a, doctor, "2026-12-04"), false);
    assert.equal(await restoreCase(pool, a, doctor, "2026-12-03"), true, "its own day still counts");
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

  // Pong, 27 Nov 2026: "Add booking btn on ท่าฉลอม also".
  test("each hospital's bookings are its own: listed apart, and only in that hospital's rooms", async () => {
    const base = { start: null, end: null, patientName: "", diagnosis: "", date: "2026-12-08", hn: "5101", operation: "TKA", shift: "in" as const, dressing: false, scrubDoes: null, note: "" };
    const skh = await insertCase(pool, doctor, "U1", { ...base, roomId: "or-1" });
    const tc = await insertCase(pool, doctor, "U1", { ...base, roomId: "or-1", hn: "5102", place: "tha-chalom" });
    const scope = await insertCase(pool, doctor, "U1", { ...base, roomId: "scope", hn: "5103", place: "tha-chalom" });
    assert.deepEqual((await listCasesOn(pool, "2026-12-08")).map((item) => item.id), [skh], "รพ.สมุทรสาคร's day");
    const there = await listCasesOn(pool, "2026-12-08", "tha-chalom");
    assert.deepEqual(there.map((item) => [item.id, item.roomId, item.place]), [
      [tc, "or-1", "tha-chalom"],
      [scope, "scope", "tha-chalom"],
    ]);
    assert.equal("place" in (await listCasesOn(pool, "2026-12-08"))[0], false, "รพ.สมุทรสาคร's bookings say nothing of it");
    assert.deepEqual((await listCasesBy(pool, doctor, "2026-12-08", "tha-chalom")).map((item) => item.id), [tc, scope]);
    assert.ok(!(await listCasesBy(pool, doctor, "2026-12-08")).some((item) => item.id === tc || item.id === scope), "nor on รพ.สมุทรสาคร's list");
    assert.equal((await ownCase(pool, scope, doctor))?.place, "tha-chalom", "an edit knows its hospital");
    const insert = (room: string, place: string) =>
      pool.query("INSERT INTO cases (op_date, room_id, operation, surgeon_id, line_sub, place) VALUES ('2026-12-08', $1, 'x', $2, 'U1', $3)", [room, doctor, place]);
    for (const [room, place] of [["scope", "skh"], ["or-5", "tha-chalom"], ["or-1", "elsewhere"]]) {
      await assert.rejects(insert(room, place), `${room} at ${place}`);
    }
    for (const id of [skh, tc, scope]) await removeCase(pool, id, doctor);
  });

  test("a booking keeps its time; the table takes only 15-minute steps from 08:30 to 15:30, or none", async () => {
    const base = { patientName: "", diagnosis: "", date: "2026-12-07", roomId: "or-12", hn: "41", operation: "Lap chole", shift: "in" as const, dressing: false, scrubDoes: null, note: "" };
    const timed = await insertCase(pool, doctor, "U1", { ...base, start: 540, end: 600 });
    const untimed = await insertCase(pool, doctor, "U1", { ...base, hn: "42", start: null, end: null });
    const day = await listCasesOn(pool, "2026-12-07");
    assert.deepEqual(
      day.map((item) => [item.id, item.start, item.end]),
      [
        [timed, 540, 600],
        [untimed, null, null],
      ],
    );
    assert.equal(await updateCase(pool, timed, doctor, { ...base, start: 600, end: 690 }, false), true);
    assert.deepEqual([(await ownCase(pool, timed, doctor))?.start, (await ownCase(pool, timed, doctor))?.end], [600, 690]);
    assert.equal(await removeCase(pool, timed, doctor), true);
    assert.deepEqual([(await removedCase(pool, timed, doctor))?.start, (await removedCase(pool, timed, doctor))?.end], [600, 690]);
    assert.equal(await removedCase(pool, timed, other), null, "another doctor's");
    assert.equal(await removedCase(pool, untimed, doctor), null, "not cancelled");
    for (const [start, end] of [[495, 555], [900, 945], [545, 600], [600, 600], [600, null], [null, 600]]) {
      await assert.rejects(insertCase(pool, doctor, "U1", { ...base, hn: "43", start, end } as never), `${start}-${end}`);
    }
  });

  test("the day's lock lets one save at a time decide a time on a day; a failed save leaves nothing", async () => {
    const order: string[] = [];
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const first = withDayLock(pool, "2026-12-08", async () => {
      order.push("first in");
      await held;
      order.push("first out");
    });
    // Give the first a moment to take the lock.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = withDayLock(pool, "2026-12-08", async () => {
      order.push("second in");
    });
    const otherDay = withDayLock(pool, "2026-12-09", async () => {
      order.push("other day");
    });
    await otherDay;
    release();
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first in", "other day", "first out", "second in"]);

    const base = { patientName: "", diagnosis: "", date: "2026-12-08", roomId: "or-12", hn: "51", operation: "Hernia", shift: "in" as const, dressing: false, scrubDoes: null, note: "", start: 540, end: 600 };
    await assert.rejects(
      withDayLock(pool, "2026-12-08", async (client) => {
        await insertCase(client, doctor, "U1", base);
        throw new Error("refused");
      }),
    );
    assert.equal((await listCasesOn(pool, "2026-12-08")).length, 0, "rolled back");
  });
});
