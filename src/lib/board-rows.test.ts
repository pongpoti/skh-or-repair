import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_OPERATION_LABEL, type AddedCase } from "./added-cases.ts";
import { buildBoardRows, missingUploadDay, withoutTitle, type BoardViewer, type WorkbookCase } from "./board-rows.ts";
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
