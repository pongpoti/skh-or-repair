import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanNote, MAX_NOTE } from "./added-cases.ts";
import { allocationFor } from "./allocation.ts";
import { buildBoardRows } from "./board-rows.ts";
import { addDays } from "./days.ts";
import { DEMO_MIN_CASES, demoBoardRows, demoDay, demoSchedule } from "./demo-schedule.ts";
import { isDressingOperation } from "./dressing.ts";
import { isWorkday } from "./holidays.ts";
import { DEFAULT_REPAIR_PERIODS, REPAIR_LAYOUTS, repairOn, type RepairPeriods } from "./repair.ts";
import { openRooms, roomUse } from "./rooms.ts";

const MX = { allHn: true, userId: null };
// The dates an admin might move the halves to, besides the planned ones.
const MOVED: RepairPeriods = { half1: { from: "2026-12-01", to: "2026-12-30" }, half2: { from: "2027-01-04", to: "2027-02-26" } };

/** Workdays (weekdays) from `from` to `to`, every `step` days. */
function weekdays(from: string, to: string, step = 1): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, step)) if (isWorkday(day, [])) days.push(day);
  return days;
}

function board(date: string, periods: RepairPeriods) {
  const { workbook, bookings } = demoSchedule(date, periods);
  return { workbook, bookings, built: buildBoardRows({ date, periods, workbook, bookings, viewer: MX }) };
}

test("the demo puts 10 to 12 cases in every open room, on every weekday of both halves, under any dates", () => {
  for (const periods of [DEFAULT_REPAIR_PERIODS, MOVED]) {
    for (const [half, { from, to }] of [[1, periods.half1], [2, periods.half2]] as const) {
      const days = weekdays(from, to);
      assert.ok(days.length > 20, `${half}: ${days.length} days`);
      for (const date of days) {
        const { built } = board(date, periods);
        const open = openRooms(date, periods).map((room) => room.id);
        // Every OR the half operates in: its department rooms, the dressing room, the emergency and the mixed room.
        const layout = Object.entries(REPAIR_LAYOUTS[half].rooms).filter(([, use]) => use !== "RR" && use !== "INSTR");
        assert.deepEqual(open.toSorted(), layout.map(([id]) => id).toSorted(), `${date}: the half's rooms`);
        for (const room of open) {
          const count = built.countByRoom[room] ?? 0;
          assert.ok(count >= DEMO_MIN_CASES && count <= DEMO_MIN_CASES + 2, `${date} ${room}: ${count} cases`);
        }
        // Nothing in a recovery room, the instrument room or a closed room.
        for (const row of built.rows) assert.equal(roomUse(row.roomId, date, periods), "open", `${date}: ${row.roomId}`);
        assert.equal(Object.keys(built.countByRoom).length, open.length, `${date}: rooms with cases`);
      }
    }
  }
});

test("on any weekday, before, between and after the halves too (no weekly schedule), every open room has 10", () => {
  // Dates an admin may save with a gap from 5 Dec 2026 to 3 Jan 2027: the first half's rooms stay until the second
  // starts (Pong, 18 Nov 2026: "forget normal day OR schedule"), so every day is a day of the repair.
  const GAP: RepairPeriods = { half1: { from: "2026-11-14", to: "2026-12-04" }, half2: { from: "2027-01-04", to: "2027-03-17" } };
  const nobody = { allHn: false, userId: null };
  for (const periods of [DEFAULT_REPAIR_PERIODS, MOVED, GAP]) {
    let outside = 0;
    for (const date of weekdays("2026-11-02", "2027-04-30")) {
      const built = demoBoardRows(date, periods, MX);
      const rooms = openRooms(date, periods).filter((room) => allocationFor(room.id, date, periods) !== null);
      for (const room of rooms) {
        const count = built.countByRoom[room.id] ?? 0;
        assert.ok(count >= DEMO_MIN_CASES, `${date} ${room.id}: ${count} cases`);
        const rows = built.rows.filter((row) => row.roomId === room.id);
        assert.deepEqual(rows.map((row) => row.order), rows.map((_, i) => i + 1), `${date} ${room.id}: numbered 1 to ${count}`);
        // Dressing names only in the dressing room, so the board's own rule would agree with where they are.
        const dressing = allocationFor(room.id, date, periods)?.am?.code === "INFECT";
        assert.ok(rows.every((row) => isDressingOperation(row.procedure) === dressing), `${date} ${room.id}: dressing names`);
      }
      assert.equal(new Set(built.rows.map((row) => row.id)).size, built.rows.length, `${date}: unique row ids`);
      if (repairOn(date, periods)) {
        // In the repair the board's own rules alone give every room its cases: nothing is added straight in a room.
        assert.ok(!built.rows.some((row) => row.id.includes("-extra-")), `${date}: no added rows in the repair`);
      } else {
        outside += 1;
        // Outside it, an added row shows its HN only to whoever may see every HN.
        const plain = demoBoardRows(date, periods, nobody);
        assert.ok(plain.rows.every((row) => row.hn === undefined), `${date}: no HN for an ordinary viewer`);
      }
    }
    assert.equal(outside, 0, "no day outside the repair");
  }
});

