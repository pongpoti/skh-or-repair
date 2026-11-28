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

const snap = (minute: number) => Math.round(minute / TIME_STEP) * TIME_STEP;

/*
 * Times overlap freely (Pong, 27 Nov 2026: "For time booking, allow time of each case to be freely overlapped"): the
 * bookings already in the room are shown on the day view, but none of them keeps a time from anyone. So the helpers
 * below only keep a time within 08:30 to 15:30 on the 15-minute steps.
 */

/**
 * The time a tap at `minute` gives (Google Calendar's new event): from that 30-minute slot, lasting DEFAULT_LENGTH or up
 * to 15:30.
 */
export function tapTime(minute: number, length = DEFAULT_LENGTH): TimeRange {
  const start = Math.min(Math.max(DAY_START + Math.floor((minute - DAY_START) / 30) * 30, DAY_START), DAY_END - TIME_STEP);
  return { start, end: Math.min(start + length, DAY_END) };
}

/**
 * A picked time with one edge, or the whole of it, dragged by `delta` minutes (snapped to TIME_STEP), kept within 08:30
 * to 15:30 and at least TIME_STEP long.
 */
export function dragTime(time: TimeRange, edge: "start" | "end" | "move", delta: number): TimeRange {
  const moved = snap(delta);
  if (edge === "start") return { start: Math.min(Math.max(time.start + moved, DAY_START), time.end - TIME_STEP), end: time.end };
  if (edge === "end") return { start: time.start, end: Math.max(Math.min(time.end + moved, DAY_END), time.start + TIME_STEP) };
  const length = time.end - time.start;
  const start = Math.min(Math.max(time.start + moved, DAY_START), DAY_END - length);
  return { start, end: start + length };
}

/**
 * The start and end lists above the day view (Pong, 27 Nov 2026: "it is hard to expand time range (hard to click and to
 * select)"): every 15 minutes from 08:30, the ends after the start up to 15:30.
 */
export function startChoices(): number[] {
  const out: number[] = [];
  for (let minute = DAY_START; minute < DAY_END; minute += TIME_STEP) out.push(minute);
  return out;
}

export function endChoices(start: number): number[] {
  const out: number[] = [];
  for (let minute = start + TIME_STEP; minute <= DAY_END; minute += TIME_STEP) out.push(minute);
  return out;
}

/**
 * The time a new start in the list gives: `length` long (the time's own length by default, an hour when nothing was
 * picked), cut short by 15:30.
 */
export function startAt(time: TimeRange | null, start: number, length = time ? time.end - time.start : DEFAULT_LENGTH): TimeRange {
  return { start, end: Math.max(start + TIME_STEP, Math.min(start + length, DAY_END)) };
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
