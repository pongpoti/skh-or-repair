import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays,
  bookedAlready,
  bookedAtText,
  bookedChoice,
  bookedMessage,
  bookedRoom,
  bookingChange,
  bookingRoom,
  bookingState,
  checkCase,
  cleanNote,
  cleanOperation,
  closedDayNote,
  deptRooms,
  earliestBookingDay,
  earliestText,
  editClosesOn,
  editedMessage,
  editRequeues,
  bookableFrom,
  BOOKING_CUTOFF_RULE,
  MAX_NOTE,
  MAX_OPERATION,
  NO_OPERATION_LABEL,
  NO_ROOM_NOTE,
  NOTE_ONLY_TEXT,
  placeBookingRoom,
  roomToBook,
  placeRoomName,
  POOLED_ROOM_NOTE,
  byTime,
  daySlots,
  roomAmong,
  timeClash,
  timeOf,
  withAddedCases,
  type AddedCase,
  type BookingContext,
} from "./added-cases.ts";
import { TIME_MISSING_TEXT } from "./booking-time.ts";
import { displayHn } from "./hn.ts";
import { DEFAULT_REPAIR_PERIODS } from "./repair.ts";
import { REPAIR_FROM_JAN } from "./repair-fixtures.ts";
import type { DayBoard } from "./week.ts";

const REPAIR = REPAIR_FROM_JAN;
// Friday 13 November 2026 at 10:00, the day before the ventilation repair's first half (14 Nov 2026 to 26 Jan 2027).
const TODAY = "2026-11-13";
const at = (hh: number, mm = 0) => hh * 60 + mm;
const CONTEXT: BookingContext = { today: TODAY, earliest: "2026-11-16", periods: REPAIR, subtype: "GENSX", holidays: [] };
const ok = { date: "2026-11-16", hn: "0012345", operation: "Lap chole", shift: "in", start: 540, end: 600 };
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
  assert.equal(earliestText("2026-11-16", "2026-11-18", []), "หลังเวลา 15.00 น. ระบบจะปิดรับการจอง ของวันทำการถัดไป · จองได้ตั้งแต่ วันพุธที่ 18 พ.ย. 2569");
  assert.equal(bookableFrom("2026-11-18"), "จองได้ตั้งแต่ วันพุธที่ 18 พ.ย. 2569");
  assert.equal(BOOKING_CUTOFF_RULE, "หลังเวลา 15.00 น. ระบบจะปิดรับการจอง ของวันทำการถัดไป", "Pong's words");
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
  // The repair has no SCOPE room: a general surgeon's endoscopy is in GENSX's room like the rest (Pong, 19 Nov 2026).
  assert.deepEqual(room("GENSX", "EGD", FIRST), { ok: true, roomId: "or-12", dressing: false }, "an endoscopy in GENSX's room");
  // In the weekly schedule it is the SCOPE room's, OR 3, as the workbook's (Pong, 21 Nov 2026: "Move scope cases to scope
  // room using rules"), and the form shows that room as the name is typed.
  assert.deepEqual(room("GENSX", "Colonoscopy", "2027-03-22"), { ok: true, roomId: "or-3", dressing: false }, "the SCOPE room");
  assert.deepEqual(room("GENSX", "Lap chole", "2027-03-22"), { ok: true, roomId: "or-2", dressing: false }, "the rest of the list in GENSX's room");
  assert.deepEqual(room("URO", "Colonoscopy", "2027-03-22"), { ok: true, roomId: "or-7", dressing: false }, "only a general surgeon's");
  assert.deepEqual(room("GENSX", "Lap chole", SECOND), { ok: true, roomId: "or-5", dressing: false });
  assert.deepEqual(room("EYE", "Phaco", SECOND), { ok: true, roomId: "or-4", dressing: false });
  // No weekly schedule (Pong, 18 Nov 2026): a day before 16 Nov has the first half's rooms too.
  assert.deepEqual(room("URO", "TURP", "2026-11-11"), { ok: true, roomId: "or-11", dressing: false }, "the first half's mixed room");
  // an empty name still shows the department's room in the form
  assert.deepEqual(room("ORTHO", "", FIRST), { ok: true, roomId: "or-13", dressing: false });
  // Chest medicine has no period of its own: OR 4 on Mondays in the weekly schedule (21 Nov 2026), no room other days
  // (Pong, 27 Nov 2026: a department with no room that day borrows none, "Leave off board"). At the weekend no room.
  assert.deepEqual(room("CHEST", "Bronchoscopy", "2027-03-22"), { ok: true, roomId: "or-4", dressing: false });
  assert.deepEqual(room("CHEST", "Bronchoscopy", "2027-03-23"), { ok: false, reason: "no-room", error: "ไม่มีห้องของสาขาคุณในวันที่เลือก เลือกวันอื่น" });
  assert.deepEqual(room("CHEST", "Bronchoscopy", "2027-03-27"), { ok: false, reason: "no-room", error: "ไม่มีห้องของสาขาคุณในวันที่เลือก เลือกวันอื่น" });
  assert.deepEqual(room("CHEST", "Bronchoscopy", FIRST), { ok: true, roomId: "or-11", dressing: false }, "the repair's mixed room");
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
  assert.deepEqual(room("GENSX", "dressing", "2026-11-11"), { ok: true, roomId: "or-10", dressing: true }, "the first half's dressing room (first half from 1 Jan 2026), not the weekly schedule's OR 1");
  assert.deepEqual(room(null, "Dressing", "2026-11-16"), { ok: true, roomId: "or-10", dressing: true }, "no department needed");
  assert.deepEqual(room("GENSX", "D/S", "2026-11-21"), { ok: false, reason: "no-dressing-room", error: "ไม่มีห้องทำแผลในวันที่เลือก เลือกวันอื่น" }, "a Saturday");
});

