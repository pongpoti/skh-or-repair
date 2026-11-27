import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkTime,
  clockText,
  DAY_END,
  DAY_START,
  dragTime,
  endChoices,
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

test("a tap gives an hour from its half hour, up to 15:30, whatever is booked", () => {
  assert.deepEqual(tapTime(at("09:10")), range("09:00", "10:00"));
  assert.deepEqual(tapTime(at("15:05")), range("15:00", "15:30"));
  assert.deepEqual(tapTime(at("09:00"), 120), range("09:00", "11:00"));
});

test("a drag stays within 08:30 to 15:30 and at least a quarter hour long", () => {
  const time = range("09:30", "10:30");
  assert.deepEqual(dragTime(time, "end", 22), range("09:30", "10:45"));
  assert.deepEqual(dragTime(time, "end", 600), range("09:30", "15:30"));
  assert.deepEqual(dragTime(time, "end", -200), range("09:30", "09:45"));
  assert.deepEqual(dragTime(time, "start", -60), range("08:30", "10:30"));
  assert.deepEqual(dragTime(time, "start", 120), range("10:15", "10:30"));
  assert.deepEqual(dragTime(time, "move", 30), range("10:00", "11:00"));
  assert.deepEqual(dragTime(time, "move", 600), range("14:30", "15:30"));
  assert.deepEqual(dragTime(time, "move", -300), range("08:30", "09:30"));
});

test("every start and end is offered, and a new start keeps the length up to 15:30", () => {
  const starts = startChoices();
  assert.equal(starts[0], DAY_START);
  assert.equal(starts.at(-1), at("15:15"));
  assert.equal(starts.length, 28);
  assert.deepEqual(endChoices(at("15:15")), [DAY_END], "the last quarter hour");
  assert.equal(endChoices(at("09:00"))[0], at("09:15"));
  assert.deepEqual(startAt(null, at("08:30")), range("08:30", "09:30"));
  assert.deepEqual(startAt(range("08:30", "10:00"), at("11:00")), range("11:00", "12:30"));
  assert.deepEqual(startAt(range("08:30", "10:00"), at("15:00")), range("15:00", "15:30"));
  assert.deepEqual(startAt(range("09:30", "09:45"), at("11:00"), 60), range("11:00", "12:00"));
});

test("overlapping times take lanes side by side", () => {
  const a = { ...range("09:00", "10:00"), id: "a" };
  const b = { ...range("09:30", "10:30"), id: "b" };
  const c = { ...range("10:00", "11:00"), id: "c" };
  const d = { ...range("13:00", "14:00"), id: "d" };
  const out = Object.fromEntries(lanes([c, b, a, d]).map((entry) => [entry.item.id, [entry.lane, entry.of]]));
  assert.deepEqual(out, { a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
});

