import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays,
  checkCase,
  cleanOperation,
  firstBookingDay,
  MAX_OPERATION,
  nextWorkday,
  NO_OPERATION_LABEL,
  roomForSubtype,
  withAddedCases,
  type AddedCase,
} from "./added-cases.ts";
import { DEFAULT_REPAIR_PERIODS } from "./repair.ts";
import type { DayBoard } from "./week.ts";

// Tuesday 4 November 2026, before the ventilation repair (lib/repair.test.ts covers bookings during it).
const TODAY = "2026-11-04";
const REPAIR = DEFAULT_REPAIR_PERIODS;
const ok = { date: TODAY, roomId: "or-2", hn: "12345", operation: "Laparoscopic cholecystectomy", shift: "in" };
const check = (input: unknown, today = TODAY) => checkCase(input, today, REPAIR);

test("a good booking passes, cleaned", () => {
  const checked = check({ ...ok, operation: "  Lap ​chole\n  " });
  assert.deepEqual(checked, { ok: true, value: { ...ok, operation: "Lap chole" } });
  assert.equal(cleanOperation("a\t b"), "a b");
});

test("the shift defaults to in hours and must be in or out", () => {
  const checked = check({ date: ok.date, roomId: ok.roomId, hn: ok.hn, operation: ok.operation });
  assert.ok(checked.ok);
  assert.equal(checked.value.shift, "in");
  assert.equal(check({ ...ok, shift: "night" }).ok, false);
});

test("dates: today up to 60 days ahead, weekdays only, not a holiday when the holidays are known", () => {
  assert.equal(check({ ...ok, date: "2026-11-03" }).ok, false); // yesterday
  assert.equal(check({ ...ok, date: "2026-11-07" }).ok, false); // Saturday
  assert.equal(check({ ...ok, date: "2026-11-02x" }).ok, false);
  assert.equal(check({ ...ok, date: "2026-02-30" }).ok, false);
  assert.equal(check({ ...ok, date: addDays(TODAY, 61) }).ok, false);
  assert.equal(check({ ...ok, date: "2026-11-05" }).ok, true);
  const holidays = [{ date: "2026-11-05", name: "วันหยุดพิเศษ" }];
  const refused = checkCase({ ...ok, date: "2026-11-05" }, TODAY, REPAIR, holidays);
  assert.ok(!refused.ok);
  assert.match(refused.error, /วันหยุด \(วันหยุดพิเศษ\)/);
  assert.equal(checkCase({ ...ok, date: "2026-11-06" }, TODAY, REPAIR, holidays).ok, true);
});

test("every OR (1 to 13) takes a booking outside the repair; recovery-area rooms and unknown ids do not", () => {
  for (const roomId of ["or-1", "or-3", "or-5", "or-6", "or-8", "or-13"]) assert.equal(check({ ...ok, roomId }).ok, true, roomId);
  for (const roomId of ["r-1", "", "x"]) assert.equal(check({ ...ok, roomId }).ok, false, roomId);
});

test("the HN is required, checked and stored normalised", () => {
  for (const hn of [undefined, null, "", "   ", 12345]) {
    const checked = check({ ...ok, hn });
    assert.ok(!checked.ok, JSON.stringify(hn));
    assert.equal(checked.error, "ใส่ HN ของผู้ป่วย");
  }
  for (const hn of ["12 345", "HN:1", "ก123", "1".repeat(16), "12/34"]) {
    const checked = check({ ...ok, hn });
    assert.ok(!checked.ok, hn);
    assert.match(checked.error, /ไม่เกิน 15 ตัว/);
  }
  const normalised = (hn: string) => {
    const checked = check({ ...ok, hn });
    return checked.ok ? checked.value.hn : checked.error;
  };
  assert.equal(normalised(" 0012-345 "), "12345");
  assert.equal(normalised("ab12"), "AB12");
  assert.equal(normalised("๐๑๒๓"), "123", "Thai digits");
  assert.equal(normalised("ＡＢ１２"), "AB12", "full-width");
  assert.equal(normalised("000"), "0");
  assert.equal(normalised("---"), "ใส่ HN ของผู้ป่วย");
});

test("the operation's name is optional and at most 300 characters", () => {
  for (const operation of [undefined, null, "", "   "]) {
    const checked = check({ ...ok, operation });
    assert.ok(checked.ok, JSON.stringify(operation));
    assert.equal(checked.value.operation, "");
  }
  assert.equal(check({ ...ok, operation: 5 }).ok, false);
  assert.equal(check({ ...ok, operation: "x".repeat(MAX_OPERATION) }).ok, true);
  assert.equal(check({ ...ok, operation: "x".repeat(MAX_OPERATION + 1) }).ok, false);
  assert.equal(check(null).ok, false);
});

test("next workday and the department's room", () => {
  assert.equal(nextWorkday("2026-11-07"), "2026-11-09");
  assert.equal(nextWorkday("2026-11-04"), "2026-11-04");
  assert.equal(roomForSubtype("GENSX", "2026-11-02", REPAIR), "or-2"); // Monday
  // The weekly schedule's rooms (lib/repair.test.ts covers the repair layout).
  assert.equal(roomForSubtype("ENT", "2026-10-28", REPAIR), "or-4"); // Wednesday
  assert.equal(roomForSubtype("PEDSX", "2026-10-13", REPAIR), "or-5"); // Tuesday morning
  assert.equal(roomForSubtype("URO", "2026-10-28", REPAIR), "or-7"); // Wednesday
  assert.equal(roomForSubtype("EYE", "2026-11-05", REPAIR), "or-10"); // Thursday
  assert.equal(roomForSubtype("CVT", "2026-11-09", REPAIR), "or-13"); // 2nd Monday: CVT in OR 13
  assert.equal(roomForSubtype("CVT", "2026-10-19", REPAIR), "or-11"); // 3rd Monday: CVT in OR 11
  assert.equal(roomForSubtype(null, "2026-10-28", REPAIR), null);
});

test("the form opens on the board's own day, which already steps over holidays", () => {
  // Wed 9 Dec 2026 after 16:00: the board shows Fri 11 Dec because Thu 10 Dec is วันรัฐธรรมนูญ. The form must not open
  // on the holiday (the server would refuse it), as the weekday rule alone would.
  assert.equal(firstBookingDay("2026-12-11", "2026-12-09"), "2026-12-11");
  // Fri 4 Dec after 16:00: the board shows Tue 8 Dec, past the weekend and Mon 7 Dec.
  assert.equal(firstBookingDay("2026-12-08", "2026-12-04"), "2026-12-08");
  // A workday before 16:00: today.
  assert.equal(firstBookingDay("2026-11-16", "2026-11-16"), "2026-11-16");
  // No board (the preview of a closed day): the next weekday after today.
  assert.equal(firstBookingDay(null, "2026-11-13"), "2026-11-16");
});

test("added cases join the board after its own, numbered per room", () => {
  const board: DayBoard = {
    key: "wed",
    name: "Wednesday",
    date: TODAY,
    operations: [
      { id: "a", roomId: "or-2", order: 1, procedure: "EGD", surgeon: "x", specialty: null, status: "scheduled", shift: "in" },
    ],
  };
  const base = { operation: "Op", shift: "in" as const, hn: "1", surgeonId: "7", surgeon: "สมชาย ใจดี", subtype: "ORTHO" };
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