test("the demo looks like a real day: matched and unbooked rows, booking times, every status, the out-of-hours shift", () => {
  for (const date of ["2026-11-17", "2027-02-02"]) {
    const { built, bookings } = board(date, DEFAULT_REPAIR_PERIODS);
    const sources = new Set(built.rows.map((row) => row.source));
    // No booking without its HOSxP case: after an upload the board leaves those off.
    assert.deepEqual([...sources].toSorted(), ["hosxp", "matched"], `${date}: sources`);
    assert.deepEqual(built.unmatched, [], `${date}: every booking matches`);
    assert.ok(built.uploaded, "as after MX's upload");
    // Each booking has its time, oldest first as the database lists them, and the booked cases come first in each room.
    assert.ok(bookings.every((booking) => booking.bookedAt && booking.bookedAt < `${date}T00:00`), `${date}: booked before the day`);
    assert.deepEqual(bookings.map((booking) => booking.bookedAt), bookings.map((booking) => booking.bookedAt).toSorted());
    assert.ok(built.rows.every((row) => (row.source === "matched") === (row.bookedAt !== undefined)), `${date}: a time on every booked row`);
    for (const room of openRooms(date, DEFAULT_REPAIR_PERIODS)) {
      const sources = built.rows.filter((row) => row.roomId === room.id).map((row) => row.source);
      assert.deepEqual(sources, sources.toSorted((a, b) => Number(a === "hosxp") - Number(b === "hosxp")), `${date} ${room.id}: booked first`);
    }
    // The ! marks show in some rooms, not all.
    const flagged = Object.keys(built.mismatchByRoom);
    const open = openRooms(date, DEFAULT_REPAIR_PERIODS);
    assert.ok(flagged.length > 0 && flagged.length < open.length, `${date}: flagged rooms ${flagged}`);
    assert.ok(built.rows.filter((row) => row.source === "matched").length > built.rows.length * 0.7, "most rows match a booking");
    const statuses = new Set(built.rows.map((row) => row.status));
    for (const status of ["scheduled", "in-progress", "recovery", "delayed", "done", "cancelled"] as const) {
      assert.ok(statuses.has(status), `${date}: a ${status} case`);
    }
    assert.ok(built.rows.some((row) => row.shift === "out"), `${date}: an out-of-hours case`);
    // The dressing room: dressing names only, and who does each dressing, both the doctor and the scrub.
    const dressingRoom = open.find((room) => built.rows.some((row) => row.roomId === room.id && row.doneBy !== undefined));
    assert.ok(dressingRoom, `${date}: the dressing room's rows say who does the dressing`);
    const dressings = built.rows.filter((row) => row.roomId === dressingRoom.id);
    assert.ok(dressings.every((row) => isDressingOperation(row.procedure)), `${date}: dressing names in ${dressingRoom.id}`);
    assert.ok(dressings.every((row) => row.doneBy !== undefined), `${date}: every dressing row`);
    assert.deepEqual(new Set(dressings.map((row) => row.doneBy)), new Set(["scrub", "surgeon"]));
    assert.ok(built.rows.every((row) => (row.roomId === dressingRoom.id) === (row.doneBy !== undefined)), `${date}: only there`);
    // Only dressing-room bookings carry an answer.
    assert.ok(bookings.every((booking) => (booking.scrubDoes === null) === !booking.dressing));
    // Some rows show a note (หมายเหตุ), as the form would have saved it; most rooms have one.
    const noted = built.rows.filter((row) => row.note);
    assert.ok(noted.length >= open.length, `${date}: ${noted.length} notes`);
    assert.ok(noted.some((row) => row.note?.includes("\n")), `${date}: a note over several lines`);
    assert.ok(bookings.every((booking) => booking.note === cleanNote(booking.note) && booking.note.length <= MAX_NOTE), `${date}: notes as saved`);
  }
});

