import assert from "node:assert/strict";
import { test } from "node:test";
import { bookingRoom, withAddedCases, type AddedCase } from "./added-cases.ts";
import { allocationFor, DEPARTMENTS } from "./allocation.ts";
import {
  checkRepairPeriods,
  DEFAULT_REPAIR_PERIODS,
  INSTRUMENT_USE,
  REPAIR_IN_USE,
  REPAIR_LAYOUTS,
  repairOn,
  type RepairPeriods,
} from "./repair.ts";
import { REPAIR_FROM_JAN } from "./repair-fixtures.ts";
import {
  getRoom,
  isInstrumentUse,
  isRecoveryUse,
  isSelectableRoom,
  numberRanges,
  openRooms,
  recoveryAreaClosed,
  ROOMS,
  roomUse,
  unusedRoomsText,
} from "./rooms.ts";
import { boardFor, weekBoard, type WeekCase, type WeekFile } from "./week.ts";

// The planned dates (Pong, 21 Nov 2026): the repair from 8 Dec 2026 for 100 days, first half to 26 Jan 2027, second half
// 27 Jan to 17 Mar 2027; the normal weekly OR schedule before and after. The room tests below use the first half from
// 1 Jan 2026 (lib/repair-fixtures.ts), as planned until then, to keep their November dates.
const PLANNED = DEFAULT_REPAIR_PERIODS;
const REPAIR = REPAIR_FROM_JAN;
const FIRST_DAY = "2026-01-01"; // Thursday
const PAST_MONDAY = "2026-03-02"; // a day the board shows looking back
const FIRST_MONDAY = "2026-11-16";
const FIRST_LAST = "2027-01-26"; // Tuesday
const SECOND_DAY = "2027-01-27"; // Wednesday
const SECOND_LAST = "2027-03-17"; // Wednesday
const AFTER = "2027-03-18"; // Thursday

test("the repair layout is on, with the planned dates as the default: 100 days from 8 Dec 2026", () => {
  assert.equal(REPAIR_IN_USE, true);
  assert.deepEqual(DEFAULT_REPAIR_PERIODS, {
    half1: { from: "2026-12-08", to: "2027-01-26" },
    half2: { from: "2027-01-27", to: "2027-03-17" },
  });
  const days = (Date.parse(PLANNED.half2.to) - Date.parse(PLANNED.half1.from)) / 86_400_000 + 1;
  assert.equal(days, 100, "8 Dec 2026 to 17 Mar 2027 is 100 days");
  // The go-live period: the normal weekly OR schedule up to 7 Dec 2026, looking back to January too.
  for (const date of ["2026-01-05", "2026-11-23", "2026-12-07"]) {
    assert.equal(repairOn(date, PLANNED), null, date);
    assert.equal(openRooms(date, PLANNED).length, 13, `all 13 rooms open ${date}`);
  }
  assert.equal(allocationFor("or-2", "2026-11-23", PLANNED)?.am?.code, "GENSX", "the weekly schedule's OR 2");
  assert.equal(allocationFor("or-10", "2026-11-23", PLANNED)?.am?.code, "EYE", "the weekly schedule's OR 10");
  assert.equal(repairOn("2026-12-08", PLANNED)?.half, 1, "the repair starts by itself on 8 Dec 2026");
  assert.equal(repairOn(FIRST_LAST, PLANNED)?.half, 1);
  assert.equal(repairOn(SECOND_DAY, PLANNED)?.half, 2);
  assert.equal(repairOn(SECOND_LAST, PLANNED)?.half, 2);
  assert.equal(repairOn(AFTER, PLANNED), null, "back to the normal schedule after the 100 days");
  assert.equal(openRooms(AFTER, PLANNED).length, 13);
  assert.equal(repairOn("2026-11-1", PLANNED), null);
  assert.equal(repairOn(null, PLANNED), null);
  assert.equal(repairOn(undefined, PLANNED), null);
  const half = repairOn("2026-12-08", PLANNED)!;
  assert.deepEqual([half.from, half.to], ["2026-12-08", "2027-01-26"]);
});

