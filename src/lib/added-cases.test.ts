import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays,
  bookedChoice,
  bookedMessage,
  bookedRoom,
  bookingRoom,
  checkCase,
  cleanOperation,
  closedDayNote,
  earliestBookingDay,
  earliestText,
  MAX_OPERATION,
  NO_OPERATION_LABEL,
  NO_ROOM_NOTE,
  withAddedCases,
  type AddedCase,
  type BookingContext,
} from "./added-cases.ts";
import { DEFAULT_REPAIR_PERIODS } from "./repair.ts";
import type { DayBoard } from "./week.ts";

const REPAIR = DEFAULT_REPAIR_PERIODS;
// Friday 13 November 2026 at 10:00, the day before the ventilation repair's first half (14 Nov 2026 to 26 Jan 2027).
const TODAY = "2026-11-13";
const at = (hh: number, mm = 0) => hh * 60 + mm;
const CONTEXT: BookingContext = { today: TODAY, earliest: "2026-11-16", periods: REPAIR, subtype: "GENSX", holidays: [] };
const ok = { date: "2026-11-16", hn: "0012345", operation: "Lap chole", shift: "in" };
const check = (input: unknown, context: Partial<BookingContext> = {}) => checkCase(input, { ...CONTEXT, ...context });
// Mon 7 Dec 2026 (the day after วันพ่อแห่งชาติ, a Sunday) and Thu 10 Dec 2026 (วันรัฐธรรมนูญ).
const DECEMBER = [
  { date: "2026-12-07", name: "ชดเชยวันพ่อแห่งชาติ" },
  { date: "2026-12-10", name: "วันรัฐธรรมนูญ" },
];

test("the earliest day: the next workday before 15:00, the one after from 15:00 (Pong, 15 Nov 2026)", () => {
  assert.equal(earliestBookingDay("2026-11-16", at(9)), "2026-11-17", "Monday morning: Tuesday");
  assert.equal(earliestBookingDay("2026-11-16", at(14, 59)), "2026-11-17", "Monday 14:59: still Tuesday");
  assert.equal(earliestBookingDay("2026-11-16", at(15)), "2026-11-18", "Monday 15:00: Wednesday");
  assert.equal(earliestBookingDay("2026-11-16", at(23, 59)), "2026-11-18");
  assert.equal(earliestBookingDay("2026-11-20", at(14)), "2026-11-23", "Friday 14:00: Monday");
  assert.equal(earliestBookingDay("2026-11-20", at(15, 30)), "2026-11-24", "Friday 15:30: Tuesday");
  assert.equal(earliestBookingDay("2026-11-21", at(10)), "2026-11-23", "Saturday morning: Monday");
  assert.equal(earliestBookingDay("2026-11-21", at(16)), "2026-11-24", "Saturday after 15:00: Tuesday, as MX uploads Monday's list then");
  // holidays are stepped over
  assert.equal(earliestBookingDay("2026-12-04", at(14), DECEMBER), "2026-12-08", "Friday 4 Dec: past the weekend and Monday's holiday");
  assert.equal(earliestBookingDay("2026-12-04", at(15), DECEMBER), "2026-12-09");
  assert.equal(earliestBookingDay("2026-12-09", at(15, 30), DECEMBER), "2026-12-14", "Wednesday 9 Dec 15:30: Friday is the next workday, so Monday");
  // with no workday in two weeks by the holidays (a broken list), the weekdays still give a day
  const everyDay = Array.from({ length: 20 }, (_, i) => ({ date: addDays("2026-11-16", i), name: "x" }));
  assert.equal(earliestBookingDay("2026-11-16", at(9), everyDay), "2026-11-17");
});

test("what the form says about the earliest day", () => {
  assert.equal(earliestText("2026-11-16", "2026-11-17", []), "จองได้ตั้งแต่ วันอังคารที่ 17 พ.ย. 2569");
  assert.equal(earliestText("2026-11-16", "2026-11-18", []), "หลัง 15:00 น. ปิดรับจองวันทำการถัดไป · จองได้ตั้งแต่ วันพุธที่ 18 พ.ย. 2569");
  assert.equal(earliestText("2026-12-04", "2026-12-08", DECEMBER), "จองได้ตั้งแต่ วันอังคารที่ 8 ธ.ค. 2569", "a holiday is not the cut-off");
});

