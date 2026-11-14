import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCase, roomForSubtype, withAddedCases, type AddedCase } from "./added-cases.ts";
import { allocationFor, DEPARTMENTS, readableTextOn } from "./allocation.ts";
import {
  checkRepairPeriods,
  DEFAULT_REPAIR_PERIODS,
  INSTRUMENT_USE,
  REPAIR_COLOR,
  REPAIR_IN_USE,
  REPAIR_LAYOUTS,
  repairNote,
  repairOn,
  type RepairPeriods,
} from "./repair.ts";
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

// The planned dates (Pong, 14 Nov 2026): first half 14 Nov 2026 to 26 Jan 2027, second half 27 Jan to 17 Mar 2027.
const REPAIR = DEFAULT_REPAIR_PERIODS;
const BEFORE = "2026-11-13"; // Friday
const FIRST_DAY = "2026-11-14"; // Saturday
const FIRST_MONDAY = "2026-11-16";
const FIRST_LAST = "2027-01-26"; // Tuesday
const SECOND_DAY = "2027-01-27"; // Wednesday
const SECOND_LAST = "2027-03-17"; // Wednesday
const AFTER = "2027-03-18"; // Thursday

test("the repair layout is on, with the planned dates as the default", () => {
  assert.equal(REPAIR_IN_USE, true);
  assert.deepEqual(DEFAULT_REPAIR_PERIODS, {
    half1: { from: "2026-11-14", to: "2027-01-26" },
    half2: { from: "2027-01-27", to: "2027-03-17" },
  });
  assert.equal(repairOn(BEFORE, REPAIR), null);
  assert.equal(repairOn(FIRST_DAY, REPAIR)?.half, 1);
  assert.equal(repairOn(FIRST_LAST, REPAIR)?.half, 1);
  assert.equal(repairOn(SECOND_DAY, REPAIR)?.half, 2);
  assert.equal(repairOn(SECOND_LAST, REPAIR)?.half, 2);
  assert.equal(repairOn(AFTER, REPAIR), null);
  assert.equal(repairOn("2026-11-1", REPAIR), null);
  assert.equal(repairOn(null, REPAIR), null);
  assert.equal(repairOn(undefined, REPAIR), null);
  const half = repairOn(FIRST_DAY, REPAIR)!;
  assert.deepEqual([half.from, half.to], ["2026-11-14", "2027-01-26"]);
});

test("the dates an admin saved decide, not the defaults; a gap between the halves is the weekly schedule", () => {
  const moved: RepairPeriods = { half1: { from: "2026-12-01", to: "2026-12-31" }, half2: { from: "2027-01-05", to: "2027-02-05" } };
  assert.equal(repairOn(FIRST_DAY, moved), null);
  assert.equal(repairOn("2026-12-01", moved)?.half, 1);
  assert.equal(repairOn("2027-01-02", moved), null, "between the halves");
  assert.equal(repairOn("2027-01-05", moved)?.half, 2);
  assert.equal(repairOn("2027-02-06", moved), null);
  assert.equal(roomUse("or-2", "2027-01-04", moved), "open");
  assert.equal(allocationFor("or-4", "2027-01-04", moved)?.am?.code, "OBGYN", "Monday's OR 4 from the weekly schedule");
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
  assert.equal(unusedRoomsText(BEFORE, REPAIR), "", "outside the repair every OR is open");
  assert.deepEqual(REPAIR_LAYOUTS[2].emergencyRooms, ["or-2"], "NEURO and CVT emergencies: OR 2");
  assert.equal(INSTRUMENT_USE.label, "เครื่องมือ");
});