test("the admin's switch overrides the dates on every day, for everyone", () => {
  for (const date of ["2026-11-23", "2026-12-08", SECOND_DAY, AFTER]) {
    assert.equal(repairOn(date, { ...PLANNED, mode: "normal" }), null, `normal ${date}`);
    assert.equal(repairOn(date, { ...PLANNED, mode: "half1" })?.half, 1, `half1 ${date}`);
    assert.equal(repairOn(date, { ...PLANNED, mode: "half2" })?.half, 2, `half2 ${date}`);
  }
  assert.equal(repairOn("2026-12-08", { ...PLANNED, mode: "auto" })?.half, 1, "auto follows the dates");
  assert.equal(repairOn("2026-11-23", { ...PLANNED, mode: "auto" }), null);
  assert.equal(openRooms("2026-12-08", { ...PLANNED, mode: "normal" }).length, 13);
  assert.deepEqual(
    openRooms("2026-11-23", { ...PLANNED, mode: "half2" }).map((room) => room.id),
    ["or-1", "or-2", "or-3", "or-4", "or-5"],
  );
  const plain = checkRepairPeriods(PLANNED);
  assert.equal(plain.ok && plain.periods.mode, "auto", "no mode means auto");
  const forced = checkRepairPeriods({ ...PLANNED, mode: "half2" });
  assert.equal(forced.ok && forced.periods.mode, "half2");
  assert.deepEqual(checkRepairPeriods({ ...PLANNED, mode: "weekly" }), { ok: false, error: "เลือกตารางที่ใช้ให้ถูกต้อง" });
});

test("the dates an admin saved decide, not the defaults; a gap between the halves keeps the first half's rooms", () => {
  const moved: RepairPeriods = { half1: { from: "2026-12-01", to: "2026-12-31" }, half2: { from: "2027-01-05", to: "2027-02-05" } };
  assert.equal(repairOn("2026-11-30", moved), null, "before the first half: the normal schedule");
  assert.equal(repairOn("2026-12-01", moved)?.half, 1);
  assert.equal(repairOn("2027-01-02", moved)?.half, 1, "between the halves");
  assert.equal(repairOn("2027-01-05", moved)?.half, 2);
  assert.equal(repairOn("2027-02-05", moved)?.half, 2);
  assert.equal(repairOn("2027-02-08", moved), null, "after the second half: the normal schedule");
  assert.equal(repairOn("2027-01-04", { ...moved, half2: { from: "2027-01-04", to: "2027-02-05" } })?.half, 2, "moving the second half moves the change");
  assert.equal(roomUse("or-2", "2027-01-04", moved), "closed");
  assert.equal(allocationFor("or-11", "2027-01-04", moved)?.am?.code, "MIXED", "Monday's OR 11 in the first half's rooms");
});

test("first half: OR 9 to 13 operate, OR 7 and 8 are recovery rooms, OR 1 to 6 and the recovery area are closed", () => {
  for (const date of [FIRST_DAY, FIRST_MONDAY, FIRST_LAST]) {
    assert.deepEqual(openRooms(date, REPAIR).map((room) => room.id), ["or-9", "or-10", "or-11", "or-12", "or-13"], date);
    for (const n of [7, 8]) assert.equal(roomUse(`or-${n}`, date, REPAIR), "recovery", `OR ${n} ${date}`);
    for (const n of [1, 2, 3, 4, 5, 6]) assert.equal(roomUse(`or-${n}`, date, REPAIR), "closed", `OR ${n} ${date}`);
    assert.equal(recoveryAreaClosed("r-1", date, REPAIR), true);
    assert.equal(recoveryAreaClosed("r-2", date, REPAIR), true);
  }
  assert.equal(unusedRoomsText(FIRST_MONDAY, REPAIR), "OR 7–8 เป็นห้องพักฟื้น · OR 1–6 ปิด");
  assert.deepEqual(REPAIR_LAYOUTS[1].emergencyRooms, ["or-12", "or-13"], "NEURO and CVT emergencies: OR 12 or 13");
});

