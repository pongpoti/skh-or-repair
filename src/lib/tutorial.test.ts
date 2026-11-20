import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddedCase } from "./added-cases.ts";
import { DEFAULT_REPAIR_PERIODS } from "./repair.ts";
import { isDressingCase } from "./placement.ts";
import { AUTO_DRESSING_OPERATION, DRESSING_EXAMPLES, LONG_OPERATION, practiceRoom, practiceSubtype, TUTORIAL_ME, tutorialBoard } from "./tutorial.ts";

const REPAIR = DEFAULT_REPAIR_PERIODS;
const DAY = "2026-11-20"; // a Friday in the first half: OR 9 EMER, 10 D/S, 11 mixed, 12 GENSX, 13 ORTHO
const DOCTOR = { name: "ทดลอง ใช้งาน", subtype: "GENSX" };
const TODAY = "2026-11-19"; // the Thursday before: the made-up doctors booked on Wednesday

const mine = (more: Partial<AddedCase> = {}): AddedCase => ({
  id: TUTORIAL_ME,
  date: DAY,
  roomId: "or-12",
  hn: "1234567",
  operation: "Lap chole",
  shift: "in",
  dressing: false,
  scrubDoes: null,
  note: "",
  surgeonId: TUTORIAL_ME,
  surgeon: DOCTOR.name,
  subtype: "GENSX",
  bookedAt: "2026-11-19T10:30:00.000Z",
  ...more,
});

const rowsIn = (board: ReturnType<typeof tutorialBoard>, roomId: string) =>
  board.rows.filter((row) => row.roomId === roomId).sort((a, b) => a.order - b.order);

test("the practice room is the doctor's department's room; obstetrics practises in general surgery's", () => {
  assert.equal(practiceSubtype("GENSX", DAY, REPAIR), "GENSX");
  assert.equal(practiceRoom("GENSX", DAY, REPAIR), "or-12");
  assert.equal(practiceRoom("URO", DAY, REPAIR), "or-11", "no URO room: the mixed room");
  assert.equal(practiceSubtype("OBGYN", DAY, REPAIR), "GENSX", "obstetrics operates in its own building during the repair");
  assert.equal(practiceSubtype(null, DAY, REPAIR), "GENSX");
});

test("before the upload: the bookings alone, calendar icons, the doctor's own HN only", () => {
  const board = tutorialBoard({ date: DAY, today: TODAY, periods: REPAIR, doctor: DOCTOR, mine: mine(), phase: "before" });
  assert.equal(board.uploaded, false);
  const room = rowsIn(board, "or-12");
  assert.deepEqual(
    room.map((row) => [row.order, row.source, row.procedure, row.hn ?? null]),
    [
      [1, "booking", LONG_OPERATION, null],
      [2, "booking", "Lap chole", "1234567"],
    ],
  );
  assert.equal(room[0].note, "เตรียมเลือด 2 unit\nขอ ultrasound", "the colleague's note for the team");
  assert.deepEqual(rowsIn(board, "or-13").map((row) => row.source), ["booking"], "the booking HOSxP will not list");
  assert.deepEqual(rowsIn(board, "or-10").map((row) => row.doneBy), ["scrub"], "the dressing for the scrub nurse");
  assert.equal(board.mismatchCount, 0);
});

test("after the upload: handshakes, HOSxP's unbooked case with its mark, the dressing room's portraits", () => {
  const board = tutorialBoard({ date: DAY, today: TODAY, periods: REPAIR, doctor: DOCTOR, mine: mine({ note: "ขอ C-arm" }), phase: "after" });
  assert.equal(board.uploaded, true);
  const room = rowsIn(board, "or-12");
  assert.deepEqual(
    room.map((row) => [row.order, row.source, row.procedure, row.hn ?? null, row.patientName ?? null, row.shift]),
    [
      [1, "matched", LONG_OPERATION, null, null, "in"],
      [2, "matched", "Lap chole", "1234567", "ตัวอย่าง ผู้ป่วย", "in"],
      [3, "hosxp", "Excision of lipoma, back", null, null, "in"],
    ],
  );
  assert.equal(room[1].note, "ขอ C-arm");
  assert.equal(room[2].flag, "unbooked");
  assert.deepEqual(board.mismatchByRoom, { "or-12": 1 }, "the room's ! mark");
  assert.deepEqual(rowsIn(board, "or-13"), [], "the booking HOSxP does not list is gone");
  assert.deepEqual(rowsIn(board, "or-10").map((row) => row.doneBy), ["scrub", "surgeon"]);
});

