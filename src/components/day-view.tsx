"use client";

import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { DaySlot } from "@/lib/added-cases";
import {
  busyTimes,
  clockText,
  DAY_END,
  DAY_START,
  dragTime,
  lanes,
  lengthText,
  rangeText,
  tapTime,
  TIME_STEP,
  type TimeRange,
} from "@/lib/booking-time";
import { getRoom, roomLabel } from "@/lib/rooms";

/** The height of half an hour on the grid, in CSS pixels: a slot is a comfortable tap. */
const HALF_HOUR = 44;
const PER_MINUTE = HALF_HOUR / 30;
const SLOTS = (DAY_END - DAY_START) / 30;
const HEIGHT = SLOTS * HALF_HOUR;
/** The hours' column on the left. */
const GUTTER = "3.25rem";

const top = (minute: number) => (minute - DAY_START) * PER_MINUTE;

type Drag = { edge: "start" | "end" | "move"; y: number; from: TimeRange; moved: boolean };

/**
 * The booking form's day view (Pong, 27 Nov 2026: "select time (time range 8.30 to 15.30) on day view of calendar (just
 * like in google calendar app) then show form input"): the day from 08:30 to 15:30 in half hours, the bookings already
 * in the room (`rooms`: one room, or a department's rooms that day, where a time is taken only when all of them are),
 * and the doctor's time: a tap on a free half hour gives an hour from there (cut short by the next booking or 15:30),
 * and its handles, or the time itself, drag in 15-minute steps, never over a booking (Pong, 27 Nov 2026: "No, a booked
 * time is taken"). The arrow keys move a handle, or the time, by 15 minutes. `selfId` is an edit's own booking, left
 * out. `readOnly`: a closed day's booking, whose time cannot change.
 */