test("second half: OR 1 to 5 operate, OR 6 holds the instruments, OR 7 to 13 and RR 1 are closed, RR 2 stays", () => {
  for (const date of [SECOND_DAY, SECOND_LAST]) {
    assert.deepEqual(openRooms(date, REPAIR).map((room) => room.id), ["or-1", "or-2", "or-3", "or-4", "or-5"], date);
    assert.equal(roomUse("or-6", date, REPAIR), "instrument");
    for (let n = 7; n <= 13; n += 1) assert.equal(roomUse(`or-${n}`, date, REPAIR), "closed", `OR ${n} ${date}`);
    assert.equal(recoveryAreaClosed("r-1", date, REPAIR), true);
    assert.equal(recoveryAreaClosed("r-2", date, REPAIR), false);
  }
  assert.equal(unusedRoomsText(SECOND_DAY, REPAIR), "OR 6 เป็นห้องเครื่องมือ · OR 7–13 ปิด");
  assert.equal(unusedRoomsText(PAST_MONDAY, REPAIR), "OR 7–8 เป็นห้องพักฟื้น · OR 1–6 ปิด", "a past day has the first half's rooms");
  assert.deepEqual(REPAIR_LAYOUTS[2].emergencyRooms, ["or-2"], "NEURO and CVT emergencies: OR 2");
  assert.equal(INSTRUMENT_USE.label, "เครื่องมือ");
});

test("recovery, instrument and closed rooms cannot be opened on the plan", () => {
  assert.equal(isSelectableRoom(getRoom("or-7")!, FIRST_MONDAY, REPAIR), false);
  assert.equal(isRecoveryUse(getRoom("or-7")!, FIRST_MONDAY, REPAIR), true);
  assert.equal(isRecoveryUse(getRoom("or-7")!, PAST_MONDAY, REPAIR), true, "a past day too");
  assert.equal(isSelectableRoom(getRoom("or-6")!, SECOND_DAY, REPAIR), false);
  assert.equal(isInstrumentUse(getRoom("or-6")!, SECOND_DAY, REPAIR), true);
  assert.equal(isInstrumentUse(getRoom("or-6")!, FIRST_MONDAY, REPAIR), false);
  assert.equal(isSelectableRoom(getRoom("or-12")!, FIRST_MONDAY, REPAIR), true);
  assert.equal(isSelectableRoom(getRoom("or-2")!, FIRST_MONDAY, REPAIR), false);
  assert.equal(isSelectableRoom(getRoom("or-2")!, SECOND_DAY, REPAIR), true);
  assert.equal(roomUse("r-1", FIRST_MONDAY, REPAIR), "closed", "the recovery area is not an OR");
  assert.equal(roomUse("nope", FIRST_MONDAY, REPAIR), "closed");
  assert.equal(recoveryAreaClosed("r-1", PAST_MONDAY, REPAIR), true);
  assert.equal(recoveryAreaClosed("r-2", AFTER, REPAIR), false, "after the repair the second half's rooms stay");
  assert.equal(recoveryAreaClosed("or-1", FIRST_MONDAY, REPAIR), false, "only recovery-area rooms");
});

