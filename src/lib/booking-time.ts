/**
 * A booking's time on its day (Pong, 27 Nov 2026: "redesign user to select time (time range 8.30 to 15.30) on day view
 * of calendar (just like in google calendar app) then show form input"). Times are minutes after midnight, Thailand
 * time, on 15-minute steps between 08:30 and 15:30 (in hours: a booking is ในเวลา). Isomorphic: the form, the server
 * actions and the board all use it.
 */

/** 08:30, the first minute a booking can start. */
export const DAY_START = 8 * 60 + 30;
/** 15:30, the last minute a booking can end. */
export const DAY_END = 15 * 60 + 30;
/** The step a time moves by, on the day view and in the checks. */
export const TIME_STEP = 15;
/** How long a new booking lasts when the doctor taps a time, as Google Calendar's new event does. */
export const DEFAULT_LENGTH = 60;

export type TimeRange = { start: number; end: number };

/** "08:30" for 510. */
export function clockText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "08:30–09:30" for a booking's time. */
export function rangeText(time: TimeRange): string {
  return `${clockText(time.start)}–${clockText(time.end)}`;
}

/** "1 ชม. 30 นาที", how long a time lasts. */
export function lengthText(time: TimeRange): string {
  const minutes = time.end - time.start;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} นาที`;
  return rest === 0 ? `${hours} ชม.` : `${hours} ชม. ${rest} นาที`;
}

export const TIME_MISSING_TEXT = "เลือกเวลาผ่าตัด";
const TIME_WRONG_TEXT = "เวลาไม่ถูกต้อง เลือกใหม่";
/** A time another booking in the same room already has. */
export const TIME_TAKEN_TEXT = "เวลานี้มีการจองแล้ว เลือกเวลาอื่น";

const isStep = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value % TIME_STEP === 0 && value >= DAY_START && value <= DAY_END;

/**
 * Checks a time from the form: a start and an end on the 15-minute steps, from 08:30 to 15:30, the end after the start.
 * Both missing is no time ("none").
 */
export function checkTime(start: unknown, end: unknown): { ok: true; time: TimeRange } | { ok: true; time: null } | { ok: false; error: string } {
  const blank = (value: unknown) => value === undefined || value === null;
  if (blank(start) && blank(end)) return { ok: true, time: null };
  if (blank(start) || blank(end)) return { ok: false, error: TIME_MISSING_TEXT };
  if (!isStep(start) || !isStep(end) || end <= start) return { ok: false, error: TIME_WRONG_TEXT };
  return { ok: true, time: { start, end } };
}

/** Whether two times share any minute (one ending as the other starts is no overlap). */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * The bookings already in the rooms the day view shows, each room's as its times: one room, or a department's rooms that
 * day, when the server still picks one of them. A time is free when one of the rooms has all of it free (a department
 * with two rooms can still take a case while one of them is free, but not one that needs a bit of each).
 */
export type RoomTimes = readonly (readonly TimeRange[])[];

/** Whether `time` fits whole in one of the rooms (with no room to look at, every time does). */
export function isFree(time: TimeRange, rooms: RoomTimes): boolean {
  return rooms.length === 0 || rooms.some((times) => !times.some((range) => overlaps(range, time)));
}

/**
 * The free stretch around `time`: from the end of the booking before it (or 08:30) to the start of the next (or 15:30),
 * in each room that has `time` free, joined (each of them can take any time within its own stretch). A time no room has
 * free (kept from another day) looks at every room, past the bookings it overlaps.
 */
function stretch(time: TimeRange, rooms: RoomTimes): TimeRange {
  const all: RoomTimes = rooms.length === 0 ? [[]] : rooms;
  const fits = all.filter((times) => !times.some((range) => overlaps(range, time)));
  let out: TimeRange | null = null;
  for (const times of fits.length > 0 ? fits : all) {
    const before = times.filter((range) => range.end <= time.start).reduce((max, range) => Math.max(max, range.end), DAY_START);
    const after = times.filter((range) => range.start >= time.end).reduce((min, range) => Math.min(min, range.start), DAY_END);
    out = out ? { start: Math.min(out.start, before), end: Math.max(out.end, after) } : { start: before, end: after };
  }
  return out ?? { start: DAY_START, end: DAY_END };
}

/**
 * The time a tap at `minute` gives (Google Calendar's new event): from that 30-minute slot, or from its second half when
 * the first is taken, lasting DEFAULT_LENGTH or up to the next booking or 15:30. Null when nothing from there is free.
 */
export function tapTime(minute: number, rooms: RoomTimes, length = DEFAULT_LENGTH): TimeRange | null {
  const slot = DAY_START + Math.floor((minute - DAY_START) / 30) * 30;
  for (const start of [slot, slot + TIME_STEP]) {
    if (start < DAY_START || start >= DAY_END) continue;
    const first = { start, end: start + TIME_STEP };
    if (!isFree(first, rooms)) continue;
    return { start, end: Math.min(start + length, stretch(first, rooms).end) };
  }
  return null;
}

const snap = (minute: number) => Math.round(minute / TIME_STEP) * TIME_STEP;

/**
 * A picked time with one edge, or the whole of it, dragged by `delta` minutes (snapped to TIME_STEP), kept within 08:30
 * to 15:30, at least TIME_STEP long, and clear of the bookings on either side (a drag never jumps over a booking).
 */
export function dragTime(time: TimeRange, edge: "start" | "end" | "move", delta: number, rooms: RoomTimes): TimeRange {
  const free = stretch(time, rooms);
  const moved = snap(delta);
  if (edge === "start") return { start: Math.min(Math.max(time.start + moved, free.start), time.end - TIME_STEP), end: time.end };
  if (edge === "end") return { start: time.start, end: Math.max(Math.min(time.end + moved, free.end), time.start + TIME_STEP) };
  const length = time.end - time.start;
  const start = Math.min(Math.max(time.start + moved, free.start), free.end - length);
  return { start, end: start + length };
}

/**
 * The start and end lists above the day view (Pong, 27 Nov 2026: "it is hard to expand time range (hard to click and to
 * select)"): every 15 minutes from 08:30, a start being free when its first quarter hour is, an end when the whole time
 * from the start is. A taken one stays in the list, disabled, so a time kept from another day still shows.
 */
export function startChoices(rooms: RoomTimes): { minute: number; free: boolean }[] {
  const out: { minute: number; free: boolean }[] = [];
  for (let minute = DAY_START; minute < DAY_END; minute += TIME_STEP) {
    out.push({ minute, free: isFree({ start: minute, end: minute + TIME_STEP }, rooms) });
  }
  return out;
}

export function endChoices(start: number, rooms: RoomTimes): { minute: number; free: boolean }[] {
  const out: { minute: number; free: boolean }[] = [];
  for (let minute = start + TIME_STEP; minute <= DAY_END; minute += TIME_STEP) {
    out.push({ minute, free: isFree({ start, end: minute }, rooms) });
  }
  return out;
}

/**
 * The time a new start in the list gives: `length` long (the time's own length by default, an hour when nothing was
 * picked), cut short by the next booking or 15:30; a quarter hour when the start itself is taken.
 */
export function startAt(
  time: TimeRange | null,
  start: number,
  rooms: RoomTimes,
  length = time ? time.end - time.start : DEFAULT_LENGTH,
): TimeRange {
  const first = { start, end: start + TIME_STEP };
  if (!isFree(first, rooms)) return first;
  return { start, end: Math.max(first.end, Math.min(start + length, stretch(first, rooms).end)) };
}

/**
 * Lanes for times that overlap, as Google Calendar sets events side by side: each time's lane and how many lanes its
 * group of overlapping times needs. Taken in order of start, longest first on a tie.
 */
export function lanes<T extends TimeRange>(times: readonly T[]): { item: T; lane: number; of: number }[] {
  const sorted = [...times].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: { item: T; lane: number; of: number }[] = [];
  let group: { item: T; lane: number; of: number }[] = [];
  let groupEnd = -1;
  const close = () => {
    const of = group.reduce((max, entry) => Math.max(max, entry.lane + 1), 1);
    for (const entry of group) entry.of = of;
    out.push(...group);
    group = [];
  };
  for (const item of sorted) {
    if (group.length > 0 && item.start >= groupEnd) close();
    const used = new Set(group.filter((entry) => entry.item.end > item.start).map((entry) => entry.lane));
    let lane = 0;
    while (used.has(lane)) lane += 1;
    group.push({ item, lane, of: 1 });
    groupEnd = Math.max(groupEnd, item.end);
  }
  if (group.length > 0) close();
  return out;
}