test("the calendar closes weekends and holidays, with why", () => {
  assert.equal(closedDayNote("2026-11-21", []), "วันเสาร์-อาทิตย์");
  assert.equal(closedDayNote("2026-11-22", []), "วันเสาร์-อาทิตย์");
  assert.equal(closedDayNote("2026-12-10", DECEMBER), "วันรัฐธรรมนูญ");
  assert.equal(closedDayNote("2026-12-11", DECEMBER), null);
});

test("OR X: the department's room that day, by the workbook's rules, whatever the operation's name", () => {
  const room = (subtype: string | null, operation: string, date: string) => bookingRoom(subtype, operation, date, REPAIR, "dept");
  const FIRST = "2026-11-16"; // the repair's first half: OR 9 EMER, 10 D/S, 11 mixed, 12 GENSX, 13 ORTHO
  const SECOND = "2027-01-27"; // the second half: OR 1 D/S, 2 ORTHO, 3 EMER, 4 mixed, 5 GENSX
  assert.deepEqual(room("GENSX", "Lap chole", FIRST), { ok: true, roomId: "or-12", dressing: false });
  assert.deepEqual(room("ORTHO", "ORIF radius", FIRST), { ok: true, roomId: "or-13", dressing: false });
  for (const subtype of ["URO", "NEURO", "CVT", "ENT"]) assert.deepEqual(room(subtype, "x", FIRST), { ok: true, roomId: "or-11", dressing: false }, `${subtype}: the mixed room`);
  assert.deepEqual(room("GENSX", "EGD", FIRST), { ok: true, roomId: "or-11", dressing: false }, "an endoscopy shares the mixed room during the repair");
  assert.deepEqual(room("GENSX", "Lap chole", SECOND), { ok: true, roomId: "or-5", dressing: false });
  assert.deepEqual(room("EYE", "Phaco", SECOND), { ok: true, roomId: "or-4", dressing: false });
  assert.deepEqual(room("URO", "TURP", "2026-11-11"), { ok: true, roomId: "or-7", dressing: false }, "before the repair, the weekly schedule's room");
  // an empty name still shows the department's room in the form
  assert.deepEqual(room("ORTHO", "", FIRST), { ok: true, roomId: "or-13", dressing: false });
  // the surgeon decides (Pong, 15 Nov 2026): a name that reads like a dressing stays in the department's room
  for (const name of ["D/S + VAC", "Debridement", "I&D abscess", "Wound dressing"]) {
    assert.deepEqual(room("ORTHO", name, FIRST), { ok: true, roomId: "or-13", dressing: false }, name);
  }
});

test("ห้องทำแผล: the dressing room that day, whatever the department or the name", () => {
  const room = (subtype: string | null, operation: string, date: string) => bookingRoom(subtype, operation, date, REPAIR, "dressing");
  assert.deepEqual(room("GENSX", "D/S + VAC", "2026-11-16"), { ok: true, roomId: "or-10", dressing: true });
  assert.deepEqual(room("ORTHO", "ORIF radius", "2026-11-16"), { ok: true, roomId: "or-10", dressing: true }, "the name does not gate it");
  assert.deepEqual(room("URO", "", "2026-11-16"), { ok: true, roomId: "or-10", dressing: true });
  assert.deepEqual(room("GENSX", "D/S", "2027-01-27"), { ok: true, roomId: "or-1", dressing: true }, "the second half");
  assert.deepEqual(room("GENSX", "dressing", "2026-11-11"), { ok: true, roomId: "or-1", dressing: true }, "before the repair, OR 1");
  assert.deepEqual(room(null, "Dressing", "2026-11-16"), { ok: true, roomId: "or-10", dressing: true }, "no department needed");
  assert.deepEqual(room("GENSX", "D/S", "2026-11-21"), { ok: false, reason: "no-dressing-room", error: "ไม่มีห้องทำแผลในวันที่เลือก เลือกวันอื่น" }, "a Saturday");
});