test("recovery, instrument and closed rooms cannot be opened on the plan", () => {
  assert.equal(isSelectableRoom(getRoom("or-7")!, FIRST_MONDAY, REPAIR), false);
  assert.equal(isRecoveryUse(getRoom("or-7")!, FIRST_MONDAY, REPAIR), true);
  assert.equal(isRecoveryUse(getRoom("or-7")!, BEFORE, REPAIR), false);
  assert.equal(isSelectableRoom(getRoom("or-6")!, SECOND_DAY, REPAIR), false);
  assert.equal(isInstrumentUse(getRoom("or-6")!, SECOND_DAY, REPAIR), true);
  assert.equal(isInstrumentUse(getRoom("or-6")!, FIRST_MONDAY, REPAIR), false);
  assert.equal(isSelectableRoom(getRoom("or-12")!, FIRST_MONDAY, REPAIR), true);
  assert.equal(isSelectableRoom(getRoom("or-2")!, FIRST_MONDAY, REPAIR), false);
  assert.equal(isSelectableRoom(getRoom("or-2")!, SECOND_DAY, REPAIR), true);
  assert.equal(roomUse("r-1", FIRST_MONDAY, REPAIR), "closed", "the recovery area is not an OR");
  assert.equal(roomUse("nope", FIRST_MONDAY, REPAIR), "closed");
  assert.equal(recoveryAreaClosed("r-1", BEFORE, REPAIR), false);
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
  assert.equal(readableTextOn(REPAIR_COLOR), "#ffffff", "recovery and instrument rooms keep the repair's brown");

  assert.equal(allocationFor("or-12", "2026-11-21", REPAIR), null, "Saturday");
  assert.equal(allocationFor("or-4", "2026-11-09", REPAIR)?.repair, false);
  assert.equal(allocationFor("or-4", "2026-11-09", REPAIR)?.am?.code, "OBGYN", "the weekly schedule before the repair");
  assert.equal(allocationFor("or-4", "2027-03-22", REPAIR)?.am?.code, "OBGYN", "and after it");
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

test("bookings only go to rooms that operate on the chosen day", () => {
  const ok = { hn: "123", operation: "ORIF radius", shift: "in" };
  const today = "2027-01-15";
  assert.equal(checkCase({ ...ok, date: FIRST_LAST, roomId: "or-12" }, today, REPAIR).ok, true);
  assert.equal(checkCase({ ...ok, date: FIRST_LAST, roomId: "or-2" }, today, REPAIR).ok, false);
  assert.equal(checkCase({ ...ok, date: SECOND_DAY, roomId: "or-2" }, today, REPAIR).ok, true);
  assert.equal(checkCase({ ...ok, date: SECOND_DAY, roomId: "or-12" }, today, REPAIR).ok, false);

  const recovery = checkCase({ ...ok, date: FIRST_LAST, roomId: "or-7" }, today, REPAIR);
  assert.ok(!recovery.ok);
  assert.match(recovery.error, /ห้องพักฟื้น/);
  const instrument = checkCase({ ...ok, date: SECOND_DAY, roomId: "or-6" }, today, REPAIR);
  assert.ok(!instrument.ok);
  assert.match(instrument.error, /เครื่องมือ/);
  const closed = checkCase({ ...ok, date: SECOND_DAY, roomId: "or-9" }, today, REPAIR);
  assert.ok(!closed.ok);
  assert.match(closed.error, /ปิด/);
});

test("a doctor's room follows the repair: own department's room, else the mixed-department room", () => {
  assert.equal(roomForSubtype("GENSX", FIRST_MONDAY, REPAIR), "or-12");
  assert.equal(roomForSubtype("ORTHO", FIRST_MONDAY, REPAIR), "or-13");
  assert.equal(roomForSubtype("URO", FIRST_MONDAY, REPAIR), "or-11");
  assert.equal(roomForSubtype("NEURO", FIRST_MONDAY, REPAIR), "or-11");
  assert.equal(roomForSubtype("GENSX", SECOND_DAY, REPAIR), "or-5");
  assert.equal(roomForSubtype("ORTHO", SECOND_DAY, REPAIR), "or-2");
  assert.equal(roomForSubtype("EYE", SECOND_DAY, REPAIR), "or-4");
  assert.equal(roomForSubtype(null, SECOND_DAY, REPAIR), null);
  assert.equal(roomForSubtype("URO", "2026-11-11", REPAIR), "or-7", "before the repair, the weekly schedule's room");
});

test("an added case in a room not operating that day stays off the board", () => {
  const added = (id: string, roomId: string): AddedCase => ({
    id,
    date: SECOND_DAY,
    roomId,
    hn: "1",
    operation: "x",
    shift: "in",
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
  // An export of 2-6 Nov 2026 (before the repair) still loaded on Tuesday 17 Nov and Tuesday 2 Feb.
  const stale = weekOf(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"], cases);
  const first = boardFor("2026-11-17", REPAIR, undefined, stale)!;
  assert.equal(first.date, "2026-11-17");
  assert.deepEqual(first.operations.map((item) => item.roomId), ["or-12", "or-11"]);
  const second = boardFor("2027-02-02", REPAIR, undefined, stale)!;
  assert.equal(second.date, "2027-02-02");
  assert.deepEqual(second.operations.map((item) => item.roomId), ["or-5", "or-4"]);
  // After the repair: back to the weekly schedule in all 13 rooms.
  const after = boardFor("2027-03-23", REPAIR, undefined, stale)!;
  assert.equal(repairOn(after.date, REPAIR), null);
  assert.deepEqual(after.operations.map((item) => item.roomId), ["or-2", "or-10"], "EYE back in OR 10");
  // weekBoard alone still dates the export's own week.
  assert.equal(weekBoard(stale, REPAIR)[1].date, "2026-11-03");
});

test("the board's note names the half and its last day", () => {
  assert.equal(repairNote(repairOn(FIRST_DAY, REPAIR)!), "ปิดซ่อมห้องผ่าตัด ช่วงที่ 1 · ถึง 26 ม.ค. 2570");
  assert.equal(repairNote(repairOn(SECOND_DAY, REPAIR)!), "ปิดซ่อมห้องผ่าตัด ช่วงที่ 2 · ถึง 17 มี.ค. 2570");
  assert.equal(numberRanges([6, 7, 8, 10, 12, 13]), "6–8, 10, 12–13");
});

test("an admin's dates are checked: four real dates, each half in order, the second after the first", () => {
  const good = { half1: { from: "2026-11-14", to: "2027-01-26" }, half2: { from: "2027-01-27", to: "2027-03-17" } };
  assert.deepEqual(checkRepairPeriods(good), { ok: true, periods: good });
  assert.deepEqual(checkRepairPeriods({ half1: { from: " 2026-11-14 ", to: "2027-01-26" }, half2: good.half2 }), { ok: true, periods: good });
  const error = (input: unknown) => {
    const checked = checkRepairPeriods(input);
    return checked.ok ? "ok" : checked.error;
  };
  assert.equal(error(null), "ใส่วันที่ให้ครบทั้ง 4 ช่อง");
  assert.equal(error({ half1: good.half1, half2: { from: "", to: "2027-03-17" } }), "ใส่วันที่ให้ครบทั้ง 4 ช่อง");
  assert.equal(error({ half1: good.half1, half2: { from: 5, to: "2027-03-17" } }), "ใส่วันที่ให้ครบทั้ง 4 ช่อง");
  for (const bad of ["2027-02-30", "27-01-27", "2570-01-27", "1999-12-31", "2027-1-27"]) {
    assert.equal(error({ half1: good.half1, half2: { from: bad, to: "2027-03-17" } }), "วันที่ไม่ถูกต้อง เลือกจากปฏิทินอีกครั้ง", bad);
  }
  assert.equal(error({ half1: { from: "2027-01-27", to: "2027-01-26" }, half2: good.half2 }), "ช่วงที่ 1: วันเริ่มต้องไม่หลังวันสิ้นสุด");
  assert.equal(error({ half1: good.half1, half2: { from: "2027-03-18", to: "2027-03-17" } }), "ช่วงที่ 2: วันเริ่มต้องไม่หลังวันสิ้นสุด");
  assert.equal(error({ half1: good.half1, half2: { from: "2027-01-26", to: "2027-03-17" } }), "ช่วงที่ 2 ต้องเริ่มหลังวันสุดท้ายของช่วงที่ 1");
  assert.equal(error({ half1: { from: "2026-11-14", to: "2026-11-14" }, half2: { from: "2026-12-01", to: "2026-12-01" } }), "ok", "one-day halves and a gap");
});
