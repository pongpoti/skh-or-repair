import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_OPERATION_LABEL, type AddedCase } from "./added-cases.ts";
import { buildBoardRows, missingUploadDay, type BoardViewer, type WorkbookCase } from "./board-rows.ts";
import { DEFAULT_REPAIR_PERIODS } from "./repair.ts";

// Tuesday 17 Nov 2026, the first half of the repair: OR 9 to 13 operate, OR 1 to 8 do not. Workbook cases and bookings
// are placed by the half's layout: GENSX in OR 12, ORTHO in OR 13, a department without a room (URO) in the mixed
// room OR 11, dressings in OR 10 (a workbook case by its name, a booking by the doctor's choice). A booking's saved
// room counts only when no room can be worked out (no subtype).
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
    dressing: false,
    scrubDoes: null,
    surgeonId: "7",
    surgeon: "สมชาย ใจดี",
    subtype: "GENSX",
    ...more,
  };
}
const build = (workbook: WorkbookCase[] | null, bookings: AddedCase[], viewer: BoardViewer = MX) =>
  buildBoardRows({ date: DAY, periods: REPAIR, workbook, bookings, viewer });

test("with no upload for the cycle, bookings show unflagged in the rooms the app picks for them", () => {
  // The room saved with a booking is not used while one can be picked: the repair's dates may have moved since.
  const a = booking({ roomId: "or-3" });
  const b = booking({ subtype: "ORTHO", operation: "TKA" });
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

test("a matched pair shows once, in the workbook case's room, with the workbook's operation and status", () => {
  const item = wb({ hn: "0012345", operation: "Lap chole", status: "in-progress", shift: "out", dept: "GENSX" });
  // A urologist's booking goes to the mixed room, OR 11; the HOSxP list puts the case in GENSX's OR 12.
  const mine = booking({ hn: "12345", subtype: "URO", operation: "chole", shift: "in" });
  const result = build([item], [mine]);
  assert.equal(result.rows.length, 1);
  const [row] = result.rows;
  assert.deepEqual(
    [row.id, row.roomId, row.source, row.flag, row.procedure, row.status, row.shift, row.surgeon, row.bookedBy, row.hn],
    [`mt-${mine.id}`, "or-12", "matched", null, "Lap chole", "in-progress", "out", "นพ. ตัวอย่าง ศัลย์ทั่วไป", "สมชาย ใจดี", "12345"],
  );
  assert.equal(result.matched, 1);
  assert.equal(result.mismatchCount, 0);
});

test("the doctor's choice of room wins when matched: the dressing room stays, and so does the department's room", () => {
  // The doctor booked the dressing room; HOSxP names the case as the ankle's ORIF.
  const item = wb({ hn: "222", operation: "ORIF Lt ankle", dept: "ORTHO" });
  const mine = booking({ hn: "222", subtype: "ORTHO", operation: "Wound Lt ankle", dressing: true, scrubDoes: true });
  const plain = wb({ hn: "223", operation: "ORIF Rt ankle", dept: "ORTHO" });
  // The doctor booked their department's room; HOSxP's name alone would send the case to the dressing room.
  const named = wb({ hn: "224", operation: "Debridement Lt foot", dept: "ORTHO" });
  const kept = booking({ hn: "224", subtype: "ORTHO", operation: "Debridement Lt foot" });
  // Nobody booked this one: its name places it, and an I&D is a dressing (Pong, 15 Nov 2026).
  const unbooked = wb({ hn: "225", operation: "I&D abscess Rt thigh", dept: "GENSX" });
  const result = build([item, plain, named, unbooked], [mine, kept]);
  assert.deepEqual(
    result.rows.map((row) => [row.id, row.roomId, row.source, row.scrubDoes]),
    [
      [`mt-${mine.id}`, "or-10", "matched", true],
      [`hx-${plain.caseId}`, "or-13", "hosxp", undefined],
      [`mt-${kept.id}`, "or-13", "matched", undefined],
      [`hx-${unbooked.caseId}`, "or-10", "hosxp", undefined],
    ],
  );
});

test("a matched case booked in the department's room keeps the workbook's other rules: an emergency goes to the emergency room", () => {
  // HOSxP names it like a dressing and marks it Stat; the doctor booked GENSX's room.
  const stat = wb({ hn: "301", operation: "I&D abscess", urgency: "Stat", dept: "GENSX" });
  const statBooking = booking({ hn: "301", operation: "I&D abscess" });
  // NEURO emergencies use the half's own rooms for NEURO and CVT (OR 12 and 13), whatever the name.
  const neuro = wb({ hn: "302", operation: "Debridement scalp", urgency: "Emergency", dept: "NEURO" });
  const neuroBooking = booking({ hn: "302", subtype: "NEURO", operation: "Debridement scalp" });
  // Booked in the dressing room: there, though HOSxP marks it Stat.
  const dressed = wb({ hn: "303", operation: "Appendectomy", urgency: "Stat", dept: "GENSX" });
  const dressedBooking = booking({ hn: "303", dressing: true, scrubDoes: false });
  const result = build([stat, neuro, dressed], [statBooking, neuroBooking, dressedBooking]);
  assert.deepEqual(
    result.rows.map((row) => [row.id, row.roomId]),
    [
      [`mt-${statBooking.id}`, "or-9"],
      [`mt-${neuroBooking.id}`, "or-12"],
      [`mt-${dressedBooking.id}`, "or-10"],
    ],
  );
});

test("a patient booked twice on one day: each booking pairs with the HOSxP case its room fits", () => {
  // The doctor booked the dressing room for the dressing and ORTHO's room for the ORIF; HOSxP lists the ORIF first.
  const dressing = booking({ hn: "555", subtype: "ORTHO", operation: "Wound dressing Lt leg", dressing: true, scrubDoes: true });
  const orif = booking({ hn: "555", subtype: "ORTHO", operation: "ORIF Lt tibia" });
  const first = wb({ hn: "555", operation: "ORIF Lt tibia", dept: "ORTHO" });
  const second = wb({ hn: "555", operation: "Wound dressing Lt leg", dept: "ORTHO" });
  const result = build([first, second], [dressing, orif]);
  assert.deepEqual(
    result.rows.map((row) => [row.id, row.roomId, row.procedure, row.scrubDoes]),
    [
      [`mt-${orif.id}`, "or-13", "ORIF Lt tibia", undefined],
      [`mt-${dressing.id}`, "or-10", "Wound dressing Lt leg", true],
    ],
  );
});

test("a case the workbook cannot place shows in its booking's room, but a department's booking never in the dressing room", () => {
  // No department in HOSxP: the booking's own room. A booking of no subtype keeps its saved room, unless that is the
  // dressing room and the doctor did not choose it.
  const unknown = wb({ hn: "311", dept: null });
  const own = booking({ hn: "311" });
  const odd = wb({ hn: "312", dept: null, operation: "Wound dressing" });
  const oddBooking = booking({ hn: "312", subtype: null, roomId: "or-10", dressing: false });
  const result = build([unknown, odd], [own, oddBooking]);
  assert.deepEqual(
    result.rows.map((row) => [row.id, row.roomId]),
    [[`mt-${own.id}`, "or-12"]],
  );
});

test("a dressing-room booking carries the scrub answer; others carry none", () => {
  const yes = booking({ dressing: true, scrubDoes: true });
  const no = booking({ dressing: true, scrubDoes: false });
  const dept = booking({});
  // Saved before the form asked: its saved room says which, and it has no answer to show.
  const legacyDressing = booking({ roomId: "or-10", dressing: null });
  const legacyDept = booking({ roomId: "or-12", dressing: null, operation: "Wound dressing" });
  const result = build(null, [yes, no, dept, legacyDressing, legacyDept]);
  assert.deepEqual(
    result.rows.map((row) => [row.id, row.roomId, "scrubDoes" in row ? row.scrubDoes : "none"]),
    [
      [`bk-${yes.id}`, "or-10", true],
      [`bk-${no.id}`, "or-10", false],
      [`bk-${dept.id}`, "or-12", "none"],
      [`bk-${legacyDressing.id}`, "or-10", "none"],
      [`bk-${legacyDept.id}`, "or-12", "none"],
    ],
  );
});

test("left over: a workbook case is flagged unbooked in its placed room, a booking not-in-hosxp in its room", () => {
  // A dressing goes to the dressing room whatever its department, so even one with no department is placed.
  const item = wb({ operation: "Wound dressing", dept: null });
  const mine = booking({ subtype: "ORTHO" });
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

test("rows whose room does not operate that day are left off; a matched pair shows in the workbook's room", () => {
  // Bookings of a doctor with no subtype cannot be placed, so they keep the room saved with them.
  const closedBooking = booking({ hn: "31", roomId: "or-2", subtype: null }); // OR 2 is closed in the first half
  // Booked for the department's room, so placed in GENSX's OR 12 though HOSxP names a dressing.
  const matchedThere = wb({ hn: "31", operation: "Change dressing" });
  const bothClosed = booking({ hn: "32", roomId: "or-7", subtype: null }); // a recovery room
  const unplacedCase = wb({ hn: "32", dept: null }); // no department: not placed
  const unplacedAlone = wb({ hn: "33", dept: "OBGYN" }); // the obstetric building during the repair
  const lostBooking = booking({ hn: "34", roomId: "or-3", subtype: null });
  const result = build([matchedThere, unplacedCase, unplacedAlone], [closedBooking, bothClosed, lostBooking]);
  assert.deepEqual(result.rows.map((row) => [row.id, row.roomId, row.source]), [[`mt-${closedBooking.id}`, "or-12", "matched"]]);
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
  assert.deepEqual(rooms(moved), [["hosxp", "or-12", "unbooked"], ["matched", "or-13", null]]);
  const after = buildBoardRows({ date, periods: moved, workbook: stored, bookings: [mine], viewer: MX });
  assert.equal(after.mismatchCount, 1);
  assert.deepEqual(after.mismatchByRoom, { "or-12": 1 });
  // And outside the repair altogether (both halves moved away) the weekly schedule places them.
  const none = { half1: { from: "2026-11-14", to: "2026-12-31" }, half2: { from: "2027-03-01", to: "2027-03-17" } };
  const weekly = buildBoardRows({ date, periods: none, workbook: stored, bookings: [], viewer: MX });
  assert.equal(weekly.rows.length, 3, "OB-GYN has its own room outside the repair");
  assert.ok(weekly.rows.every((row) => row.flag === "unbooked"));
});

test("a booking moves with the repair's dates, like the workbook's cases", () => {
  // Mon 25 Jan 2027 is in the planned first half: ORTHO in OR 13. An admin then starts the second half that day,
  // where OR 13 is closed and ORTHO operates in OR 2.
  const date = "2027-01-25";
  const mine = booking({ date, subtype: "ORTHO", roomId: "or-13" });
  const at = (periods: typeof REPAIR) => buildBoardRows({ date, periods, workbook: null, bookings: [mine], viewer: MX }).rows.map((row) => row.roomId);
  assert.deepEqual(at(REPAIR), ["or-13"]);
  assert.deepEqual(at({ half1: { from: "2026-11-14", to: "2027-01-24" }, half2: { from: "2027-01-25", to: "2027-03-17" } }), ["or-2"]);
});

test("rows are numbered per room: workbook cases in file order, then bookings in the order they were made", () => {
  const b1 = booking({});
  const c2 = wb({ position: 2 });
  const c1 = wb({ position: 1 });
  const b2 = booking({});
  const m = wb({ hn: "M1", position: 3 });
  const mb = booking({ hn: "M1" });
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