test("no room: obstetrics-gynaecology during the repair, an unknown department, a day without the department's room", () => {
  const refused = (subtype: string | null, operation: string, date: string) => {
    const room = bookingRoom(subtype, operation, date, REPAIR, "dept");
    return room.ok ? room.roomId : room.error;
  };
  assert.equal(refused("OBGYN", "TAH", "2026-11-16"), "ช่วงปิดซ่อม สูติ-นรีเวชกรรมผ่าตัดที่อาคารแม่ จองห้องที่นี่ไม่ได้");
  const obgynDressing = bookingRoom("OBGYN", "Dressing", "2026-11-16", REPAIR, "dressing");
  assert.deepEqual(
    obgynDressing,
    { ok: false, reason: "obgyn-building", error: "ช่วงปิดซ่อม สูติ-นรีเวชกรรมผ่าตัดที่อาคารแม่ จองห้องที่นี่ไม่ได้" },
    "the dressing room too",
  );
  // The card the doctor cannot pick says the reason in short: only a missing room is about the day.
  assert.deepEqual(NO_ROOM_NOTE, {
    "obgyn-building": "ผ่าตัดที่อาคารแม่",
    "no-department": "ไม่ทราบสาขา",
    "no-room": "ไม่มีในวันที่เลือก",
    "no-dressing-room": "ไม่มีในวันที่เลือก",
  });
  assert.equal(refused("OBGYN", "TAH", "2027-03-18"), "or-6", "after the repair, its own room again");
  assert.equal(refused(null, "Lap chole", "2026-11-16"), "ยังไม่ทราบสาขาของคุณ จึงจัดห้องให้ไม่ได้ ติดต่อผู้ดูแลระบบ");
  assert.equal(refused("", "Lap chole", "2026-11-16"), "ยังไม่ทราบสาขาของคุณ จึงจัดห้องให้ไม่ได้ ติดต่อผู้ดูแลระบบ");
  assert.equal(refused("ANES", "Lap chole", "2026-11-16"), "or-11", "a subtype the suite has no department for: the mixed room");
  assert.equal(refused("GENSX", "Lap chole", "2026-11-21"), "สาขาของคุณไม่มีห้องผ่าตัดในวันที่เลือก เลือกวันอื่น", "a Saturday");
});

test("a good booking passes, cleaned, in the room of the doctor's choice; a room the form sends is ignored", () => {
  const checked = check({ ...ok, operation: "  Lap \u200bchole\n  ", roomId: "or-2" });
  assert.deepEqual(checked, {
    ok: true,
    value: { date: "2026-11-16", roomId: "or-12", hn: "12345", operation: "Lap chole", shift: "in", dressing: false, scrubDoes: null },
  });
  assert.equal(cleanOperation("a\t b"), "a b");
  // the department's room unless the doctor picks the dressing room, whatever the name
  const named = check({ ...ok, operation: "Wound D/S" });
  assert.ok(named.ok);
  assert.deepEqual([named.value.roomId, named.value.dressing, named.value.scrubDoes], ["or-12", false, null]);
  const explicit = check({ ...ok, room: "dept", scrubDoes: true });
  assert.ok(explicit.ok);
  assert.deepEqual([explicit.value.roomId, explicit.value.scrubDoes], ["or-12", null], "no scrub answer for the department's room");
  // the dressing room, with the scrub answer either way
  for (const scrubDoes of [true, false]) {
    const dressing = check({ ...ok, operation: "ORIF radius", room: "dressing", scrubDoes });
    assert.ok(dressing.ok);
    assert.deepEqual([dressing.value.roomId, dressing.value.dressing, dressing.value.scrubDoes], ["or-10", true, scrubDoes]);
  }
});

test("the room choice is checked: only OR X or ห้องทำแผล, and ห้องทำแผล needs the scrub answer", () => {
  const error = (input: Record<string, unknown>) => {
    const checked = check({ ...ok, ...input });
    return checked.ok ? "ok" : [checked.field, checked.error];
  };
  for (const room of ["or-10", "DRESSING", 1, true, null]) assert.deepEqual(error({ room }), room === null ? "ok" : ["room", "เลือกห้องผ่าตัด"], String(room));
  for (const scrubDoes of [undefined, null, "yes", 1]) {
    assert.deepEqual(error({ room: "dressing", scrubDoes }), ["room", "ห้องทำแผล: ตอบก่อนว่า scrub ทำให้แทนไหม ?"], String(scrubDoes));
  }
  // a day without the room: another day may have one
  assert.deepEqual(
    check({ ...ok, room: "dept" }, { subtype: "OBGYN" }),
    { ok: false, field: undefined, error: "ช่วงปิดซ่อม สูติ-นรีเวชกรรมผ่าตัดที่อาคารแม่ จองห้องที่นี่ไม่ได้" },
  );
  assert.deepEqual(error({ room: "dressing", scrubDoes: true, operation: "x" }), "ok", "no department needed for the dressing room");
  assert.equal(check({ ...ok, room: "dept" }, { subtype: null }).ok, false, "but needed for OR X");
});