test("rooms hold one department all day, whatever the weekly schedule says, in the department's own colour", () => {
  const code = (roomId: string, date: string) => allocationFor(roomId, date, REPAIR)?.am?.code ?? null;
  // First half, on a Monday and a Tuesday.
  for (const date of [FIRST_MONDAY, "2026-11-17"]) {
    assert.equal(code("or-9", date), "EMER");
    assert.equal(code("or-10", date), "INFECT");
    assert.equal(code("or-11", date), "MIXED");
    assert.equal(code("or-12", date), "GENSX");
    assert.equal(code("or-13", date), "ORTHO");
    for (const id of ["or-1", "or-6", "or-7", "or-8"]) assert.equal(allocationFor(id, date, REPAIR), null, `${id} ${date}`);
  }
  // Second half.
  assert.equal(code("or-1", SECOND_DAY), "INFECT");
  assert.equal(code("or-2", SECOND_DAY), "ORTHO");
  assert.equal(code("or-3", SECOND_DAY), "EMER");
  assert.equal(code("or-4", SECOND_DAY), "MIXED");
  assert.equal(code("or-5", SECOND_DAY), "GENSX");
  assert.equal(allocationFor("or-6", SECOND_DAY, REPAIR), null, "the instrument room");
  assert.equal(allocationFor("or-9", SECOND_DAY, REPAIR), null);

  const allocation = allocationFor("or-12", FIRST_MONDAY, REPAIR)!;
  assert.equal(allocation.repair, true);
  assert.equal(allocation.split, false);
  assert.equal(allocation.am, allocation.pm);
  assert.equal(allocation.am?.color, DEPARTMENTS.GENSX.color, "the department's colour (Pong, 14 Nov 2026)");
  assert.equal(allocation.am?.label, "GENSX");
  assert.equal(DEPARTMENTS.GENSX.color, "#1E7B3C", "the department list keeps its colour");

  assert.equal(allocationFor("or-12", "2026-11-21", REPAIR), null, "Saturday");
  // With the first half from 1 Jan 2026, a past day has the first half's rooms; after the repair, the weekly schedule.
  assert.equal(allocationFor("or-4", PAST_MONDAY, REPAIR), null, "OR 4 is closed in the first half");
  assert.equal(allocationFor("or-11", PAST_MONDAY, REPAIR)?.repair, true);
  assert.equal(code("or-11", PAST_MONDAY), "MIXED");
  assert.equal(code("or-4", "2027-03-22"), "OBGYN", "after the repair: the weekly schedule's Monday OR 4");
  assert.equal(allocationFor("or-4", "2027-03-22", REPAIR)?.repair, false);
});

test("a mixed-department room is labelled OTHER and named คละแผนก", () => {
  assert.equal(DEPARTMENTS.MIXED.label, "OTHER");
  assert.equal(DEPARTMENTS.MIXED.name, "คละแผนก");
});

/** Points of a path made of M and L commands. */
function points(d: string): [number, number][] {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const out: [number, number][] = [];
  for (let i = 0; i < numbers.length; i += 2) out.push([numbers[i], numbers[i + 1]]);
  return out;
}

