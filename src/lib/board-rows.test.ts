import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_OPERATION_LABEL, type AddedCase } from "./added-cases.ts";
import { buildBoardRows, missingUploadDay, type BoardViewer, type WorkbookCase } from "./board-rows.ts";
import { DEFAULT_REPAIR_PERIODS } from "./repair.ts";

// Tuesday 17 Nov 2026, the first half of the repair: OR 9 to 13 operate, OR 1 to 8 do not. Workbook cases are placed
// by the half's layout: GENSX in OR 12, ORTHO in OR 13, dressings in OR 10.
const DAY = "2026-11-17";
const REPAIR = DEFAULT_REPAIR_PERIODS;
const MX: BoardViewer = { allHn: true, userId: null };
const NOBODY: BoardViewer = { allHn: false, userId: null };

let next = 0;
function wb(more: Partial<WorkbookCase>): WorkbookCase {
  next += 1;
  return {
    caseId: `9000${next}`,
    hn: `H${next}`,
    operation: `Operation ${next}`,
    surgeon: "นพ. ตัวอย่าง ศัลย์ทั่วไป",
    dept: "GENSX",
    team: null,
    urgency: "Elective",
    shift: "in",
    status: "scheduled",
    position: next,
    ...more,
  };
}
function booking(more: Partial<AddedCase>): AddedCase {
  next += 1;
  return {
    id: String(next),
    date: DAY,
    roomId: "or-12",
    hn: `B${next}`,
    operation: "",
    shift: "in",
    surgeonId: "7",
    surgeon: "สมชาย ใจดี",
    subtype: "GENSX",
    ...more,
  };
}
const build = (workbook: WorkbookCase[] | null, bookings: AddedCase[], viewer: BoardViewer = MX) =>
  buildBoardRows({ date: DAY, periods: REPAIR, workbook, bookings, viewer });

test("with no upload for the cycle, bookings show unflagged in their rooms", () => {
  const a = booking({ roomId: "or-12" });
  const b = booking({ roomId: "or-13", operation: "TKA" });
  const result = build(null, [a, b]);
  assert.equal(result.uploaded, false);
  assert.deepEqual(
    result.rows.map((row) => [row.id, row.roomId, row.order, row.source, row.flag, row.procedure, row.status]),
    [
      [`bk-${a.id}`, "or-12", 1, "booking", null, NO_OPERATION_LABEL, "scheduled"],
      [`bk-${b.id}`, "or-13", 1, "booking", null, "TKA", "scheduled"],
    ],
  );
  assert.equal(result.mismatchCount, 0);
  assert.deepEqual(result.mismatchByRoom, {});
  assert.deepEqual(result.countByRoom, { "or-12": 1, "or-13": 1 });
  assert.equal(result.rows[0].bookedBy, "สมชาย ใจดี");
  assert.equal(result.rows[0].specialty, "ศัลยกรรมทั่วไป");
});

test("a matched pair shows once, in the booking's room, with the workbook's operation and status", () => {
  const item = wb({ hn: "0012345", operation: "Lap chole", status: "in-progress", shift: "out", dept: "GENSX" });
  const mine = booking({ hn: "12345", roomId: "or-11", operation: "chole", shift: "in" });
  const result = build([item], [mine]);
  assert.equal(result.rows.length, 1);
  const [row] = result.rows;
  assert.deepEqual(
    [row.id, row.roomId, row.source, row.flag, row.procedure, row.status, row.shift, row.surgeon, row.bookedBy, row.hn],
    [`mt-${mine.id}`, "or-11", "matched", null, "Lap chole", "in-progress", "out", "นพ. ตัวอย่าง ศัลย์ทั่วไป", "สมชาย ใจดี", "12345"],
  );
  assert.equal(result.matched, 1);
  assert.equal(result.mismatchCount, 0);
});

test("left over: a workbook case is flagged unbooked in its placed room, a booking not-in-hosxp in its room", () => {
  // A dressing goes to the dressing room whatever its department, so even one with no department is placed.
  const item = wb({ operation: "Wound dressing", dept: null });
  const mine = booking({ roomId: "or-13" });
  const result = build([item], [mine]);
  assert.deepEqual(
    result.rows.map((row) => [row.id, row.roomId, row.source, row.flag]),
    [
      [`hx-${item.caseId}`, "or-10", "hosxp", "unbooked"],
      [`bk-${mine.id}`, "or-13", "booking", "not-in-hosxp"],
    ],
  );
  assert.equal(result.rows[0].specialty, null, "no department");
  assert.equal(result.rows[0].bookedBy, undefined);
  assert.equal(result.mismatchCount, 2);
  assert.deepEqual(result.mismatchByRoom, { "or-10": 1, "or-13": 1 });
});