test("a saved booking: the doctor's choice, or for one saved before the form asked, the room it was saved in", () => {
  const saved = (more: Partial<AddedCase>): AddedCase => ({
    id: "1",
    date: "2026-11-16",
    roomId: "or-12",
    hn: "12345",
    operation: "Wound dressing",
    shift: "in",
    dressing: null,
    scrubDoes: null,
    surgeonId: "7",
    surgeon: "x",
    subtype: "GENSX",
    ...more,
  });
  assert.equal(bookedChoice(saved({}), REPAIR), "dept", "saved in GENSX's room: OR X, whatever the name");
  assert.equal(bookedChoice(saved({ roomId: "or-10" }), REPAIR), "dressing", "saved in the dressing room");
  assert.equal(bookedChoice(saved({ roomId: "or-12", dressing: true, scrubDoes: true }), REPAIR), "dressing");
  assert.equal(bookedChoice(saved({ roomId: "or-10", dressing: false }), REPAIR), "dept");
  // saved before the form asked, then an admin moved the halves: a dressing room closed on its day now still counts,
  // and the booking goes to that day's dressing room
  const moved = { half1: { from: "2026-11-14", to: "2026-11-13" }, half2: { from: "2026-11-16", to: "2027-03-17" } };
  assert.equal(bookedChoice(saved({ roomId: "or-10" }), moved), "dressing", "OR 10 is closed in the second half");
  assert.deepEqual(bookedRoom(saved({ roomId: "or-10" }), moved), { roomId: "or-1", dressing: true });
  assert.equal(bookedChoice(saved({ roomId: "or-12" }), moved), "dept", "a closed room that is no dressing room");
  // the room is worked out again: the dressing room of the second half, the department's room after a change
  assert.deepEqual(bookedRoom(saved({ date: "2027-01-27", roomId: "or-10", dressing: true, scrubDoes: false }), REPAIR), { roomId: "or-1", dressing: true });
  assert.deepEqual(bookedRoom(saved({ date: "2027-01-27", dressing: false }), REPAIR), { roomId: "or-5", dressing: false });
  // no room can be worked out (no department): the saved one
  assert.deepEqual(bookedRoom(saved({ subtype: null, roomId: "or-12", dressing: false }), REPAIR), { roomId: "or-12", dressing: false });
});

test("the saved booking's message is simply the room and the day, for the dressing room too", () => {
  assert.equal(bookedMessage({ roomId: "or-12", date: "2026-11-17" }), "จอง OR 12 วันอังคารที่ 17 พ.ย. 2569 แล้ว");
  assert.equal(bookedMessage({ roomId: "or-10", date: "2026-11-17" }), "จอง OR 10 วันอังคารที่ 17 พ.ย. 2569 แล้ว");
});

test("dates: from the earliest day up to 60 days ahead, weekdays only, not a holiday", () => {
  const error = (date: unknown, context: Partial<BookingContext> = {}) => {
    const checked = check({ ...ok, date }, context);
    return checked.ok ? "ok" : checked;
  };
  assert.deepEqual(error("2026-11-13"), {
    ok: false,
    field: "date",
    error: "จองได้ตั้งแต่ วันจันทร์ที่ 16 พ.ย. 2569",
    earliest: "2026-11-16",
  }, "today");
  // Friday after 15:00: Monday has closed, and the answer carries the new first day for the form's calendar
  assert.deepEqual(error("2026-11-16", { earliest: earliestBookingDay(TODAY, at(15, 30)) }), {
    ok: false,
    field: "date",
    error: "หลัง 15:00 น. ปิดรับจองวันทำการถัดไป · จองได้ตั้งแต่ วันอังคารที่ 17 พ.ย. 2569",
    earliest: "2026-11-17",
  });
  assert.equal(error("2026-11-17", { earliest: "2026-11-17" }), "ok");
  for (const date of [undefined, "", "2026-11-16x", "2026-02-30", 20261116]) {
    assert.deepEqual(error(date), { ok: false, field: "date", error: "เลือกวันที่ผ่าตัด" }, JSON.stringify(date));
  }
  assert.equal(error(addDays(TODAY, 60)), "ok");
  assert.match((error(addDays(TODAY, 61)) as { error: string }).error, /ไม่เกิน 60 วัน/);
  assert.match((error("2026-11-21") as { error: string }).error, /เสาร์และอาทิตย์/);
  const holiday = error("2026-12-10", { holidays: DECEMBER });
  assert.deepEqual(holiday, { ok: false, field: "date", error: "วันที่เลือกเป็นวันหยุด (วันรัฐธรรมนูญ) ไม่มีตารางผ่าตัด" });
});