/** Ray casting: whether (x, y) lies inside the polygon. */
function inside([x, y]: [number, number], polygon: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

test("each half's repair zone covers its closed rooms and none of the rooms in use", () => {
  assert.equal(REPAIR_LAYOUTS[1].zone, "M20 20L1187 20L1187 700L400 700L400 590L20 590Z");
  assert.equal(REPAIR_LAYOUTS[2].zone, "M433 532L757 532L757 700L1187 700L1187 1686L20 1686L20 1093L677 1093L677 700L433 700Z");
  for (const [date, half] of [[FIRST_MONDAY, 1], [SECOND_DAY, 2]] as const) {
    const zone = points(REPAIR_LAYOUTS[half].zone);
    for (const room of ROOMS) {
      // The room's corners, pulled 3 units towards its label so a shared wall does not count.
      const corners = points(room.d).map(([x, y]): [number, number] => [x + Math.sign(room.labelX - x) * 3, y + Math.sign(room.labelY - y) * 3]);
      const closed = room.kind === "or" ? roomUse(room, date, REPAIR) === "closed" : recoveryAreaClosed(room, date, REPAIR);
      if (closed) assert.ok(inside([room.labelX, room.labelY], zone), `${room.id} is inside the half ${half} zone`);
      else assert.ok(corners.every((corner) => !inside(corner, zone)), `${room.id} is clear of the half ${half} zone`);
    }
  }
});

test("a booking's room follows the repair: own department's room, else the mixed-department room", () => {
  const room = (subtype: string | null, date: string) => {
    const placed = bookingRoom(subtype, "Operation", date, REPAIR, "dept");
    return placed.ok ? placed.roomId : null;
  };
  assert.equal(room("GENSX", FIRST_MONDAY), "or-12");
  assert.equal(room("ORTHO", FIRST_MONDAY), "or-13");
  assert.equal(room("URO", FIRST_MONDAY), "or-11");
  assert.equal(room("NEURO", FIRST_MONDAY), "or-11");
  assert.equal(room("GENSX", FIRST_LAST), "or-12", "the first half's last day");
  assert.equal(room("GENSX", SECOND_DAY), "or-5");
  assert.equal(room("ORTHO", SECOND_DAY), "or-2");
  assert.equal(room("EYE", SECOND_DAY), "or-4");
  assert.equal(room(null, SECOND_DAY), null);
  // Room codes that are not departments go to the mixed room: an elective booking never takes the emergency room.
  for (const code of ["EMER", "INFECT", "MINOR", "MIXED", "UNK", "ANES"]) assert.equal(room(code, FIRST_MONDAY), "or-11", code);
  assert.equal(room("URO", PAST_MONDAY), "or-11", "a past day: the first half's mixed room, never the weekly schedule's");
  // never a recovery, instrument or closed room
  for (const date of [FIRST_MONDAY, SECOND_DAY]) {
    for (const subtype of Object.keys(DEPARTMENTS)) {
      const id = room(subtype, date);
      if (id) assert.equal(roomUse(id, date, REPAIR), "open", `${subtype} on ${date}: ${id}`);
    }
  }
});

test("an added case in a room not operating that day stays off the board", () => {
  const added = (id: string, roomId: string): AddedCase => ({
    id,
    date: SECOND_DAY,
    roomId,
    hn: "1",
    operation: "x",
    shift: "in",
    dressing: null,
    scrubDoes: null,
    note: "",
    surgeonId: "1",
    surgeon: "ก ข",
    subtype: "GENSX",
  });
  const board = { key: "wed" as const, name: "Wednesday" as const, date: SECOND_DAY, operations: [] };
  const ops = withAddedCases(board, [added("1", "or-5"), added("2", "or-6"), added("3", "or-9")], REPAIR).operations;
  assert.deepEqual(ops.map((item) => item.roomId), ["or-5"]);
});

function weekOf(days: string[], cases: Partial<WeekCase>[]): WeekFile {
  return {
    meta: { days, rows: 0, kept: 0, dropped: {} },
    cases: cases.map((item) => ({
      day: 0, dept: null, surgeon: "สมชาย กลับกลาย", title: "นพ.", proc: "x", status: "done",
      shift: null, emergency: false, ...item,
    })),
  };
}

test("imported cases follow the repair's rooms", () => {
  const cases: Partial<WeekCase>[] = [
    { proc: "Dressing wound", dept: "ORTHO" },
    { dept: "GENSX" },
    { dept: "ORTHO" },
    { dept: "EYE" }, // no room of its own: the mixed-department room
    { emergency: true, dept: "URO" },
    { emergency: true, dept: "NEURO" }, // the half's own room for NEURO and CVT (OR 12 and 13 tie: the first)
    { dept: "OBGYN" }, // operates in the obstetric building: not on the board
  ];
  const first = weekBoard(weekOf(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"], cases), REPAIR)[0];
  assert.deepEqual(first.operations.map((item) => item.roomId), ["or-10", "or-12", "or-13", "or-11", "or-9", "or-12"]);
  const second = weekBoard(weekOf(["2027-02-01", "2027-02-02", "2027-02-03", "2027-02-04", "2027-02-05"], cases), REPAIR)[0];
  assert.deepEqual(second.operations.map((item) => item.roomId), ["or-1", "or-5", "or-2", "or-4", "or-3", "or-2"]);
});

test("the board is dated on its own day even when the loaded export is from another week", () => {
  const cases: Partial<WeekCase>[] = [{ day: 1, dept: "GENSX" }, { day: 1, dept: "EYE" }];
  // An export of 2-6 Nov 2026 still loaded on Tuesday 17 Nov and Tuesday 2 Feb.
  const stale = weekOf(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"], cases);
  const first = boardFor("2026-11-17", REPAIR, undefined, stale)!;
  assert.equal(first.date, "2026-11-17");
  assert.deepEqual(first.operations.map((item) => item.roomId), ["or-12", "or-11"]);
  const second = boardFor("2027-02-02", REPAIR, undefined, stale)!;
  assert.equal(second.date, "2027-02-02");
  assert.deepEqual(second.operations.map((item) => item.roomId), ["or-5", "or-4"]);
  // After the repair (Pong, 21 Nov 2026): the weekly schedule's rooms again, GENSX in OR 2 and EYE in OR 10.
  const after = boardFor("2027-03-23", REPAIR, undefined, stale)!;
  assert.equal(repairOn(after.date, REPAIR), null);
  assert.deepEqual(after.operations.map((item) => item.roomId).sort(), ["or-10", "or-2"].sort());
  // weekBoard alone still dates the export's own week.
  assert.equal(weekBoard(stale, REPAIR)[1].date, "2026-11-03");
});

test("an admin's dates are checked: four real dates, each half in order, the second after the first", () => {
  const good = { half1: { from: "2026-11-14", to: "2027-01-26" }, half2: { from: "2027-01-27", to: "2027-03-17" } };
  assert.deepEqual(checkRepairPeriods(good), { ok: true, periods: { ...good, mode: "auto" } });
  assert.deepEqual(checkRepairPeriods({ half1: { from: " 2026-11-14 ", to: "2027-01-26" }, half2: good.half2 }), {
    ok: true,
    periods: { ...good, mode: "auto" },
  });
  const error = (input: unknown) => {
    const checked = checkRepairPeriods(input);
    return checked.ok ? "ok" : checked.error;
  };
  assert.equal(error(null), "ใส่วันที่ให้ครบทั้ง 4 ช่อง");
  assert.equal(error({ half1: good.half1, half2: { from: "", to: "2027-03-17" } }), "ใส่วันที่ให้ครบทั้ง 4 ช่อง");
  assert.equal(error({ half1: good.half1, half2: { from: 5, to: "2027-03-17" } }), "ใส่วันที่ให้ครบทั้ง 4 ช่อง");
  for (const bad of ["2027-02-30", "27-01-27", "2570-01-27", "1999-12-31", "2027-1-27"]) {
    assert.equal(error({ half1: good.half1, half2: { from: bad, to: "2027-03-17" } }), "วันที่ไม่ถูกต้อง เลือกจากปฏิทิน", bad);
  }
  assert.equal(error({ half1: { from: "2027-01-27", to: "2027-01-26" }, half2: good.half2 }), "ช่วงที่ 1: วันเริ่มอยู่หลังวันสุดท้าย");
  assert.equal(error({ half1: good.half1, half2: { from: "2027-03-18", to: "2027-03-17" } }), "ช่วงที่ 2: วันเริ่มอยู่หลังวันสุดท้าย");
  assert.equal(error({ half1: good.half1, half2: { from: "2027-01-26", to: "2027-03-17" } }), "ช่วงที่ 2 ต้องเริ่มหลังช่วงที่ 1 จบ");
  assert.equal(error({ half1: { from: "2026-11-14", to: "2026-11-14" }, half2: { from: "2026-12-01", to: "2026-12-01" } }), "ok", "one-day halves and a gap");
});

test("room numbers read as short ranges", () => {
  assert.equal(numberRanges([6, 7, 8, 10, 12, 13]), "6–8, 10, 12–13");
});