test("an upload with no cases still flags every booking", () => {
  const result = build([], [booking({})]);
  assert.equal(result.uploaded, true);
  assert.deepEqual(result.rows.map((row) => row.flag), ["not-in-hosxp"]);
});

test("matching is one to one, workbook cases in file order taking the earliest free booking", () => {
  const first = wb({ hn: "555", position: 2 });
  const second = wb({ hn: "555", position: 1 }); // earlier in the file
  const early = booking({ hn: "555", roomId: "or-13" });
  const late = booking({ hn: "555", roomId: "or-11" });
  const alone = booking({ hn: "556", roomId: "or-11" });
  const result = build([first, second], [early, late, alone]);
  const byId = Object.fromEntries(result.rows.map((row) => [row.id, row]));
  assert.equal(byId[`mt-${early.id}`].procedure, second.operation, "position 1 takes the earliest booking");
  assert.equal(byId[`mt-${late.id}`].procedure, first.operation);
  assert.equal(byId[`bk-${alone.id}`].flag, "not-in-hosxp");
  assert.equal(result.matched, 2);

  // Two cases, one booking: the second case is unbooked.
  const twice = build([wb({ hn: "77", position: 10 }), wb({ hn: "077", position: 11, dept: "ORTHO" })], [booking({ hn: "77" })]);
  assert.deepEqual(twice.rows.map((row) => [row.source, row.roomId, row.flag]), [["matched", "or-12", null], ["hosxp", "or-13", "unbooked"]]);
});

test("a booking from before HNs, or on another day, never matches", () => {
  const item = wb({ hn: "1" });
  const old = booking({ hn: null });
  const other = booking({ hn: "1", date: "2026-11-18" });
  const result = build([item], [old, other]);
  assert.deepEqual(result.rows.map((row) => [row.source, row.flag]), [["hosxp", "unbooked"], ["booking", "not-in-hosxp"]]);
  assert.equal(result.rows[1].id, `bk-${old.id}`);
  assert.ok(!("hn" in result.rows[1]), "no HN to show");
});

test("rows whose room does not operate that day are left off; a matched pair falls back to the workbook's room", () => {
  const closedBooking = booking({ hn: "31", roomId: "or-2" }); // OR 2 is closed in the first half
  const matchedThere = wb({ hn: "31", operation: "Change dressing" }); // placed in the dressing room, OR 10
  const bothClosed = booking({ hn: "32", roomId: "or-7" }); // a recovery room
  const unplacedCase = wb({ hn: "32", dept: null }); // no department: not placed
  const unplacedAlone = wb({ hn: "33", dept: "OBGYN" }); // the obstetric building during the repair
  const lostBooking = booking({ hn: "34", roomId: "or-3" });
  const result = build([matchedThere, unplacedCase, unplacedAlone], [closedBooking, bothClosed, lostBooking]);
  assert.deepEqual(result.rows.map((row) => [row.id, row.roomId, row.source]), [[`mt-${closedBooking.id}`, "or-10", "matched"]]);
  assert.equal(result.matched, 2, "the pair with no open room still counts as matched");
  assert.equal(result.mismatchCount, 0, "rows off the board are not shown as mismatches");
});

test("workbook cases are placed under the repair's dates in force when the board is read, not those of the upload", () => {
  // Wed 27 Jan 2027 is the first day of the planned second half: GENSX operates in OR 5 and ORTHO in OR 2, and the
  // upload stored those rooms. An admin then stretches the first half to 2 Feb, so that day OR 1 to 6 are closed.
  const date = "2027-01-27";
  const moved = { half1: { from: "2026-11-14", to: "2027-02-02" }, half2: { from: "2027-02-03", to: "2027-03-17" } };
  const stored = [
    { ...wb({ hn: "41", dept: "GENSX", position: 1 }), roomId: "or-5" },
    { ...wb({ hn: "42", dept: "ORTHO", position: 2 }), roomId: "or-2" },
    { ...wb({ hn: "43", dept: "OBGYN", position: 3 }), roomId: null },
  ];
  const mine = booking({ date, hn: "42", roomId: "or-12" });
  const rooms = (periods: typeof moved) =>
    buildBoardRows({ date, periods, workbook: stored, bookings: [mine], viewer: MX }).rows.map((row) => [row.source, row.roomId, row.flag]);

  // As uploaded: the stored rooms.
  assert.deepEqual(rooms(REPAIR), [["hosxp", "or-5", "unbooked"], ["matched", "or-2", null]]);
  // After the change nothing is lost: the cases move to the first half's rooms and are still flagged and counted.
  assert.deepEqual(rooms(moved), [["hosxp", "or-12", "unbooked"], ["matched", "or-12", null]]);
  const after = buildBoardRows({ date, periods: moved, workbook: stored, bookings: [mine], viewer: MX });
  assert.equal(after.mismatchCount, 1);
  assert.deepEqual(after.mismatchByRoom, { "or-12": 1 });
  // And outside the repair altogether (both halves moved away) the weekly schedule places them.
  const none = { half1: { from: "2026-11-14", to: "2026-12-31" }, half2: { from: "2027-03-01", to: "2027-03-17" } };
  const weekly = buildBoardRows({ date, periods: none, workbook: stored, bookings: [], viewer: MX });
  assert.equal(weekly.rows.length, 3, "OB-GYN has its own room outside the repair");
  assert.ok(weekly.rows.every((row) => row.flag === "unbooked"));
});