test("every case is made up: HNs in the 99 range, ตัวอย่าง surgeons, no obstetrics, the same cases on every reload", () => {
  const date = "2026-11-18";
  const { workbook, bookings } = demoSchedule(date, DEFAULT_REPAIR_PERIODS);
  for (const item of workbook) {
    assert.match(item.hn, /^99\d{5}$/);
    assert.match(item.surgeon, /^(นพ\.|พญ\.) ตัวอย่าง \S+$/);
    assert.notEqual(item.dept, "OBGYN");
  }
  for (const booking of bookings) {
    assert.match(booking.hn ?? "", /^99\d{5}$/);
    assert.match(booking.surgeon, /^ตัวอย่าง \S+$/);
    assert.equal(booking.date, date);
  }
  const ids = [...workbook.map((item) => item.caseId), ...bookings.map((booking) => `bk-${booking.id}`)];
  assert.equal(new Set(workbook.map((item) => item.caseId)).size, workbook.length, "unique case ids");
  assert.equal(new Set(bookings.map((booking) => booking.id)).size, bookings.length, "unique booking ids");
  assert.ok(ids.length > 0);
  assert.deepEqual(demoSchedule(date, DEFAULT_REPAIR_PERIODS), { workbook, bookings }, "stable");
  // Another day has its own mix.
  const other = demoSchedule("2026-11-19", DEFAULT_REPAIR_PERIODS);
  assert.notDeepEqual(other.workbook.map((item) => item.operation), workbook.map((item) => item.operation));
  // A weekend has no open room, so no cases.
  assert.deepEqual(demoSchedule("2026-11-21", DEFAULT_REPAIR_PERIODS), { workbook: [], bookings: [] });
});

test("demoDay: the board's own day in its half, else the half's first workday from today on, within the picker", () => {
  const periods = DEFAULT_REPAIR_PERIODS; // 14 Nov 2026 – 26 Jan 2027, then 27 Jan – 17 Mar 2027
  const holidays = [{ date: "2027-01-27", name: "วันหยุดทดสอบ" }];
  const max = periods.half2.to;
  // Sunday 15 Nov: the board shows Monday 16 Nov, in the first half.
  const sunday = { today: "2026-11-15", boardDate: "2026-11-16", max, periods, holidays };
  assert.equal(demoDay(1, sunday), "2026-11-16");
  // The second half starts on a (made-up) holiday Wednesday: its first workday is Thursday.
  assert.equal(demoDay(2, sunday), "2027-01-28");
  // In the second half, the first half is over.
  const late = { today: "2027-02-01", boardDate: "2027-02-01", max, periods, holidays: [] };
  assert.equal(demoDay(1, late), null);
  assert.equal(demoDay(2, late), "2027-02-01");
  // Not past the picker's last day.
  assert.equal(demoDay(2, { ...sunday, max: "2027-01-27" }), null);
  // From 16:00 on the last day of the first half, the board shows the second half: today is still the first half's.
  const turnover = { today: "2027-01-26", boardDate: "2027-01-28", max, periods, holidays };
  assert.equal(demoDay(1, turnover), "2027-01-26");
  assert.equal(demoDay(2, turnover), "2027-01-28");
});