test("no room: obstetrics-gynaecology during the repair, an unknown department, a day without the department's room", () => {
  const refused = (subtype: string | null, operation: string, date: string) => {
    const room = bookingRoom(subtype, operation, date, REPAIR, "dept");
    return room.ok ? room.roomId : room.error;
  };
  assert.equal(refused("OBGYN", "TAH", "2026-11-16"), "ช่วงปิดซ่อม สูติ-นรีเวชผ่าตัดที่อาคารแม่ จองที่นี่ไม่ได้");
  const obgynDressing = bookingRoom("OBGYN", "Dressing", "2026-11-16", REPAIR, "dressing");
  assert.deepEqual(
    obgynDressing,
    { ok: false, reason: "obgyn-building", error: "ช่วงปิดซ่อม สูติ-นรีเวชผ่าตัดที่อาคารแม่ จองที่นี่ไม่ได้" },
    "the dressing room too",
  );
  // The card the doctor cannot pick says the reason in short: only a missing room is about the day.
  assert.deepEqual(NO_ROOM_NOTE, {
    "obgyn-building": "ผ่าตัดที่อาคารแม่",
    "no-department": "ไม่ทราบสาขา",
    "no-room": "ไม่มีในวันที่เลือก",
    "no-dressing-room": "ไม่มีในวันที่เลือก",
  });
  assert.equal(refused("OBGYN", "TAH", "2027-03-18"), "or-6", "after the repair: the weekly schedule's obstetric room");
  assert.equal(refused(null, "Lap chole", "2026-11-16"), "ยังไม่มีสาขาของคุณในระบบ ติดต่อผู้ดูแล");
  assert.equal(refused("", "Lap chole", "2026-11-16"), "ยังไม่มีสาขาของคุณในระบบ ติดต่อผู้ดูแล");
  assert.equal(refused("ANES", "Lap chole", "2026-11-16"), "or-11", "a subtype the suite has no department for: the mixed room");
  assert.equal(refused("GENSX", "Lap chole", "2026-11-21"), "ไม่มีห้องของสาขาคุณในวันที่เลือก เลือกวันอื่น", "a Saturday");
});

