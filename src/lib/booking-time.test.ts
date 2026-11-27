import assert from "node:assert/strict";
import { test } from "node:test";
import {
  busyTimes,
  checkTime,
  clockText,
  DAY_END,
  DAY_START,
  dragTime,
  endChoices,
  isFree,
  lanes,
  lengthText,
  overlaps,
  rangeText,
  startAt,
  startChoices,
  tapTime,
} from "./booking-time.ts";

const at = (text: string) => {
  const [h, m] = text.split(":").map(Number);
  return h * 60 + m;
};
const range = (from: string, to: string) => ({ start: at(from), end: at(to) });

test("times are written as a clock and a range", () => {
  assert.equal(clockText(DAY_START), "08:30");
  assert.equal(clockText(DAY_END), "15:30");
  assert.equal(rangeText(range("09:00", "10:45")), "09:00–10:45");
  assert.equal(lengthText(range("09:00", "09:45")), "45 นาที");
  assert.equal(lengthText(range("09:00", "11:00")), "2 ชม.");
  assert.equal(lengthText(range("09:00", "10:30")), "1 ชม. 30 นาที");
});

test("a time is on 15-minute steps from 08:30 to 15:30, ending after it starts", () => {
  assert.deepEqual(checkTime(at("08:30"), at("09:30")), { ok: true, time: range("08:30", "09:30") });
  assert.deepEqual(checkTime(at("14:45"), at("15:30")), { ok: true, time: range("14:45", "15:30") });
  assert.deepEqual(checkTime(undefined, null), { ok: true, time: null });
  assert.equal(checkTime(at("09:00"), undefined).ok, false);
  for (const [start, end] of [
    [at("08:15"), at("09:00")],
    [at("15:00"), at("15:45")],
    [at("09:00"), at("09:00")],
    [at("10:00"), at("09:00")],
    [at("09:05"), at("10:00")],
    ["540", "600"],
    [540.5, 600],
  ]) {
    assert.equal(checkTime(start, end).ok, false, `${start}-${end}`);
  }
});

test("times overlap when they share a minute", () => {
  assert.equal(overlaps(range("09:00", "10:00"), range("09:45", "10:30")), true);
  assert.equal(overlaps(range("09:00", "10:00"), range("10:00", "10:30")), false);
  assert.equal(overlaps(range("09:00", "12:00"), range("10:00", "10:30")), true);
});

test("one room's taken times are its bookings, merged; several rooms' only where all are taken", () => {
  assert.deepEqual(busyTimes([[range("09:00", "10:00"), range("10:00", "11:00"), range("13:00", "13:30")]]), [range("09:00", "11:00"), range("13:00", "13:30")]);
  assert.deepEqual(busyTimes([[range("09:00", "11:00")], [range("10:00", "12:00")]]), [range("10:00", "11:00")]);
  assert.deepEqual(busyTimes([[range("09:00", "11:00")], []]), []);
  assert.deepEqual(busyTimes([]), []);
  assert.equal(isFree(range("11:00", "12:00"), [range("09:00", "11:00")]), true);
  assert.equal(isFree(range("10:45", "12:00"), [range("09:00", "11:00")]), false);
});

test("a tap gives an hour from its half-hour slot, cut short by the next booking or 15:30", () => {
  assert.deepEqual(tapTime(at("09:10"), []), range("09:00", "10:00"));
  assert.deepEqual(tapTime(at("15:05"), []), range("15:00", "15:30"));
  assert.deepEqual(tapTime(at("09:00"), [range("09:30", "10:00")]), range("09:00", "09:30"));
  // the slot's first half taken: from its second half
  assert.deepEqual(tapTime(at("09:20"), [range("08:30", "09:15")]), range("09:15", "10:15"));
  // all taken: nothing
  assert.equal(tapTime(at("09:20"), [range("08:30", "10:00")]), null);
});

test("a drag snaps to 15 minutes and stops at the bookings on either side", () => {
  const busy = [range("08:30", "09:00"), range("11:00", "12:00")];
  const time = range("09:30", "10:30");
  assert.deepEqual(dragTime(time, "end", 22, busy), range("09:30", "10:45"));
  assert.deepEqual(dragTime(time, "end", 200, busy), range("09:30", "11:00"));
  assert.deepEqual(dragTime(time, "end", -200, busy), range("09:30", "09:45"));
  assert.deepEqual(dragTime(time, "start", -60, busy), range("09:00", "10:30"));
  assert.deepEqual(dragTime(time, "start", 120, busy), range("10:15", "10:30"));
  assert.deepEqual(dragTime(time, "move", 30, busy), range("10:00", "11:00"));
  assert.deepEqual(dragTime(time, "move", 300, busy), range("10:00", "11:00"));
  assert.deepEqual(dragTime(time, "move", -300, busy), range("09:00", "10:00"));
  // nothing taken: the day's ends
  assert.deepEqual(dragTime(range("15:00", "15:30"), "move", 60, []), range("15:00", "15:30"));
  assert.deepEqual(dragTime(range("08:30", "09:00"), "start", -60, []), range("08:30", "09:00"));
});

test("overlapping times take lanes side by side", () => {
  const a = { ...range("09:00", "10:00"), id: "a" };
  const b = { ...range("09:30", "10:30"), id: "b" };
  const c = { ...range("10:00", "11:00"), id: "c" };
  const d = { ...range("13:00", "14:00"), id: "d" };
  const out = Object.fromEntries(lanes([c, b, a, d]).map((entry) => [entry.item.id, [entry.lane, entry.of]]));
  assert.deepEqual(out, { a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
});

test("the start and end lists: every 15 minutes, a taken one disabled; a new start keeps the length up to the next booking", () => {
  const busy = [range("10:00", "11:00"), range("13:00", "13:30")];
  const starts = startChoices(busy);
  assert.equal(starts.length, 28, "08:30 to 15:15");
  assert.deepEqual(starts[0], { minute: at("08:30"), free: true });
  assert.deepEqual(starts.at(-1), { minute: at("15:15"), free: true });
  const takenStarts = starts.filter((choice) => !choice.free).map((choice) => clockText(choice.minute));
  assert.deepEqual(takenStarts, ["10:00", "10:15", "10:30", "10:45", "13:00", "13:15"]);
  // from 09:00: free up to the booking at 10:00, taken past it
  const ends = endChoices(at("09:00"), busy);
  assert.deepEqual(ends[0], { minute: at("09:15"), free: true });
  assert.deepEqual(ends.at(-1), { minute: DAY_END, free: false });
  assert.deepEqual(
    ends.filter((choice) => choice.free).map((choice) => clockText(choice.minute)),
    ["09:15", "09:30", "09:45", "10:00"],
  );
  assert.deepEqual(endChoices(at("15:15"), []), [{ minute: DAY_END, free: true }], "the last quarter hour");
  // a new start: an hour when nothing was picked, the same length otherwise, cut short at the next booking or 15:30
  assert.deepEqual(startAt(null, at("08:30"), busy), range("08:30", "09:30"));
  assert.deepEqual(startAt(null, at("09:30"), busy), range("09:30", "10:00"));
  assert.deepEqual(startAt(range("08:30", "10:00"), at("11:00"), busy), range("11:00", "12:30"));
  assert.deepEqual(startAt(range("08:30", "10:00"), at("12:30"), busy), range("12:30", "13:00"));
  assert.deepEqual(startAt(range("08:30", "10:00"), at("15:00"), busy), { start: at("15:00"), end: DAY_END });
});