export function DayView({
  slots,
  loading,
  rooms,
  selfId,
  value,
  onChange,
  readOnly = false,
  clash = false,
  invalid = false,
  describedBy,
}: {
  /** The day's bookings, every room's (app/(board)/actions.ts dayBookings); empty while they load. */
  slots: readonly DaySlot[];
  loading: boolean;
  rooms: readonly string[];
  selfId: string | null;
  value: TimeRange | null;
  onChange: (time: TimeRange | null) => void;
  readOnly?: boolean;
  /** The time overlaps a booking (kept from another day, or taken meanwhile): drawn as taken until another is picked. */
  clash?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const inRooms = slots.filter((slot) => rooms.includes(slot.roomId) && slot.id !== selfId);
  const timed = inRooms.filter((slot): slot is DaySlot & TimeRange => slot.start !== null && slot.end !== null);
  const untimed = inRooms.length - timed.length;
  const busy = busyTimes(rooms.map((room) => timed.filter((slot) => slot.roomId === room)));
  const several = rooms.length > 1;
  const drag = useRef<Drag | null>(null);

  function begin(edge: Drag["edge"], event: ReactPointerEvent<HTMLElement>) {
    if (!value || readOnly || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { edge, y: event.clientY, from: value, moved: false };
  }
  function move(event: ReactPointerEvent<HTMLElement>) {
    const now = drag.current;
    if (!now) return;
    const delta = (event.clientY - now.y) / PER_MINUTE;
    if (Math.abs(delta) >= TIME_STEP / 2) now.moved = true;
    const next = dragTime(now.from, now.edge, delta, busy);
    if (!value || next.start !== value.start || next.end !== value.end) onChange(next);
  }
  function end(event: ReactPointerEvent<HTMLElement>) {
    if (!drag.current) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function nudge(edge: Drag["edge"], event: KeyboardEvent<HTMLElement>) {
    if (!value || readOnly) return;
    const step = event.key === "ArrowUp" ? -TIME_STEP : event.key === "ArrowDown" ? TIME_STEP : 0;
    if (!step) return;
    event.preventDefault();
    onChange(dragTime(value, edge, step, busy));
  }

  const label = (roomId: string) => {
    const room = getRoom(roomId);
    return room ? roomLabel(room) : roomId;
  };

  return (
    <div data-testid="day-view" data-loading={loading || undefined} aria-busy={loading}>
      {untimed > 0 ? (
        <p className="mb-2 rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-ink-2" data-testid="day-untimed">
          จองไว้ไม่ระบุเวลา <span className="font-semibold tabular-nums">{untimed}</span> เคส
        </p>
      ) : null}
      <div
        className={`day-grid relative rounded-xl border bg-white ${invalid ? "border-[var(--stop)]" : "border-line"}`}
        style={{ height: HEIGHT + 24, "--half-hour": `${HALF_HOUR}px`, "--gutter": GUTTER } as React.CSSProperties}
        aria-describedby={describedBy}
      >
        {/* The half hours, each a tap target; the hours named on the left as Google Calendar's, and 08:30 where the day starts. */}
        <ol className="absolute inset-x-0 top-3" style={{ height: HEIGHT }} aria-label="ช่วงเวลา">
          {Array.from({ length: SLOTS }, (_, index) => {
            const start = DAY_START + index * 30;
            const free = tapTime(start, busy);
            return (
              <li
                key={start}
                className="day-slot absolute inset-x-0"
                style={{ top: index * HALF_HOUR, height: HALF_HOUR }}
                data-hour={start % 60 === 0 || undefined}
              >
                {start % 60 === 0 || start === DAY_START ? (
                  <span className="day-hour" aria-hidden="true">
                    {clockText(start)}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="day-slot-button"
                  disabled={readOnly || loading || free === null}
                  onClick={() => onChange(free)}
                  aria-label={free ? `เลือก ${rangeText(free)}` : `${clockText(start)} มีการจองแล้ว`}
                  data-testid="day-slot"
                  data-time={start}
                />
              </li>
            );
          })}
          <li className="day-slot day-slot-last absolute inset-x-0" style={{ top: HEIGHT, height: 0 }} aria-hidden="true">
            <span className="day-hour">{clockText(DAY_END)}</span>
          </li>
        </ol>

        {/* The bookings already there, side by side where they overlap (a department's two rooms). */}
        <div className="pointer-events-none absolute top-3 right-1.5" style={{ left: GUTTER, height: HEIGHT }}>
          {lanes(timed).map(({ item, lane, of }) => {
            const height = (item.end - item.start) * PER_MINUTE - 2;
            return (
              <div
                key={item.id}
                className={`day-booking${item.own ? " is-own" : ""}`}
                style={{ top: top(item.start) + 1, height, left: `${(lane / of) * 100}%`, width: `calc(${100 / of}% - 2px)` }}
                data-testid="day-booking"
                data-id={item.id}
                data-own={item.own || undefined}
                data-start={item.start}
                data-end={item.end}
              >
                <p className="truncate text-xs font-semibold tabular-nums">
                  {rangeText(item)}
                  {several ? ` · ${label(item.roomId)}` : null}
                  {height < 36 ? <span className="font-normal"> {item.operation}</span> : null}
                </p>
                {height >= 36 ? <p className="truncate text-xs">{item.operation}</p> : null}
                {height >= 52 ? <p className="truncate text-[0.6875rem] opacity-80">{item.own ? "ของคุณ" : item.surgeon}</p> : null}
              </div>
            );
          })}
        </div>

        {/* The doctor's time: dragged by its handles or itself. */}
        {value ? (
          <div
            className={`day-pick${readOnly ? " is-fixed" : ""}${clash ? " is-clash" : ""}`}
            style={{ top: top(value.start) + 12 + 1, height: (value.end - value.start) * PER_MINUTE - 2, left: GUTTER }}
            data-testid="day-pick"
            data-start={value.start}
            data-end={value.end}
            data-clash={clash || undefined}
          >
            <div
              role="button"
              tabIndex={readOnly ? -1 : 0}
              aria-label={`เวลาที่เลือก ${rangeText(value)}${clash ? " มีการจองแล้ว" : ""} ลูกศรขึ้นลงเพื่อเลื่อน`}
              className="day-pick-body"
              onPointerDown={(event) => begin("move", event)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onKeyDown={(event) => nudge("move", event)}
            >
              <p className="text-sm font-bold tabular-nums" data-testid="day-pick-time">
                {rangeText(value)}
              </p>
              {value.end - value.start >= 30 ? <p className="text-xs opacity-90">{lengthText(value)}</p> : null}
            </div>
            {readOnly ? null : (
              <>
                <button
                  type="button"
                  className="day-handle day-handle-start"
                  aria-label={`เวลาเริ่ม ${clockText(value.start)} ลูกศรขึ้นลงเพื่อปรับ`}
                  onPointerDown={(event) => begin("start", event)}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                  onKeyDown={(event) => nudge("start", event)}
                  data-testid="day-handle-start"
                />
                <button
                  type="button"
                  className="day-handle day-handle-end"
                  aria-label={`เวลาเลิก ${clockText(value.end)} ลูกศรขึ้นลงเพื่อปรับ`}
                  onPointerDown={(event) => begin("end", event)}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                  onKeyDown={(event) => nudge("end", event)}
                  data-testid="day-handle-end"
                />
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
