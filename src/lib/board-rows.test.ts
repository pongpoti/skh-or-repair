import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_OPERATION_LABEL, type AddedCase } from "./added-cases.ts";
import {
  bookingUnderWay,
  buildBoardRows,
  buildThaChalomRows,
  missingUploadDay,
  withoutTitle,
  type BoardRows,
  type BoardViewer,
  type WorkbookCase,
} from "./board-rows.ts";
import { DEFAULT_REPAIR_PERIODS } from "./repair.ts";
import { REPAIR_FROM_JAN } from "./repair-fixtures.ts";

// Tuesday 17 Nov 2026, the first half of the repair: OR 9 to 13 operate, OR 1 to 8 do not. Workbook cases and bookings
// are placed by the half's layout: GENSX in OR 12, ORTHO in OR 13, a department without a room (URO) in the mixed
// room OR 11, dressings in OR 10 (a workbook case by its name, a booking by the doctor's choice). A booking's saved
// room counts only when no room can be worked out (no subtype).
const DAY = "2026-11-17";
const REPAIR = REPAIR_FROM_JAN;
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
    start: null,
    end: null,
    roomId: "or-12",
    hn: `B${next}`,
    operation: "",
    shift: "in",
    dressing: false,
    scrubDoes: null,
    note: "",
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
    // The surgeon without the title (Pong, 16 Nov 2026: "No นพ พญ prefix").
    [`mt-${mine.id}`, "or-12", "matched", null, "Lap chole", "in-progress", "out", "ตัวอย่าง ศัลย์ทั่วไป", "สมชาย ใจดี", "12345"],
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
  // The booked cases first, then the ones nobody booked. In the dressing room a case nobody booked is no mismatch, and
  // every row there says who does the dressing.
  assert.deepEqual(
    result.rows.map((row) => [row.id, row.roomId, row.source, row.flag, row.doneBy]),
    [
      [`mt-${mine.id}`, "or-10", "matched", null, "scrub"],
      [`mt-${kept.id}`, "or-13", "matched", null, undefined],
      [`hx-${plain.caseId}`, "or-13", "hosxp", "unbooked", undefined],
      [`hx-${unbooked.caseId}`, "or-10", "hosxp", null, "surgeon"],
    ],
  );
  assert.equal(result.mismatchCount, 1);
  assert.deepEqual(result.mismatchByRoom, { "or-13": 1 });
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
  // In the order they were booked, whatever HOSxP's order.
  assert.deepEqual(
    result.rows.map((row) => [row.id, row.roomId, row.procedure, row.doneBy]),
    [
      [`mt-${dressing.id}`, "or-10", "Wound dressing Lt leg", "scrub"],
      [`mt-${orif.id}`, "or-13", "ORIF Lt tibia", undefined],
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

test("in the dressing room each row says who does the dressing: the scrub if the booking said so, else the doctor", () => {
  const yes = booking({ dressing: true, scrubDoes: true });
  const no = booking({ dressing: true, scrubDoes: false });
  const dept = booking({});
  // Saved before the form asked: its saved room says which, and it has no answer to show.
  const legacyDressing = booking({ roomId: "or-10", dressing: null });
  const legacyDept = booking({ roomId: "or-12", dressing: null, operation: "Wound dressing" });
  const result = build(null, [yes, no, dept, legacyDressing, legacyDept]);
  assert.deepEqual(
    result.rows.map((row) => [row.id, row.roomId, "doneBy" in row ? row.doneBy : "none"]),
    [
      [`bk-${yes.id}`, "or-10", "scrub"],
      [`bk-${no.id}`, "or-10", "surgeon"],
      [`bk-${dept.id}`, "or-12", "none"],
      [`bk-${legacyDressing.id}`, "or-10", "surgeon"],
      [`bk-${legacyDept.id}`, "or-12", "none"],
    ],
  );
});

test("left over after an upload: a case nobody booked is flagged (not in the dressing room); a booking HOSxP lacks leaves the board", () => {
  // A dressing goes to the dressing room whatever its department, so even one with no department is placed.
  const item = wb({ operation: "Wound dressing", dept: null });
  const plain = wb({ dept: "GENSX" });
  const mine = booking({ subtype: "ORTHO" });
  const result = build([item, plain], [mine]);
  assert.deepEqual(
    result.rows.map((row) => [row.id, row.roomId, row.source, row.flag]),
    [
      [`hx-${item.caseId}`, "or-10", "hosxp", null],
      [`hx-${plain.caseId}`, "or-12", "hosxp", "unbooked"],
    ],
  );
  assert.equal(result.rows[0].specialty, null, "no department");
  assert.equal(result.rows[0].bookedBy, undefined);
  assert.equal(result.mismatchCount, 1);
  assert.deepEqual(result.mismatchByRoom, { "or-12": 1 });
  // The booking is no real patient (Pong, 15 Nov 2026): off the board, for MX's upload summary alone.
  assert.deepEqual(
    result.unmatched.map((row) => [row.id, row.roomId, row.source, row.flag, row.order]),
    [[`bk-${mine.id}`, "or-13", "booking", "not-in-hosxp", 1]],
  );
  assert.deepEqual(result.countByRoom, { "or-10": 1, "or-12": 1 });
});

test("an upload with no cases takes every booking off the board", () => {
  const result = build([], [booking({})]);
  assert.equal(result.uploaded, true);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.unmatched.map((row) => row.flag), ["not-in-hosxp"]);
  assert.equal(result.mismatchCount, 0);
  // Before an upload the same booking shows.
  assert.equal(build(null, [booking({})]).rows.length, 1);
  assert.deepEqual(build(null, [booking({})]).unmatched, []);
});

test("matching is one to one, workbook cases in file order taking the earliest free booking", () => {
  const first = wb({ hn: "555", position: 2 });
  const second = wb({ hn: "555", position: 1 }); // earlier in the file
  const early = booking({ hn: "555", roomId: "or-13" });
  const late = booking({ hn: "555", roomId: "or-11" });
  const alone = booking({ hn: "556", roomId: "or-11" });
  const result = build([first, second], [early, late, alone]);
  const byId = Object.fromEntries([...result.rows, ...result.unmatched].map((row) => [row.id, row]));
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
  assert.deepEqual(result.rows.map((row) => [row.source, row.flag]), [["hosxp", "unbooked"]]);
  assert.deepEqual(result.unmatched.map((row) => [row.id, row.flag]), [[`bk-${old.id}`, "not-in-hosxp"]]);
  assert.ok(!("hn" in result.unmatched[0]), "no HN to show");
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
  assert.deepEqual(rooms(REPAIR), [["matched", "or-2", null], ["hosxp", "or-5", "unbooked"]]);
  // After the change nothing is lost: the cases move to the first half's rooms and are still flagged and counted.
  assert.deepEqual(rooms(moved), [["matched", "or-13", null], ["hosxp", "or-12", "unbooked"]]);
  const after = buildBoardRows({ date, periods: moved, workbook: stored, bookings: [mine], viewer: MX });
  assert.equal(after.mismatchCount, 1);
  assert.deepEqual(after.mismatchByRoom, { "or-12": 1 });
  // And in a gap an admin leaves between the halves, the first half's rooms stay, so OB-GYN stays off the board.
  const gap = { half1: { from: "2026-11-14", to: "2026-12-31" }, half2: { from: "2027-03-01", to: "2027-03-17" } };
  const between = buildBoardRows({ date, periods: gap, workbook: stored, bookings: [], viewer: MX });
  assert.deepEqual(between.rows.map((row) => [row.roomId, row.flag]), [["or-12", "unbooked"], ["or-13", "unbooked"]]);
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

test("rows are numbered per room: the booked cases first, the earliest booking first, then HOSxP's others in file order", () => {
  // Pong, 15 Nov 2026: "first priority is booking case: sort by prior set; second priority is HOSxP sequence".
  const c2 = wb({ position: 2 });
  const c1 = wb({ position: 1 });
  const m1 = wb({ hn: "M1", position: 3 });
  const m2 = wb({ hn: "M2", position: 4 });
  // Bookings come oldest first (lib/cases.ts): M2's was made before M1's.
  const early = booking({ hn: "M2", bookedAt: "2026-11-10T02:05:00.000Z" });
  const late = booking({ hn: "M1", bookedAt: "2026-11-15T16:43:00.000Z" });
  const stray = booking({});
  const result = build([c2, m1, c1, m2], [early, stray, late]);
  assert.deepEqual(
    result.rows.map((row) => [row.id, row.order, row.bookedAt ?? null]),
    [
      [`mt-${early.id}`, 1, "10 พ.ย. 69, 09:05"],
      [`mt-${late.id}`, 2, "15 พ.ย. 69, 23:43"],
      [`hx-${c1.caseId}`, 3, null],
      [`hx-${c2.caseId}`, 4, null],
    ],
  );
  assert.deepEqual(result.countByRoom, { "or-12": 4 });
  assert.deepEqual(result.mismatchByRoom, { "or-12": 2 });
  assert.deepEqual(result.unmatched.map((row) => row.id), [`bk-${stray.id}`]);

  // Before an upload the bookings alone, in the order they were booked, with their time.
  const before = build(null, [early, stray, late]);
  assert.deepEqual(before.rows.map((row) => [row.id, row.order]), [[`bk-${early.id}`, 1], [`bk-${stray.id}`, 2], [`bk-${late.id}`, 3]]);
  assert.equal(before.rows[0].bookedAt, "10 พ.ย. 69, 09:05");
  assert.ok(!("bookedAt" in before.rows[1]), "no time when the booking has none");
});

test("the HN reaches only MX and admins (every row) and the doctor who booked (their own bookings)", () => {
  const hosxpOnly = wb({ hn: "0099" });
  const mine = booking({ hn: "100", surgeonId: "7" });
  const mineMatched = booking({ hn: "101", surgeonId: "7" });
  const theirs = booking({ hn: "102", surgeonId: "8" });
  const theirsMatched = booking({ hn: "103", surgeonId: "8" });
  const workbook = [hosxpOnly, wb({ hn: "101" }), wb({ hn: "103" })];
  const bookings = [mine, mineMatched, theirs, theirsMatched];
  // The bookings HOSxP lacks are off the board but in MX's upload summary: the same rule.
  const all = (viewer: BoardViewer) => {
    const built = build(workbook, bookings, viewer);
    return [...built.rows, ...built.unmatched];
  };
  const hns = (viewer: BoardViewer) => Object.fromEntries(all(viewer).map((row) => [row.id, row.hn ?? null]));

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
  const anyone = all(NOBODY);
  assert.ok(anyone.every((row) => !("hn" in row)), "no hn key at all");
  assert.doesNotMatch(JSON.stringify(anyone), /"(99|100|101|102|103)"/, "no HN anywhere in what the client gets");
});

// Pong, 25 Nov 2026: "on DR case row : allow surgeon to edit, move date, delete and other functions".
test("the booking's id (for its actions) reaches only the doctor who booked it, on their booked and matched rows", () => {
  const mine = booking({ hn: "100", surgeonId: "7" });
  const mineMatched = booking({ hn: "101", surgeonId: "7" });
  const theirs = booking({ hn: "102", surgeonId: "8" });
  const workbook = [wb({ hn: "0099" }), wb({ hn: "101" })];
  const ids = (viewer: BoardViewer) => {
    const built = build(workbook, [mine, mineMatched, theirs], viewer);
    return Object.fromEntries([...built.rows, ...built.unmatched].map((row) => [row.id, row.bookingId ?? null]));
  };
  assert.deepEqual(Object.values(ids({ allHn: false, userId: "7" })).filter(Boolean).sort(), [mine.id, mineMatched.id].sort());
  assert.deepEqual(ids({ allHn: false, userId: "7" })[`mt-${mineMatched.id}`], mineMatched.id, "matched: the booking's id, not HOSxP's");
  for (const viewer of [MX, NOBODY, { allHn: false, userId: "8" }]) {
    const seen = Object.values(ids(viewer)).filter(Boolean);
    assert.deepEqual(seen, viewer.userId === "8" ? [theirs.id] : [], JSON.stringify(viewer));
  }
});

test("a booking HOSxP says is under way or over is found on its row: in progress, done or in recovery, not scheduled or delayed", () => {
  const mine = booking({ hn: "300", surgeonId: "7" });
  const input = (status: WorkbookCase["status"] | null) => ({
    date: DAY,
    periods: REPAIR,
    workbook: status === null ? null : [wb({ hn: "300", status })],
    bookings: [mine],
  });
  for (const status of ["in-progress", "done", "recovery"] as const) assert.equal(bookingUnderWay(input(status), mine.id, "7"), true, status);
  for (const status of ["scheduled", "delayed", "cancelled"] as const) assert.equal(bookingUnderWay(input(status), mine.id, "7"), false, status);
  assert.equal(bookingUnderWay(input(null), mine.id, "7"), false, "no upload");
  assert.equal(bookingUnderWay(input("done"), mine.id, "8"), false, "another doctor's");
});

test("the patient's name follows the HN: MX and admins on every row, the doctor who booked on their own matched case", () => {
  const hosxpOnly = wb({ hn: "0199", patientName: "ตัวอย่าง ผู้ป่วยหนึ่ง" });
  const mineMatched = booking({ hn: "201", surgeonId: "7" });
  const theirsMatched = booking({ hn: "203", surgeonId: "8" });
  const mine = booking({ hn: "204", surgeonId: "7" });
  const workbook = [
    hosxpOnly,
    wb({ hn: "201", patientName: "ตัวอย่าง ผู้ป่วยสอง" }),
    wb({ hn: "203", patientName: "ตัวอย่าง ผู้ป่วยสาม" }),
    // An upload from before the name was read: no name, and no empty line.
    wb({ hn: "205", patientName: null }),
  ];
  const names = (viewer: BoardViewer) =>
    Object.fromEntries(build(workbook, [mineMatched, theirsMatched, mine], viewer).rows.map((row) => [row.id, row.patientName ?? null]));
  const old = `hx-${workbook[3].caseId}`;
  assert.deepEqual(names(MX), {
    [`mt-${mineMatched.id}`]: "ตัวอย่าง ผู้ป่วยสอง",
    [`mt-${theirsMatched.id}`]: "ตัวอย่าง ผู้ป่วยสาม",
    [`hx-${hosxpOnly.caseId}`]: "ตัวอย่าง ผู้ป่วยหนึ่ง",
    [old]: null,
  });
  // A booking alone has no name: it comes only from HOSxP's list.
  assert.deepEqual(names({ allHn: false, userId: "7" }), {
    [`mt-${mineMatched.id}`]: "ตัวอย่าง ผู้ป่วยสอง",
    [`mt-${theirsMatched.id}`]: null,
    [`hx-${hosxpOnly.caseId}`]: null,
    [old]: null,
  });
  const anyone = build(workbook, [mineMatched, theirsMatched, mine], NOBODY);
  const sent = [...anyone.rows, ...anyone.unmatched];
  assert.ok(sent.every((row) => !("patientName" in row)), "no patientName key at all");
  assert.doesNotMatch(JSON.stringify(sent), /ผู้ป่วย/, "no name anywhere in what the client gets");
});

test("a booking's note reaches every viewer on its row, matched or not; rows without one have no note key", () => {
  const matched = booking({ hn: "301", surgeonId: "7", note: "ขอ C-arm\nเตรียมเลือด 2 unit" });
  const alone = booking({ hn: "302", surgeonId: "8", note: "ผู้ป่วยแพ้ latex" });
  const plain = booking({ hn: "303", surgeonId: "8" });
  const workbook = [wb({ hn: "301" }), wb({ hn: "309" })];
  const notes = (rows: readonly { id: string; note?: string }[]) => Object.fromEntries(rows.map((row) => [row.id, row.note ?? null]));
  for (const viewer of [MX, NOBODY, { allHn: false, userId: "7" }]) {
    // before the upload every booking shows, with its note
    assert.deepEqual(notes(build(null, [matched, alone, plain], viewer).rows), {
      [`bk-${matched.id}`]: "ขอ C-arm\nเตรียมเลือด 2 unit",
      [`bk-${alone.id}`]: "ผู้ป่วยแพ้ latex",
      [`bk-${plain.id}`]: null,
    });
    // after it, the matched case carries its booking's note; HOSxP's own cases have none
    const after = build(workbook, [matched, alone, plain], viewer);
    assert.deepEqual(notes(after.rows), { [`mt-${matched.id}`]: "ขอ C-arm\nเตรียมเลือด 2 unit", [`hx-${workbook[1].caseId}`]: null });
    assert.ok(after.rows.filter((row) => row.id.startsWith("hx-")).every((row) => !("note" in row)), "no note key on a HOSxP row");
  }
});

test("HOSxP's surgeon loses the title on the board; a name without one is kept as it is", () => {
  assert.equal(withoutTitle("นพ. ตัวอย่าง ศัลย์ทั่วไป"), "ตัวอย่าง ศัลย์ทั่วไป");
  assert.equal(withoutTitle("พญ. ตัวอย่าง สูติ"), "ตัวอย่าง สูติ");
  assert.equal(withoutTitle("น.พ. ตัวอย่าง กระดูก"), "ตัวอย่าง กระดูก");
  assert.equal(withoutTitle("พ.ญ.ตัวอย่าง หู"), "ตัวอย่าง หู");
  assert.equal(withoutTitle("ทพ. ตัวอย่าง ฟัน"), "ตัวอย่าง ฟัน");
  assert.equal(withoutTitle("ทพญ. ตัวอย่าง ช่องปาก"), "ตัวอย่าง ช่องปาก");
  assert.equal(withoutTitle("สมชาย ใจดี"), "สมชาย ใจดี");
  // A name that is only a title stays, rather than an empty line.
  assert.equal(withoutTitle("นพ."), "นพ.");
  // Only a title at the start: a name that happens to begin with the same letters is not cut.
  assert.equal(withoutTitle("นพดล ตัวอย่าง"), "นพดล ตัวอย่าง");
  const [row] = build([wb({ surgeon: "พญ. ตัวอย่าง สูติ" })], []).rows;
  assert.equal(row.surgeon, "ตัวอย่าง สูติ");
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

test("a department with two rooms: bookings stay where the doctor saw them, and each surgeon's HOSxP cases join them", () => {
  // Monday 23 Nov 2026, the weekly schedule: GENSX holds OR 2 and OR 5. Pong, 22 Nov 2026: "How to deal with matching
  // cases of dept that has 2 OR rooms ?"
  const MONDAY = "2026-11-23";
  const on = (workbook: WorkbookCase[] | null, bookings: AddedCase[]) =>
    buildBoardRows({ date: MONDAY, periods: DEFAULT_REPAIR_PERIODS, workbook, bookings, viewer: MX });
  // Doctor 8 booked first and got OR 2; doctor 7 then got the emptier OR 5 (lib/added-cases.ts roomAmong).
  const first = booking({ date: MONDAY, roomId: "or-2", hn: "1111111", surgeonId: "8", surgeon: "หมอ แปด", operation: "Lap chole" });
  const second = booking({ date: MONDAY, roomId: "or-5", hn: "2222222", surgeonId: "7", surgeon: "หมอ เจ็ด", operation: "Hernia" });
  const before = on(null, [first, second]);
  const homes = (rows: BoardRows["rows"]) => rows.filter((row) => !row.shownFrom);
  assert.deepEqual(
    homes(before.rows).map((row) => [row.id, row.roomId]),
    [
      [`bk-${first.id}`, "or-2"],
      [`bk-${second.id}`, "or-5"],
    ],
  );
  // After the upload each booked case keeps its room, the surgeon's other cases join it, and a surgeon nobody booked
  // for goes to the emptier room.
  const seven = "นพ. เจ็ด ศัลย์";
  const eight = "นพ. แปด ศัลย์";
  const after = on(
    [
      wb({ hn: "3333333", surgeon: seven, operation: "Lap appendectomy" }),
      wb({ hn: "2222222", surgeon: seven, operation: "Herniorrhaphy" }),
      wb({ hn: "1111111", surgeon: eight, operation: "Lap chole" }),
      wb({ hn: "4444444", surgeon: "นพ. เก้า ศัลย์", operation: "Excision" }),
      wb({ hn: "5555555", surgeon: seven, operation: "Thyroidectomy" }),
    ],
    [first, second],
  );
  const where = Object.fromEntries(homes(after.rows).map((row) => [row.procedure, row.roomId]));
  assert.deepEqual(where, { "Lap appendectomy": "or-5", Herniorrhaphy: "or-5", "Lap chole": "or-2", Excision: "or-2", Thyroidectomy: "or-5" });
  assert.equal(after.matched, 2);
});

test("a department with two rooms lists all of its cases in both, in one order, each case counted once", () => {
  // Pong, 27 Nov 2026: "For day that dept has 2 rooms : display both booking and hosxp cases on both rooms". Monday 23
  // Nov 2026: GENSX holds OR 2 and OR 5; OR 3 is the SCOPE room, OR 8 the emergency room, OR 7 urology's only room.
  const MONDAY = "2026-11-23";
  const on = (workbook: WorkbookCase[] | null, bookings: AddedCase[]) =>
    buildBoardRows({ date: MONDAY, periods: DEFAULT_REPAIR_PERIODS, workbook, bookings, viewer: MX });
  const first = booking({ date: MONDAY, roomId: "or-5", hn: "1111111", surgeonId: "8", surgeon: "หมอ แปด", operation: "Lap chole", start: 600, end: 660 });
  const second = booking({ date: MONDAY, roomId: "or-2", hn: "2222222", surgeonId: "7", surgeon: "หมอ เจ็ด", operation: "Hernia", start: 540, end: 600 });
  const list = (rows: BoardRows["rows"], roomId: string) =>
    rows.filter((row) => row.roomId === roomId).sort((a, b) => a.order - b.order).map((row) => [row.order, row.procedure, row.shownFrom ? [row.shownFrom.roomId, row.shownFrom.order] : null]);

  // Before an upload: both bookings in both rooms, by their time, the copy saying the room the booking is in and its
  // place there.
  const before = on(null, [first, second]);
  assert.deepEqual(list(before.rows, "or-2"), [[1, "Hernia", null], [2, "Lap chole", ["or-5", 2]]]);
  assert.deepEqual(list(before.rows, "or-5"), [[1, "Hernia", ["or-2", 1]], [2, "Lap chole", null]]);
  assert.deepEqual([before.countByRoom["or-2"], before.countByRoom["or-5"]], [2, 2]);

  // After it: the booked cases by time, then HOSxP's others in file order, the same in both rooms. Not the endoscopy in
  // the SCOPE room, nor the emergency, nor another department's case.
  const after = on(
    [
      wb({ hn: "3333333", surgeon: "นพ. เก้า ศัลย์", operation: "Excision", position: 1 }),
      wb({ hn: "2222222", surgeon: "นพ. เจ็ด ศัลย์", operation: "Herniorrhaphy", position: 2 }),
      wb({ hn: "1111111", surgeon: "นพ. แปด ศัลย์", operation: "Lap chole", position: 3 }),
      wb({ hn: "4444444", surgeon: "นพ. สิบ ศัลย์", operation: "Thyroidectomy", position: 4 }),
      wb({ hn: "5555555", surgeon: "นพ. เก้า ศัลย์", operation: "Colonoscopy", position: 5 }),
      wb({ hn: "6666666", surgeon: "นพ. สิบ ศัลย์", operation: "Appendectomy", urgency: "Emergency", position: 6 }),
      wb({ hn: "7777777", surgeon: "นพ. ยูโร", operation: "TURP", dept: "URO", position: 7 }),
    ],
    [first, second],
  );
  const pooled = ["Herniorrhaphy", "Lap chole", "Excision", "Thyroidectomy"];
  for (const roomId of ["or-2", "or-5"]) {
    assert.deepEqual(list(after.rows, roomId).map(([order, name]) => [order, name]), pooled.map((name, index) => [index + 1, name]), roomId);
    assert.equal(after.countByRoom[roomId], 4, roomId);
    assert.equal(after.mismatchByRoom[roomId], 2, `${roomId}: the two nobody booked`);
  }
  // Each case is in one room and copied to the other.
  const homes = after.rows.filter((row) => !row.shownFrom && pooled.includes(row.procedure));
  assert.equal(homes.length, 4);
  for (const row of after.rows.filter((item) => item.shownFrom)) {
    assert.notEqual(row.shownFrom?.roomId, row.roomId);
    assert.ok(
      homes.some((home) => home.id === row.id && home.roomId === row.shownFrom?.roomId && home.order === row.shownFrom?.order),
      `${row.procedure}: copied from its own room, with its place there`,
    );
  }
  // Each case counted once in the totals.
  assert.equal(after.mismatchCount, after.rows.filter((row) => row.flag && !row.shownFrom).length);
  assert.equal(after.rows.filter((row) => row.shownFrom && !["or-2", "or-5"].includes(row.roomId)).length, 0, "no copies elsewhere");
  for (const name of ["Colonoscopy", "Appendectomy", "TURP"]) {
    const rows = after.rows.filter((row) => row.procedure === name);
    assert.equal(rows.length, 1, `${name}: once, in its own room (${rows.map((row) => row.roomId).join(", ")})`);
  }
});

test("booked cases go by their time, untimed bookings after in booking order, then the cases nobody booked; each row says its time", () => {
  const late = booking({ start: 660, end: 720, hn: "5550001", operation: "Late" });
  const untimed = booking({ hn: "5550002", operation: "Untimed" });
  const early = booking({ start: 540, end: 600, hn: "5550003", operation: "Early" });
  const middle = booking({ start: 600, end: 630, hn: "5550004", operation: "Middle" });
  // HOSxP's list in its own order, the case nobody booked first: the booked times still lead.
  const workbook = [
    wb({ hn: "5550009", operation: "Nobody's", position: 1 }),
    ...[late, untimed, early, middle].map((item, index) => wb({ hn: item.hn ?? "", operation: item.operation, position: index + 2 })),
  ];
  for (const uploaded of [false, true]) {
    const rows = build(uploaded ? workbook : null, [late, untimed, early, middle]).rows.filter((row) => row.roomId === "or-12");
    assert.deepEqual(
      rows.map((row) => [row.procedure, row.order, row.time ?? null]),
      [
        ["Early", 1, "09:00–10:00"],
        ["Middle", 2, "10:00–10:30"],
        ["Late", 3, "11:00–12:00"],
        ["Untimed", 4, null],
        ...(uploaded ? [["Nobody's", 5, null]] : []),
      ],
      uploaded ? "uploaded" : "before the upload",
    );
  }
  // Everyone sees the time, not only the doctor and MX.
  assert.equal(build(null, [early], NOBODY).rows[0].time, "09:00–10:00");
});

// Pong, 27 Nov 2026: "Add booking btn on ท่าฉลอม also". Before an upload with its cases, its rows are its bookings.
const thaChalomRows = (date: string, bookings: AddedCase[], viewer: BoardViewer) => buildThaChalomRows({ date, workbook: null, bookings, viewer }).rows;

test("รพ.ท่าฉลอม's rows before its HOSxP list: its bookings in the rooms they were booked in, by time, numbered in each room", () => {
  const late = booking({ roomId: "or-1", start: 600, end: 660, place: "tha-chalom", surgeonId: "7", note: "ขอ C-arm" });
  const early = booking({ roomId: "or-1", start: 540, end: 600, place: "tha-chalom", surgeonId: "8", surgeon: "สมหญิง ดีใจ" });
  const untimed = booking({ roomId: "or-1", place: "tha-chalom", surgeonId: "8" });
  const scope = booking({ roomId: "scope", start: 510, end: 540, place: "tha-chalom", subtype: "PLASTIC", surgeonId: "8" });
  const other = booking({ date: "2026-11-18", roomId: "or-1", place: "tha-chalom" });
  const rows = thaChalomRows(DAY, [late, untimed, early, scope, other], { allHn: false, userId: "7" });
  assert.deepEqual(
    rows.map((row) => [row.id, row.roomId, row.order, row.time ?? null]),
    [
      [`bk-${scope.id}`, "scope", 1, "08:30–09:00"],
      [`bk-${early.id}`, "or-1", 1, "09:00–10:00"],
      [`bk-${late.id}`, "or-1", 2, "10:00–11:00"],
      [`bk-${untimed.id}`, "or-1", 3, null],
    ],
  );
  assert.ok(rows.every((row) => row.source === "booking" && row.flag === null && row.status === "scheduled" && row.place === "tha-chalom"));
  // the viewer's own booking: its HN and its id for the row's actions; another doctor's neither
  const mine = rows.find((row) => row.id === `bk-${late.id}`);
  assert.deepEqual([mine?.hn, mine?.bookingId, mine?.note], [late.hn, late.id, "ขอ C-arm"]);
  const theirs = rows.find((row) => row.id === `bk-${early.id}`);
  assert.ok(theirs && !("hn" in theirs) && !("bookingId" in theirs) && theirs.bookedBy === "สมหญิง ดีใจ");
  assert.ok(thaChalomRows(DAY, [early], MX).every((row) => row.hn === early.hn), "MX and admins see every HN");
});

// Pong, 27 Nov 2026: "Excel file include both place on one sheet", then "Leave off board and display on noti bar for
// both places". Tuesday 17 Nov 2026 at รพ.ท่าฉลอม: OR 1 general surgery, OR 2 vascular, OR 4 ENT, the Scope room plastic.
test("รพ.ท่าฉลอม's rows: its HOSxP cases matched with its bookings by HN, in its departments' rooms, as รพ.สมุทรสาคร's", () => {
  const matched = wb({ hn: "0012345", operation: "Herniorrhaphy", dept: "GENSX", status: "in-progress" });
  const vascular = wb({ dept: "VASCULAR", operation: "EVLA" });
  const ortho = wb({ dept: "ORTHO", operation: "TKA" });
  const unknown = wb({ dept: null });
  const dressing = wb({ dept: "PLASTIC", operation: "Wound dressing" });
  const booked = booking({ hn: "12345", roomId: "or-1", place: "tha-chalom", surgeonId: "7" });
  const gone = booking({ hn: "999", roomId: "or-4", subtype: "ENT", place: "tha-chalom", surgeonId: "8" });
  const result = buildThaChalomRows({ date: DAY, workbook: [matched, vascular, ortho, unknown, dressing], bookings: [booked, gone], viewer: MX });
  assert.equal(result.uploaded, true);
  assert.deepEqual(
    result.rows.map((row) => [row.id, row.roomId, row.source, row.flag, row.procedure, row.place]),
    [
      [`mt-${booked.id}`, "or-1", "matched", null, "Herniorrhaphy", "tha-chalom"],
      [`hx-${vascular.caseId}`, "or-2", "hosxp", "unbooked", "EVLA", "tha-chalom"],
      // No dressing room there: a dressing goes by its department, flagged like any case nobody booked.
      [`hx-${dressing.caseId}`, "scope", "hosxp", "unbooked", "Wound dressing", "tha-chalom"],
    ],
  );
  assert.ok(result.rows.every((row) => !("doneBy" in row)));
  // The booking HOSxP does not list leaves the board for MX's summary.
  assert.deepEqual(
    result.unmatched.map((row) => [row.id, row.roomId, row.flag, row.place]),
    [[`bk-${gone.id}`, "or-4", "not-in-hosxp", "tha-chalom"]],
  );
  assert.equal(result.matched, 1);
  assert.deepEqual(result.mismatchByRoom, { "or-2": 1, scope: 1 });
  // No ORTHO room on a Tuesday, and no department for one: off the board, counted for the strip's notice.
  assert.deepEqual(result.offBoard, [
    { dept: "ORTHO", count: 1 },
    { dept: null, count: 1 },
  ]);
  // HN only to who may see it.
  const nurse = buildThaChalomRows({ date: DAY, workbook: [matched, vascular], bookings: [booked], viewer: NOBODY });
  assert.ok(nurse.rows.every((row) => !("hn" in row)));
  // The doctor's under-way check reads the same board.
  const input = { date: DAY, periods: REPAIR, workbook: [matched], bookings: [booked] };
  assert.equal(bookingUnderWay(input, booked.id, "7", "tha-chalom"), true);
});

test("a HOSxP case whose department has no room that day is left off the board and counted (Pong, 27 Nov 2026)", () => {
  // The weekly schedule on Tuesday 23 Mar 2027: vascular surgery has no room. In place of borrowing the emptiest room.
  const TUESDAY = "2027-03-23";
  const P = DEFAULT_REPAIR_PERIODS;
  const a = wb({ dept: "VASCULAR", operation: "EVLA" });
  const b = wb({ dept: "VASCULAR", operation: "AVF" });
  const c = wb({ dept: null });
  const d = wb({ dept: "GENSX", operation: "Lap chole" });
  const result = buildBoardRows({ date: TUESDAY, periods: P, workbook: [c, a, b, d], bookings: [], viewer: MX });
  assert.deepEqual(result.rows.map((row) => row.id), [`hx-${d.caseId}`]);
  // The department with the most cases first.
  assert.deepEqual(result.offBoard, [
    { dept: "VASCULAR", count: 2 },
    { dept: null, count: 1 },
  ]);
  // A booking saved in a room before still shows its case there.
  const saved = booking({ date: TUESDAY, hn: a.hn, roomId: "or-9", subtype: "VASCULAR" });
  const withBooking = buildBoardRows({ date: TUESDAY, periods: P, workbook: [a, b], bookings: [saved], viewer: MX });
  assert.deepEqual(withBooking.rows.map((row) => [row.id, row.roomId]), [[`mt-${saved.id}`, "or-9"]]);
  assert.deepEqual(withBooking.offBoard, [{ dept: "VASCULAR", count: 1 }]);
  // OB-GYN during the repair operates at อาคารแม่: off the board, but no notice.
  const obgyn = buildBoardRows({ date: DAY, periods: REPAIR, workbook: [wb({ dept: "OBGYN" })], bookings: [], viewer: MX });
  assert.deepEqual([obgyn.rows.length, obgyn.offBoard], [0, []]);
});