test("a good booking passes, cleaned, in the room of the doctor's choice; a room the form sends is ignored", () => {
  const checked = check({ ...ok, operation: "  Lap \u200bchole\n  ", roomId: "or-2" });
  assert.deepEqual(checked, {
    ok: true,
    value: { date: "2026-11-16", start: 540, end: 600, roomId: "or-12", hn: "12345", operation: "Lap chole", shift: "in", dressing: false, scrubDoes: null, note: "" },
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

test("the note (หมายเหตุ) is optional, kept with its line breaks, cleaned, and at most MAX_NOTE characters", () => {
  const note = (value: unknown) => {
    const checked = check({ ...ok, note: value });
    return checked.ok ? checked.value.note : [checked.field, checked.error];
  };
  assert.equal(MAX_NOTE, 500);
  for (const value of [undefined, null, "", "   ", "\n \n\t", "\u200b"]) assert.equal(note(value), "", JSON.stringify(value));
  assert.equal(note("ขอ C-arm"), "ขอ C-arm");
  // the doctor's lines stay; spaces within a line are single, each line trimmed, one blank line at most
  assert.equal(note("  ขอ   C-arm \r\n\r\n\r\n\n เตรียมเลือด\t2 unit  \n"), "ขอ C-arm\n\nเตรียมเลือด 2 unit");
  assert.equal(cleanNote("a\u2028b\u2029c\rd"), "a\nb\nc\nd", "other line breaks become \\n");
  // invisible format and control characters go; Thai is composed (NFC)
  assert.equal(cleanNote("a\u0000b\u0007c\u200bd\u00ade\u0085f"), "abcdef");
  assert.equal(cleanNote("e\u0301"), "\u00e9");
  // the limit counts the cleaned note, so spaces around it do not count
  assert.equal(note(` ${"ก".repeat(MAX_NOTE)}\n `), "ก".repeat(MAX_NOTE));
  assert.deepEqual(note("ก".repeat(MAX_NOTE + 1)), ["note", "หมายเหตุยาวเกิน 500 ตัวอักษร"]);
  for (const value of [1, true, ["x"], { text: "x" }]) assert.deepEqual(note(value), ["note", "หมายเหตุไม่ถูกต้อง"], JSON.stringify(value));
  // checked last, as the form has it last: a bad day is said first
  const both = check({ ...ok, date: "2026-11-21", note: 1 });
  assert.ok(!both.ok);
  assert.equal(both.field, "date");
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
    { ok: false, field: undefined, error: "ช่วงปิดซ่อม สูติ-นรีเวชผ่าตัดที่อาคารแม่ จองที่นี่ไม่ได้" },
  );
  assert.deepEqual(error({ room: "dressing", scrubDoes: true, operation: "x" }), "ok", "no department needed for the dressing room");
  assert.equal(check({ ...ok, room: "dept" }, { subtype: null }).ok, false, "but needed for OR X");
});

test("a saved booking: the doctor's choice, or for one saved before the form asked, the room it was saved in", () => {
  const saved = (more: Partial<AddedCase>): AddedCase => ({
    id: "1",
    date: "2026-11-16",
    start: null,
    end: null,
    roomId: "or-12",
    hn: "12345",
    operation: "Wound dressing",
    shift: "in",
    dressing: null,
    scrubDoes: null,
    note: "",
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
    error: "หลังเวลา 15.00 น. ระบบจะปิดรับการจอง ของวันทำการถัดไป · จองได้ตั้งแต่ วันอังคารที่ 17 พ.ย. 2569",
    earliest: "2026-11-17",
  });
  assert.equal(error("2026-11-17", { earliest: "2026-11-17" }), "ok");
  for (const date of [undefined, "", "2026-11-16x", "2026-02-30", 20261116]) {
    assert.deepEqual(error(date), { ok: false, field: "date", error: "เลือกวันที่ผ่าตัด" }, JSON.stringify(date));
  }
  assert.equal(error(addDays(TODAY, 60)), "ok");
  assert.match((error(addDays(TODAY, 61)) as { error: string }).error, /ไม่เกิน 60 วัน/);
  assert.match((error("2026-11-21") as { error: string }).error, /เสาร์-อาทิตย์/);
  const holiday = error("2026-12-10", { holidays: DECEMBER });
  assert.deepEqual(holiday, { ok: false, field: "date", error: "วันหยุด (วันรัฐธรรมนูญ) เลือกวันอื่น" });
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
  const checked = check({ date: ok.date, hn: ok.hn, operation: ok.operation, start: ok.start, end: ok.end });
  assert.ok(checked.ok);
  assert.equal(checked.value.shift, "in");
  assert.deepEqual(check({ ...ok, shift: "night" }), { ok: false, field: "shift", error: "เลือกในเวลาหรือนอกเวลา" });
  assert.equal(check(null).ok, false);
});

test("a department without a room that day is said, about no field the doctor can fix, or about the day", () => {
  assert.deepEqual(check(ok, { subtype: null }), { ok: false, field: undefined, error: "ยังไม่มีสาขาของคุณในระบบ ติดต่อผู้ดูแล" });
  assert.deepEqual(check(ok, { subtype: "OBGYN" }), { ok: false, field: undefined, error: "ช่วงปิดซ่อม สูติ-นรีเวชผ่าตัดที่อาคารแม่ จองที่นี่ไม่ได้" });
});

test("added cases join the board after its own, numbered per room", () => {
  const board: DayBoard = {
    key: "fri",
    name: "Friday",
    date: TODAY,
    operations: [
      { id: "a", roomId: "or-12", order: 1, procedure: "EGD", surgeon: "x", specialty: null, status: "scheduled", shift: "in" },
    ],
  };
  const base = { start: null, end: null, operation: "Op", shift: "in" as const, dressing: null, scrubDoes: null, note: "", hn: "1", surgeonId: "7", surgeon: "สมชาย ใจดี", subtype: "ORTHO" };
  const added: AddedCase[] = [
    { ...base, id: "1", date: TODAY, roomId: "or-12" },
    { ...base, id: "2", date: TODAY, roomId: "or-11", shift: "out" },
    { ...base, id: "3", date: "2026-11-05", roomId: "or-12" }, // another day
    { ...base, id: "4", date: TODAY, roomId: "or-9" },
    { ...base, id: "5", date: TODAY, roomId: "or-12", operation: "" }, // a booking without a name yet
  ];
  const ops = withAddedCases(board, added, REPAIR).operations;
  assert.deepEqual(
    ops.map((item) => [item.id, item.roomId, item.order, item.shift]),
    [
      ["a", "or-12", 1, "in"],
      ["case-1", "or-12", 2, "in"],
      ["case-2", "or-11", 1, "out"],
      ["case-4", "or-9", 1, "in"],
      ["case-5", "or-12", 3, "in"],
    ],
  );
  assert.equal(ops[1].specialty, "ออร์โธปิดิกส์");
  assert.equal(ops[1].surgeon, "สมชาย ใจดี");
  assert.equal(ops[4].procedure, NO_OPERATION_LABEL);
  assert.equal(board.operations.length, 1, "the board itself is not changed");
  assert.ok(ops.every((item) => !("hn" in item)), "no HN on the board's operations");
});

test("when a booking was made reads in Bangkok time, the Thai short month and year: 15 พ.ย. 69, 23:43", () => {
  // 16:43 UTC is 23:43 in Bangkok; 17:05 UTC is already the next day there.
  assert.equal(bookedAtText("2026-11-15T16:43:00.000Z"), "15 พ.ย. 69, 23:43");
  assert.equal(bookedAtText("2026-11-15T17:05:09.000Z"), "16 พ.ย. 69, 00:05");
  assert.equal(bookedAtText("2027-01-02T01:07:00.000Z"), "2 ม.ค. 70, 08:07");
  assert.equal(bookedAtText("not a time"), "", "nothing to show");
});

test("a department with two rooms: a doctor's bookings stay in one, the first takes the room with fewer (Pong, 22 Nov 2026)", () => {
  // Monday 23 Nov 2026, the weekly schedule: GENSX holds OR 2 and OR 5.
  const MONDAY = "2026-11-23";
  const P = DEFAULT_REPAIR_PERIODS;
  assert.deepEqual(deptRooms("GENSX", "Lap chole", MONDAY, P), ["or-2", "or-5"]);
  assert.deepEqual(deptRooms("GENSX", "EGD", MONDAY, P), ["or-3"], "an endoscopy has the SCOPE room only");
  assert.deepEqual(deptRooms("EYE", "Phaco", MONDAY, P), ["or-10"]);
  assert.deepEqual(deptRooms("GENSX", "Lap chole", "2026-12-14", P), ["or-12"], "the repair: one room");
  assert.deepEqual(deptRooms("OBGYN", "TAH", "2026-12-14", P), [], "obstetrics off the board in the repair");
  assert.deepEqual(deptRooms(null, "x", MONDAY, P), []);
  assert.equal(POOLED_ROOM_NOTE, "ห้องที่จองน้อยกว่า");

  const made = (surgeonId: string, roomId: string, more: Partial<AddedCase> = {}): AddedCase => ({
    id: `${surgeonId}-${roomId}`,
    date: MONDAY,
    start: null,
    end: null,
    roomId,
    hn: "1234567",
    operation: "Lap chole",
    shift: "in",
    dressing: false,
    scrubDoes: null,
    note: "",
    surgeonId,
    surgeon: `หมอ ${surgeonId}`,
    subtype: "GENSX",
    ...more,
  });
  const pool = ["or-2", "or-5"];
  assert.equal(roomAmong(pool, "7", MONDAY, [], P), "or-2", "nobody booked yet: the first room");
  assert.equal(roomAmong(pool, "7", MONDAY, [made("8", "or-2")], P), "or-5", "another doctor in OR 2: the emptier OR 5");
  assert.equal(roomAmong(pool, "7", MONDAY, [made("8", "or-2"), made("7", "or-2")], P), "or-2", "the doctor's own earlier booking");
  assert.equal(roomAmong(pool, "7", MONDAY, [made("8", "or-5"), made("9", "or-5"), made("10", "or-2")], P), "or-2");
  // Dressing-room bookings, other days and other rooms do not count.
  assert.equal(
    roomAmong(pool, "7", MONDAY, [made("8", "or-1", { dressing: true, operation: "Dressing" }), made("9", "or-2", { date: "2026-11-24" }), made("10", "or-3", { operation: "EGD" })], P),
    "or-2",
  );

  // A saved booking stays in the room it was given while that is one of the department's rooms that day.
  assert.deepEqual(bookedRoom(made("7", "or-5"), P), { roomId: "or-5", dressing: false });
  assert.deepEqual(bookedRoom(made("7", "or-2"), P), { roomId: "or-2", dressing: false });
  // A room that is not, or no longer, one of them: the room worked out now.
  assert.deepEqual(bookedRoom(made("7", "or-12"), P), { roomId: "or-2", dressing: false });
  assert.deepEqual(bookedRoom(made("7", "or-5", { date: "2026-12-14" }), P), { roomId: "or-12", dressing: false }, "the repair");
});

test("a department with no room that day books none (Pong, 27 Nov 2026: in place of borrowing the emptiest room)", () => {
  const P = DEFAULT_REPAIR_PERIODS;
  const TUESDAY = "2027-03-23"; // the weekly schedule: vascular surgery has no room
  const NO_ROOM = { ok: false, reason: "no-room", error: "ไม่มีห้องของสาขาคุณในวันที่เลือก เลือกวันอื่น" };
  assert.deepEqual(bookingRoom("VASCULAR", "EVLA", TUESDAY, P, "dept"), NO_ROOM);
  assert.deepEqual(deptRooms("VASCULAR", "EVLA", TUESDAY, P), []);
  assert.deepEqual(bookingRoom("VASCULAR", "EVLA", "2026-12-14", P, "dept"), { ok: true, roomId: "or-11", dressing: false }, "the repair's mixed room");
  // A booking saved in a borrowed room before stays there (bookedRoom keeps the saved room when none can be worked out).
  const saved: AddedCase = {
    id: "9",
    date: TUESDAY,
    start: null,
    end: null,
    roomId: "or-9",
    hn: "1234567",
    operation: "EVLA",
    shift: "in",
    dressing: false,
    scrubDoes: null,
    note: "",
    surgeonId: "7",
    surgeon: "หมอ 7",
    subtype: "VASCULAR",
  };
  assert.deepEqual(bookedRoom(saved, P), { roomId: "or-9", dressing: false });
  // Its doctor may still edit it on its own day: the edit keeps that room. Another day needs a room of the department's own.
  const context = { today: "2027-03-15", earliest: "2027-03-16", periods: P, subtype: "VASCULAR", holidays: [], editing: saved };
  const input = { date: TUESDAY, hn: "1234567", operation: "EVLA", shift: "in", start: 600, end: 660, note: "ขอ C-arm" };
  const edited = checkCase(input, context);
  assert.ok(edited.ok && edited.value.roomId === "or-9" && edited.value.start === 600 && edited.value.note === "ขอ C-arm", JSON.stringify(edited));
  assert.deepEqual(roomToBook(undefined, "VASCULAR", "EVLA", TUESDAY, P, "dept", saved), { ok: true, roomId: "or-9", dressing: false });
  const moved = checkCase({ ...input, date: "2027-03-30" }, context);
  assert.ok(!moved.ok && moved.field === "date" && moved.error === NO_ROOM.error, `another Tuesday: ${JSON.stringify(moved)}`);
  assert.deepEqual(roomToBook(undefined, "VASCULAR", "EVLA", TUESDAY, P, "dept"), NO_ROOM, "a new booking gets none");
  assert.equal(checkCase(input, { ...context, editing: undefined }).ok, false, "nor does a new booking on that Tuesday");
});

// Pong, 25 Nov 2026: "on DR case row : allow surgeon to edit, move date, delete and other functions".
const own = (more: Partial<AddedCase> = {}): AddedCase => ({
  id: "41",
  date: "2026-11-17",
  start: null,
  end: null,
  roomId: "or-12",
  hn: "12345",
  operation: "Lap chole",
  shift: "in",
  dressing: false,
  scrubDoes: null,
  note: "ขอ C-arm",
  surgeonId: "7",
  surgeon: "x",
  subtype: "GENSX",
  ...more,
});
/** The form's input for a booking as it is (what the edit form opens with). */
const asInput = (booking: AddedCase) => ({
  date: booking.date,
  start: booking.start,
  end: booking.end,
  hn: booking.hn ? displayHn(booking.hn) : "",
  operation: booking.operation,
  room: bookedChoice(booking, REPAIR),
  scrubDoes: booking.scrubDoes,
  note: booking.note,
});

test("a booking's state for its row's actions: open until 15:00 the day before, then closed, past once its day has gone", () => {
  // Monday 16 Nov 2026: before 15:00 the first day is Tuesday, from 15:00 Wednesday
  assert.equal(bookingState("2026-11-17", "2026-11-16", "2026-11-17"), "open");
  assert.equal(bookingState("2026-11-17", "2026-11-16", "2026-11-18"), "closed", "Monday 15:00: Tuesday's list is MX's");
  assert.equal(bookingState("2026-11-16", "2026-11-16", "2026-11-17"), "closed", "its own day, until it has gone");
  assert.equal(bookingState("2026-11-13", "2026-11-16", "2026-11-17"), "past");
  assert.equal(bookingState("2026-12-01", "2026-11-16", "2026-11-18"), "open");
});

test("an edit on its own open day: every field as a new booking, without the day's checks (it was checked when booked)", () => {
  const booking = own({ date: "2026-11-17" });
  const editing = { ...booking };
  const context = { today: "2026-11-16", earliest: "2026-11-17", editing };
  const edited = check({ ...asInput(booking), hn: "0099999", operation: "Hernia", note: "" }, context);
  assert.deepEqual(edited, {
    ok: true,
    value: { date: "2026-11-17", start: null, end: null, roomId: "or-12", hn: "99999", operation: "Hernia", shift: "in", dressing: false, scrubDoes: null, note: "" },
  });
  // the fields are still required there
  const blank = check({ ...asInput(booking), operation: " " }, context);
  assert.deepEqual(blank.ok ? null : [blank.field, blank.error], ["operation", "ใส่ชื่อการผ่าตัด"]);
  // a holiday declared on its day after it was booked does not stop the edit; a new booking there is refused
  const holiday = [{ date: "2026-11-17", name: "วันหยุดพิเศษ" }];
  assert.equal(check(asInput(booking), { ...context, holidays: holiday }).ok, true);
  assert.equal(check(asInput(booking), { today: "2026-11-16", earliest: "2026-11-17", holidays: holiday }).ok, false);
  // its other room: the dressing room, with the scrub answer
  const dressing = check({ ...asInput(booking), room: "dressing", scrubDoes: false }, context);
  assert.ok(dressing.ok);
  assert.deepEqual([dressing.value.roomId, dressing.value.dressing, dressing.value.scrubDoes], ["or-10", true, false]);
});

test("a move to another day is checked as a new booking's day; a closed booking can still move to an open day", () => {
  const booking = own({ date: "2026-11-17" });
  // Monday 16 Nov 2026 after 15:00: Tuesday is closed, Wednesday the first open day
  const context = { today: "2026-11-16", earliest: "2026-11-18", editing: booking };
  const moved = check({ ...asInput(booking), date: "2026-11-19" }, context);
  assert.ok(moved.ok);
  assert.deepEqual([moved.value.date, moved.value.roomId], ["2026-11-19", "or-12"]);
  for (const [date, field] of [
    ["2026-11-16", "date"],
    ["2026-11-21", "date"],
  ]) {
    const refused = check({ ...asInput(booking), date }, context);
    assert.equal(refused.ok ? null : refused.field, field, date);
  }
  const early = check({ ...asInput(booking), date: "2026-11-16" }, context);
  assert.ok(!early.ok);
  assert.equal(early.earliest, "2026-11-18", "a day before the first open one says which is");
  // and the fields are free again on the new day
  const other = check({ ...asInput(booking), date: "2026-11-19", hn: "0055555" }, context);
  assert.equal(other.ok, true);
});

test("an edit on its own closed day changes only the note: the HN, the name and the room stay as the day's list has them", () => {
  const booking = own({ date: "2026-11-17", dressing: true, roomId: "or-10", scrubDoes: true });
  const context = { today: "2026-11-16", earliest: "2026-11-18", editing: booking };
  const noted = check({ ...asInput(booking), note: "  NPO หลังเที่ยงคืน " }, context);
  assert.deepEqual(noted, {
    ok: true,
    value: { date: "2026-11-17", start: null, end: null, roomId: "or-10", hn: "12345", operation: "Lap chole", shift: "in", dressing: true, scrubDoes: true, note: "NPO หลังเที่ยงคืน" },
  });
  const refused = (input: Record<string, unknown>) => {
    const checked = check({ ...asInput(booking), ...input }, context);
    return checked.ok ? "ok" : [checked.field, checked.error];
  };
  assert.deepEqual(refused({ hn: "0099999" }), ["hn", NOTE_ONLY_TEXT]);
  assert.deepEqual(refused({ hn: "" }), ["hn", NOTE_ONLY_TEXT]);
  assert.deepEqual(refused({ operation: "Hernia" }), ["operation", NOTE_ONLY_TEXT]);
  assert.deepEqual(refused({ room: "dept", scrubDoes: null }), ["room", NOTE_ONLY_TEXT]);
  assert.deepEqual(refused({ scrubDoes: false }), ["room", NOTE_ONLY_TEXT]);
  assert.deepEqual(refused({ hn: "0012345", operation: " Lap  chole " }), "ok", "the same HN and name, as typed");
  assert.deepEqual(refused({ note: "ก".repeat(MAX_NOTE + 1) }), ["note", "หมายเหตุยาวเกิน 500 ตัวอักษร"]);
  assert.deepEqual(refused({ note: 5 }), ["note", "หมายเหตุไม่ถูกต้อง"]);
  // a booking from before the HN and the name were required keeps them missing, and its note changes
  const old = own({ date: "2026-11-17", hn: null, operation: "", dressing: null, roomId: "or-12" });
  const oldNoted = check({ ...asInput(old), note: "ขอเตียง ICU" }, { ...context, editing: old });
  assert.deepEqual(oldNoted, {
    ok: true,
    value: { date: "2026-11-17", start: null, end: null, roomId: "or-12", hn: "", operation: "", shift: "in", dressing: false, scrubDoes: null, note: "ขอเตียง ICU" },
  });
  // on an open day it needs them, as a new booking does
  const opened = check({ ...asInput(old), note: "x" }, { today: "2026-11-16", earliest: "2026-11-17", editing: old });
  assert.deepEqual(opened.ok ? null : opened.field, "hn");
});

test("a closed day's note edit keeps what an older rule saved: an HN past today's 7 digits, a dressing room with no scrub answer", () => {
  const context = { today: "2026-11-16", earliest: "2026-11-18" };
  // HNs of up to 15 letters and digits were taken before 15 Nov 2026; the form sends them back as they were
  for (const hn of ["12345678", "AN1234"]) {
    const old = own({ hn });
    const noted = check({ ...asInput(old), note: "NPO" }, { ...context, editing: old });
    assert.ok(noted.ok, hn);
    assert.equal(noted.value.hn, hn);
  }
  // a dressing-room booking from before the form asked (dressing and scrub answer NULL): the note alone is saved
  // (app/(board)/actions.ts updateNote), the room choice as the day's list has it
  const dressing = own({ roomId: "or-10", dressing: null, scrubDoes: null });
  const noted = check({ ...asInput(dressing), note: "NPO" }, { ...context, editing: dressing });
  assert.ok(noted.ok);
  assert.deepEqual([noted.value.roomId, noted.value.note], ["or-10", "NPO"]);
});

test("what an edit changes: a new day, room or patient goes to the back of the queue; the name, the note or the scrub answer keep its place", () => {
  const booking = own();
  const input = (more: Record<string, unknown>) => {
    const checked = check({ ...asInput(booking), ...more }, { today: "2026-11-16", earliest: "2026-11-17", editing: booking });
    assert.ok(checked.ok, JSON.stringify(more));
    return bookingChange(booking, checked.value, REPAIR);
  };
  assert.deepEqual(input({}), { changed: false, requeue: false, moved: false }, "nothing changed");
  assert.deepEqual(input({ note: "NPO" }), { changed: true, requeue: false, moved: false });
  assert.deepEqual(input({ note: "" }), { changed: true, requeue: false, moved: false });
  assert.deepEqual(input({ operation: "Lap chole + IOC" }), { changed: true, requeue: false, moved: false });
  assert.deepEqual(input({ hn: "0099999" }), { changed: true, requeue: true, moved: false });
  assert.deepEqual(input({ date: "2026-11-18" }), { changed: true, requeue: true, moved: true });
  assert.deepEqual(input({ room: "dressing", scrubDoes: true }), { changed: true, requeue: true, moved: true });
  // in the dressing room, the scrub answer alone keeps the place
  const dressing = own({ roomId: "or-10", dressing: true, scrubDoes: true });
  const scrub = check({ ...asInput(dressing), scrubDoes: false }, { today: "2026-11-16", earliest: "2026-11-17", editing: dressing });
  assert.ok(scrub.ok);
  assert.deepEqual(bookingChange(dressing, scrub.value, REPAIR), { changed: true, requeue: false, moved: false });
  // a booking from before HNs were required that gets one: no new patient
  const old = own({ hn: null });
  const filled = check({ ...asInput(old), hn: "0012345" }, { today: "2026-11-16", earliest: "2026-11-17", editing: old });
  assert.ok(filled.ok);
  assert.deepEqual(bookingChange(old, filled.value, REPAIR), { changed: true, requeue: false, moved: false });
  // saved in a room an admin's change of the repair's dates moved: the room it is in now counts, no move of the doctor's
  const halves = { half1: { from: "2026-11-14", to: "2026-11-13" }, half2: { from: "2026-11-16", to: "2027-03-17" } };
  const shifted = own({ roomId: "or-10", dressing: true, scrubDoes: false });
  const same = { ...asInput(shifted), date: shifted.date, roomId: bookedRoom(shifted, halves).roomId, hn: "12345", shift: "in" as const, dressing: true, scrubDoes: false };
  assert.deepEqual(bookingChange(shifted, same, halves), { changed: true, requeue: false, moved: false }, "saved again in today's dressing room");
});

test("an edit's saved message: the new room and day after a move, the new room, or that it went to the back of the queue", () => {
  const before = { date: "2026-11-17" };
  assert.equal(editedMessage({ roomId: "or-12", date: "2026-11-19" }, before, { requeue: true, moved: true }), "เลื่อนไป OR 12 วันพฤหัสบดีที่ 19 พ.ย. 2569 แล้ว");
  assert.equal(editedMessage({ roomId: "or-10", date: "2026-11-17" }, before, { requeue: true, moved: true }), "ย้ายไป OR 10 แล้ว ต่อท้ายคิว");
  assert.equal(editedMessage({ roomId: "or-12", date: "2026-11-17" }, before, { requeue: true, moved: false }), "บันทึกแล้ว ต่อท้ายคิว");
  assert.equal(editedMessage({ roomId: "or-12", date: "2026-11-17" }, before, { requeue: false, moved: false }), "บันทึกแล้ว");
});

test("the form's word that a save goes to the back of the queue follows the server's: the day, the HN, or the room, a name's too", () => {
  const booking = own({ date: "2026-12-02", roomId: "or-5", operation: "Lap chole" });
  const P = DEFAULT_REPAIR_PERIODS; // the weekly schedule until 8 Dec 2026: GENSX holds OR 2 and OR 5, endoscopies OR 3
  const after = (more: Partial<{ date: string; hn: string; operation: string; choice: "dept" | "dressing" }>) =>
    editRequeues(booking, { date: "2026-12-02", hn: "0012345", operation: "Lap chole", choice: "dept", ...more }, "GENSX", P);
  assert.equal(after({}), false, "nothing that moves it");
  assert.equal(after({ operation: "Lap chole + IOC" }), false, "a name that keeps its room: OR 5 is still GENSX's");
  assert.equal(after({ operation: "EGD" }), true, "a name that sends it to OR 3");
  assert.equal(after({ hn: "0099999" }), true);
  assert.equal(after({ hn: "12345" }), false, "the same HN, typed without its zeros");
  assert.equal(after({ date: "2026-12-03" }), true);
  assert.equal(after({ choice: "dressing" }), true);
  assert.equal(editRequeues(own({ hn: null }), { date: "2026-11-17", hn: "0012345", operation: "Lap chole", choice: "dept" }, "GENSX", REPAIR), false, "an HN filled in");
  const dressing = own({ roomId: "or-10", dressing: true, scrubDoes: true });
  assert.equal(editRequeues(dressing, { date: "2026-11-17", hn: "0012345", operation: "x", choice: "dressing" }, "GENSX", REPAIR), false);
  assert.equal(editRequeues(dressing, { date: "2026-11-17", hn: "0012345", operation: "x", choice: "dept" }, "GENSX", REPAIR), true);
});

test("the sheet names the next 15:00 that closes a booking, as the booking cut-off does (weekends and holidays stepped over)", () => {
  assert.equal(editClosesOn("2026-12-03", "2026-12-01"), "2026-12-02", "Thursday's: Wednesday");
  assert.equal(editClosesOn("2026-12-03", "2026-12-02"), "2026-12-02", "on that Wednesday morning: the same day");
  // a Monday's booking: Friday at 15:00, and each weekend morning opens it again until 15:00 (earliestBookingDay)
  assert.equal(editClosesOn("2026-11-30", "2026-11-27"), "2026-11-27");
  assert.equal(editClosesOn("2026-11-30", "2026-11-28"), "2026-11-28");
  assert.equal(editClosesOn("2026-11-30", "2026-11-29"), "2026-11-29");
  // the Tuesday after a Monday holiday: the Friday before
  assert.equal(editClosesOn("2026-12-08", "2026-12-04", DECEMBER), "2026-12-04");
  assert.equal(editClosesOn("2026-12-08", "2026-12-08"), null, "its own day: nothing ahead");
});

test("booking again refuses a day that already has the patient in that room choice; another room or day is a new booking", () => {
  const mine = (more: Partial<AddedCase>): AddedCase => ({
    id: "1",
    date: "2026-11-16",
    start: null,
    end: null,
    roomId: "or-10",
    hn: "0012345",
    operation: "D/S",
    shift: "in",
    dressing: true,
    scrubDoes: true,
    note: "",
    surgeonId: "7",
    surgeon: "x",
    subtype: "GENSX",
    ...more,
  });
  const list = [mine({}), mine({ id: "2", date: "2026-11-17", roomId: "or-12", dressing: false, scrubDoes: null })];
  assert.equal(bookedAlready(list, { date: "2026-11-16", hn: "0012345", choice: "dressing" }, REPAIR), true, "the same day, patient and room");
  assert.equal(bookedAlready(list, { date: "2026-11-16", hn: "12345", choice: "dressing" }, REPAIR), true, "the HN as typed, without its zeros");
  assert.equal(bookedAlready(list, { date: "2026-11-16", hn: "0012345", choice: "dept" }, REPAIR), false, "the department's room the same day");
  assert.equal(bookedAlready(list, { date: "2026-11-18", hn: "0012345", choice: "dressing" }, REPAIR), false, "the next day of a series");
  assert.equal(bookedAlready(list, { date: "2026-11-16", hn: "0099999", choice: "dressing" }, REPAIR), false, "another patient");
  assert.equal(bookedAlready(list, { date: "2026-11-17", hn: "0012345", choice: "dept" }, REPAIR), true, "a department room booking");
  assert.equal(bookedAlready([mine({ hn: null })], { date: "2026-11-16", hn: "", choice: "dressing" }, REPAIR), false, "an older booking with no HN matches nothing");
  // an older dressing booking (no room choice saved) counts by the room it was saved in
  assert.equal(bookedAlready([mine({ dressing: null, scrubDoes: null })], { date: "2026-11-16", hn: "0012345", choice: "dressing" }, REPAIR), true);
});

// ---------------------------------------------------------------------------------------------------------------
// The booking's time (Pong, 27 Nov 2026: picked on the day view, 08:30 to 15:30; a booked time is taken)

test("the time: a new booking needs one, in 15-minute steps from 08:30 to 15:30; an untimed booking's edit may keep none", () => {
  const time = (start: unknown, end: unknown, context: Partial<BookingContext> = {}) => {
    const checked = check({ ...(context.editing ? asInput(own(context.editing)) : ok), start, end }, context);
    return checked.ok ? [checked.value.start, checked.value.end] : [checked.field, checked.error];
  };
  assert.deepEqual(time(510, 570), [510, 570], "08:30 to 09:30");
  assert.deepEqual(time(915, 930), [915, 930], "the last quarter hour");
  assert.deepEqual(time(510, 930), [510, 930], "the whole day");
  for (const [start, end] of [[undefined, undefined], [null, null], [540, null], [undefined, 600]]) {
    assert.deepEqual(time(start, end), ["time", TIME_MISSING_TEXT], `${start}-${end}`);
  }
  for (const [start, end] of [[495, 555], [900, 945], [545, 600], [600, 600], [660, 600], ["540", "600"], [540.5, 600], [true, 600]]) {
    assert.deepEqual(time(start, end), ["time", "เวลาไม่ถูกต้อง เลือกใหม่"], `${start}-${end}`);
  }
  // An edit of a booking from before the form asked keeps none, or takes one; a timed booking's edit needs one.
  const untimed = own({ date: "2026-11-17" });
  const editing = { today: "2026-11-16", earliest: "2026-11-17", editing: untimed };
  assert.deepEqual(time(null, null, editing), [null, null]);
  assert.deepEqual(time(600, 660, editing), [600, 660]);
  const timed = { ...editing, editing: own({ date: "2026-11-17", start: 540, end: 600 }) };
  assert.deepEqual(time(null, null, timed), ["time", TIME_MISSING_TEXT]);
  // A closed day's note edit keeps the booking's own time, whatever the form sends.
  const closed = { today: "2026-11-17", earliest: "2026-11-18", editing: own({ date: "2026-11-17", start: 540, end: 600 }) };
  assert.deepEqual(time(540, 600, closed), [540, 600]);
});

test("a time clashes with another booking's in the same room that day, never with its own or another room's", () => {
  const MONDAY = "2026-11-23";
  const P = DEFAULT_REPAIR_PERIODS;
  const made = (id: string, roomId: string, start: number | null, end: number | null, surgeonId = "7"): AddedCase => ({
    id,
    date: MONDAY,
    start,
    end,
    roomId,
    hn: "1234567",
    operation: "Lap chole",
    shift: "in",
    dressing: false,
    scrubDoes: null,
    note: "",
    surgeonId,
    surgeon: `หมอ ${surgeonId}`,
    subtype: "GENSX",
  });
  const day = [made("a", "or-2", 540, 600), made("b", "or-5", 600, 690), made("c", "or-2", null, null)];
  assert.equal(timeClash({ start: 570, end: 630 }, "or-2", MONDAY, day, P), true, "09:30-10:30 over 09:00-10:00");
  assert.equal(timeClash({ start: 600, end: 660 }, "or-2", MONDAY, day, P), false, "from 10:00, as the other ends");
  assert.equal(timeClash({ start: 510, end: 540 }, "or-2", MONDAY, day, P), false, "ending as the other starts");
  assert.equal(timeClash({ start: 570, end: 630 }, "or-2", MONDAY, day, P, "a"), false, "its own time");
  assert.equal(timeClash({ start: 570, end: 630 }, "or-2", "2026-11-24", day, P), false, "another day");
  assert.equal(timeClash(null, "or-2", MONDAY, day, P), false, "no time");
  assert.equal(timeClash({ start: 630, end: 660 }, "or-5", MONDAY, day, P), true);

  // A department's two rooms: the first booking of a doctor takes the room free at its time.
  assert.equal(roomAmong(["or-2", "or-5"], "8", MONDAY, [made("a", "or-2", 540, 600, "7")], P, { start: 540, end: 600 }), "or-5");
  assert.equal(roomAmong(["or-2", "or-5"], "8", MONDAY, [made("a", "or-2", 540, 600, "7")], P, { start: 600, end: 660 }), "or-5", "fewer bookings");
  assert.equal(
    roomAmong(["or-2", "or-5"], "8", MONDAY, [made("a", "or-2", 540, 600, "7"), made("b", "or-5", 600, 660, "9")], P, { start: 540, end: 600 }),
    "or-5",
    "the room free then, though as booked as the other",
  );

  // The day view's slots: the room each is in now, and the viewer's own marked.
  assert.deepEqual(daySlots([made("a", "or-2", 540, 600, "7"), { ...made("b", "or-5", null, null, "9"), operation: "" }], P, "7"), [
    { id: "a", roomId: "or-2", start: 540, end: 600, operation: "Lap chole", surgeon: "หมอ 7", own: true },
    { id: "b", roomId: "or-5", start: null, end: null, operation: NO_OPERATION_LABEL, surgeon: "หมอ 9", own: false },
  ]);
  assert.deepEqual(timeOf(made("a", "or-2", 540, 600)), { start: 540, end: 600 });
  assert.equal(timeOf(made("c", "or-2", null, null)), null);
  // By time, the untimed after in their own order.
  const order = byTime([made("1", "or-2", null, null), made("2", "or-2", 600, 660), made("3", "or-2", 540, 600), made("4", "or-2", null, null)]);
  assert.deepEqual(order.map((item) => item.id), ["3", "2", "1", "4"]);
});

test("a new time keeps the booking's place in the queue; it counts as a change", () => {
  const booking = { ...own({ date: "2026-11-17", start: 540, end: 600 }), subtype: "GENSX" };
  const moved = check({ ...asInput(booking), start: 600, end: 660 }, { today: "2026-11-16", earliest: "2026-11-17", editing: booking });
  assert.ok(moved.ok);
  assert.deepEqual(bookingChange(booking, moved.value, REPAIR), { changed: true, requeue: false, moved: false });
  const same = check(asInput(booking), { today: "2026-11-16", earliest: "2026-11-17", editing: booking });
  assert.ok(same.ok);
  assert.deepEqual(bookingChange(booking, same.value, REPAIR), { changed: false, requeue: false, moved: false });
});

// Pong, 27 Nov 2026: "Add booking btn on ท่าฉลอม also"; on the decision card "No, own department's room only".
test("รพ.ท่าฉลอม: the department's room in its table, never a dressing room nor another department's", () => {
  const tc = { place: "tha-chalom" as const };
  // Monday 16 Nov: OR 1 is orthopaedics', so general surgery has no room there
  const monday = check({ ...ok, room: "dept" }, tc);
  assert.ok(!monday.ok && monday.field === "date" && monday.error === "ไม่มีห้องของสาขาคุณในวันที่เลือก เลือกวันอื่น", JSON.stringify(monday));
  const tuesday = check({ ...ok, date: "2026-11-17", room: "dept" }, tc);
  assert.ok(tuesday.ok, JSON.stringify(tuesday));
  assert.deepEqual([tuesday.value.roomId, tuesday.value.dressing, tuesday.value.place], ["or-1", false, "tha-chalom"]);
  const dressing = check({ ...ok, date: "2026-11-17", room: "dressing", scrubDoes: true }, tc);
  assert.ok(!dressing.ok && dressing.field === "date", "no dressing room to book there");
  assert.deepEqual(check({ ...ok, date: "2026-11-17", room: "dept" }, { ...tc, subtype: "PLASTIC" }), {
    ok: true,
    value: { ...(tuesday.value as object), roomId: "scope", place: "tha-chalom" },
  } as unknown, "ศัลยกรรมตกแต่ง in the Scope room on Tuesdays");
  // รพ.สมุทรสาคร's bookings carry no place, whatever the form sends: the server's context decides
  const skh = check({ ...ok, date: "2026-11-17", room: "dept", place: "tha-chalom" });
  assert.ok(skh.ok && !("place" in skh.value) && skh.value.roomId === "or-12", JSON.stringify(skh));
  assert.deepEqual(placeBookingRoom("tha-chalom", "ENT", "", "2026-11-18", REPAIR, "dept"), { ok: true, roomId: "or-4", dressing: false });
  assert.deepEqual(placeBookingRoom("tha-chalom", null, "", "2026-11-18", REPAIR, "dept"), {
    ok: false,
    reason: "no-department",
    error: "ยังไม่มีสาขาของคุณในระบบ ติดต่อผู้ดูแล",
  });
  assert.deepEqual(placeBookingRoom(undefined, "GENSX", "Lap chole", "2026-11-17", REPAIR, "dept"), bookingRoom("GENSX", "Lap chole", "2026-11-17", REPAIR, "dept"));
});

test("a รพ.ท่าฉลอม booking stays in the room it was saved in, and is named by its hospital's rooms", () => {
  const tc = own({ roomId: "scope", subtype: "PLASTIC", place: "tha-chalom" });
  assert.deepEqual(bookedRoom(tc, REPAIR), { roomId: "scope", dressing: false });
  assert.equal(bookedChoice(tc, REPAIR), "dept");
  assert.equal(bookedMessage({ roomId: "scope", date: "2026-11-17", place: "tha-chalom" }), "จอง ห้อง Scope วันอังคารที่ 17 พ.ย. 2569 แล้ว");
  assert.equal(bookedMessage({ roomId: "or-4", date: "2026-11-18", place: "tha-chalom" }), "จอง OR 4 วันพุธที่ 18 พ.ย. 2569 แล้ว");
  assert.equal(placeRoomName("or-12"), "OR 12");
  assert.equal(placeRoomName("scope", "tha-chalom"), "ห้อง Scope");
  // on its own day a new name or note keeps its place in the queue; a new day or patient does not
  const keep = { date: tc.date, hn: "12345", operation: "Excision", choice: "dept" as const };
  assert.equal(editRequeues(tc, keep, "PLASTIC", REPAIR), false);
  assert.equal(editRequeues(tc, { ...keep, date: "2026-11-24" }, "PLASTIC", REPAIR), true);
  assert.equal(editRequeues(tc, { ...keep, hn: "54321" }, "PLASTIC", REPAIR), true);
  // the day view shows it in its own room
  assert.deepEqual(
    daySlots([tc], REPAIR, "7").map((slot) => slot.roomId),
    ["scope"],
  );
});