test("rows are numbered per room: workbook cases in file order, then bookings in the order they were made", () => {
  const b1 = booking({ roomId: "or-12" });
  const c2 = wb({ position: 2 });
  const c1 = wb({ position: 1 });
  const b2 = booking({ roomId: "or-12" });
  const m = wb({ hn: "M1", dept: "ORTHO", position: 3 });
  const mb = booking({ hn: "M1", roomId: "or-12" });
  const result = build([c2, m, c1], [b1, b2, mb]);
  assert.deepEqual(
    result.rows.map((row) => [row.id, row.order]),
    [
      [`hx-${c1.caseId}`, 1],
      [`hx-${c2.caseId}`, 2],
      [`mt-${mb.id}`, 3],
      [`bk-${b1.id}`, 4],
      [`bk-${b2.id}`, 5],
    ],
  );
  assert.deepEqual(result.countByRoom, { "or-12": 5 });
  assert.deepEqual(result.mismatchByRoom, { "or-12": 4 });
});

test("the HN reaches only MX and admins (every row) and the doctor who booked (their own bookings)", () => {
  const hosxpOnly = wb({ hn: "0099" });
  const mine = booking({ hn: "100", surgeonId: "7" });
  const mineMatched = booking({ hn: "101", surgeonId: "7" });
  const theirs = booking({ hn: "102", surgeonId: "8" });
  const theirsMatched = booking({ hn: "103", surgeonId: "8" });
  const workbook = [hosxpOnly, wb({ hn: "101" }), wb({ hn: "103" })];
  const bookings = [mine, mineMatched, theirs, theirsMatched];
  const hns = (viewer: BoardViewer) => Object.fromEntries(build(workbook, bookings, viewer).rows.map((row) => [row.id, row.hn ?? null]));

  assert.deepEqual(hns(MX), {
    [`hx-${hosxpOnly.caseId}`]: "99",
    [`mt-${mineMatched.id}`]: "101",
    [`mt-${theirsMatched.id}`]: "103",
    [`bk-${mine.id}`]: "100",
    [`bk-${theirs.id}`]: "102",
  });
  assert.deepEqual(hns({ allHn: false, userId: "7" }), {
    [`hx-${hosxpOnly.caseId}`]: null,
    [`mt-${mineMatched.id}`]: "101",
    [`mt-${theirsMatched.id}`]: null,
    [`bk-${mine.id}`]: "100",
    [`bk-${theirs.id}`]: null,
  });
  const anyone = build(workbook, bookings, NOBODY).rows;
  assert.ok(anyone.every((row) => !("hn" in row)), "no hn key at all");
  assert.doesNotMatch(JSON.stringify(anyone), /"(99|100|101|102|103)"/, "no HN anywhere in what the client gets");
});

test("the no-upload alert names the board's day whenever it has no upload, in the repair or not", () => {
  // The board's rows come only from MX's upload outside the repair too (the weekly export no longer feeds it), so an
  // empty board after 17 Mar 2027, or in a gap between the halves, must still say why.
  assert.equal(missingUploadDay({ date: "2026-11-17", uploaded: false }, false), "2026-11-17");
  assert.equal(missingUploadDay({ date: "2027-03-22", uploaded: false }, false), "2027-03-22");
  assert.equal(missingUploadDay({ date: "2027-03-22", uploaded: true }, false), null);
  // The cases could not be read: that notice instead, since whether MX uploaded is not known.
  assert.equal(missingUploadDay({ date: "2027-03-22", uploaded: false }, true), null);
  // No board (a closed day in the preview).
  assert.equal(missingUploadDay(null, false), null);
});