test("the dressing room by name: HOSxP's general surgery case nobody booked goes there by itself, and the card's examples", () => {
  // Pong, 20 Nov 2026: "show how app automatically assign some cases to dressing room"
  for (const subtype of ["GENSX", "ORTHO", "URO"]) {
    const board = tutorialBoard({ date: DAY, today: TODAY, periods: REPAIR, doctor: { ...DOCTOR, subtype }, mine: null, phase: "after" });
    const auto = board.rows.filter((row) => row.procedure === AUTO_DRESSING_OPERATION);
    assert.equal(auto.length, 1, subtype);
    assert.deepEqual([auto[0].roomId, auto[0].source, auto[0].flag ?? null, auto[0].doneBy], ["or-10", "hosxp", null, "surgeon"], `${subtype}: in the dressing room, not general surgery's OR 12, with no mark`);
    assert.equal(board.mismatchByRoom["or-10"] ?? 0, 0, `${subtype}: no "!" on the dressing room`);
  }
  // the card asks the rule; what it teaches: three dressings, and a graft stays in its department's room
  assert.deepEqual(
    DRESSING_EXAMPLES.map((name) => [name, isDressingCase(name)]),
    [
      ["I&D abscess", true],
      ["Debridement", true],
      ["D/S + VAC", true],
      ["STSG", false],
    ],
  );
  assert.ok(isDressingCase(AUTO_DRESSING_OPERATION), "the I&D the bubble names");
});

test("an orthopaedic surgeon's day: the case HOSxP drops is general surgery's, and the made-up HNs avoid the doctor's", () => {
  const doctor = { name: DOCTOR.name, subtype: "ORTHO" };
  const own = mine({ roomId: "or-13", subtype: "ORTHO", hn: "9900101" });
  const before = tutorialBoard({ date: DAY, today: TODAY, periods: REPAIR, doctor, mine: own, phase: "before" });
  assert.deepEqual(rowsIn(before, "or-12").map((row) => row.procedure), ["Herniorrhaphy, right inguinal"]);
  const after = tutorialBoard({ date: DAY, today: TODAY, periods: REPAIR, doctor, mine: own, phase: "after" });
  const room = rowsIn(after, "or-13");
  assert.deepEqual(room.map((row) => row.source), ["matched", "matched", "hosxp"]);
  assert.equal(room.filter((row) => row.hn === "9900101").length, 1, "only the doctor's own case has their HN");
});

test("the made-up doctors booked before the doctor's practice booking: the times agree with the order", async () => {
  const { tutorialCases } = await import("./tutorial.ts");
  const own = mine({ bookedAt: "2026-11-19T03:00:00.000Z" }); // 10:00 Bangkok, the morning the tutorial runs
  const { bookings } = tutorialCases({ date: DAY, today: TODAY, periods: REPAIR, doctor: DOCTOR, mine: own });
  const made = bookings.filter((item) => item.id !== TUTORIAL_ME);
  assert.equal(made.length, 3);
  for (const item of made) assert.ok(item.bookedAt && item.bookedAt < own.bookedAt!, `${item.id} booked before the doctor: ${item.bookedAt}`);
  const board = tutorialBoard({ date: DAY, today: TODAY, periods: REPAIR, doctor: DOCTOR, mine: own, phase: "before" });
  assert.deepEqual(rowsIn(board, "or-12").map((row) => row.bookedAt), ["18 พ.ย. 69, 11:41", rowsIn(board, "or-12")[1].bookedAt]);
});