test("the HN is required, 7 digits, stored normalised", () => {
  const error = (hn: unknown) => {
    const checked = check({ ...ok, hn });
    return checked.ok ? checked.value.hn : `${checked.field}: ${checked.error}`;
  };
  for (const hn of [undefined, null, "", "   ", 1234567]) assert.equal(error(hn), "hn: ใส่ HN ของผู้ป่วย", JSON.stringify(hn));
  for (const hn of ["123456", "12345678", "HN12345", "12/3456"]) assert.equal(error(hn), "hn: HN ต้องเป็นตัวเลข 7 หลัก", hn);
  assert.equal(error("0012345"), "12345");
  assert.equal(error("123-4567"), "1234567");
  assert.equal(error("๑๒๓๔๕๖๗"), "1234567", "Thai digits");
});

test("the operation's name is required (Pong, 15 Nov 2026) and at most 300 characters", () => {
  for (const operation of [undefined, null, "", "   ", "\u200b"]) {
    const checked = check({ ...ok, operation });
    assert.deepEqual(checked, { ok: false, field: "operation", error: "ใส่ชื่อการผ่าตัด" }, JSON.stringify(operation));
  }
  assert.deepEqual(check({ ...ok, operation: 5 }), { ok: false, field: "operation", error: "ชื่อการผ่าตัดไม่ถูกต้อง" });
  assert.equal(check({ ...ok, operation: "x".repeat(MAX_OPERATION) }).ok, true);
  assert.equal(check({ ...ok, operation: "x".repeat(MAX_OPERATION + 1) }).ok, false);
});

test("the shift defaults to in hours and must be in or out; nothing at all is refused", () => {
  const checked = check({ date: ok.date, hn: ok.hn, operation: ok.operation });
  assert.ok(checked.ok);
  assert.equal(checked.value.shift, "in");
  assert.deepEqual(check({ ...ok, shift: "night" }), { ok: false, field: "shift", error: "เลือกในเวลาหรือนอกเวลา" });
  assert.equal(check(null).ok, false);
});

test("a department without a room that day is said, about no field the doctor can fix, or about the day", () => {
  assert.deepEqual(check(ok, { subtype: null }), { ok: false, field: undefined, error: "ยังไม่ทราบสาขาของคุณ จึงจัดห้องให้ไม่ได้ ติดต่อผู้ดูแลระบบ" });
  assert.deepEqual(check(ok, { subtype: "OBGYN" }), { ok: false, field: undefined, error: "ช่วงปิดซ่อม สูติ-นรีเวชกรรมผ่าตัดที่อาคารแม่ จองห้องที่นี่ไม่ได้" });
});

test("added cases join the board after its own, numbered per room", () => {
  const board: DayBoard = {
    key: "fri",
    name: "Friday",
    date: TODAY,
    operations: [
      { id: "a", roomId: "or-2", order: 1, procedure: "EGD", surgeon: "x", specialty: null, status: "scheduled", shift: "in" },
    ],
  };
  const base = { operation: "Op", shift: "in" as const, dressing: null, scrubDoes: null, hn: "1", surgeonId: "7", surgeon: "สมชาย ใจดี", subtype: "ORTHO" };
  const added: AddedCase[] = [
    { ...base, id: "1", date: TODAY, roomId: "or-2" },
    { ...base, id: "2", date: TODAY, roomId: "or-3", shift: "out" },
    { ...base, id: "3", date: "2026-11-05", roomId: "or-2" }, // another day
    { ...base, id: "4", date: TODAY, roomId: "or-9" },
    { ...base, id: "5", date: TODAY, roomId: "or-2", operation: "" }, // a booking without a name yet
  ];
  const ops = withAddedCases(board, added, REPAIR).operations;
  assert.deepEqual(
    ops.map((item) => [item.id, item.roomId, item.order, item.shift]),
    [
      ["a", "or-2", 1, "in"],
      ["case-1", "or-2", 2, "in"],
      ["case-2", "or-3", 1, "out"],
      ["case-4", "or-9", 1, "in"],
      ["case-5", "or-2", 3, "in"],
    ],
  );
  assert.equal(ops[1].specialty, "ออร์โธปิดิกส์");
  assert.equal(ops[1].surgeon, "สมชาย ใจดี");
  assert.equal(ops[4].procedure, NO_OPERATION_LABEL);
  assert.equal(board.operations.length, 1, "the board itself is not changed");
  assert.ok(ops.every((item) => !("hn" in item)), "no HN on the board's operations");
});
