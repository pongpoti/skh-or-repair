"use client";

import { useEffect, useRef, useState, type JSX, type KeyboardEvent, type MouseEvent } from "react";
import { addDays, thaiDate, todayIso } from "@/lib/days";

/** What the calendar shows for one day: whether it can be picked, and why not (a holiday's name, or the weekend). */
export type DayState = { disabled: boolean; note?: string };

const MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
] as const;
const MONTHS_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."] as const;

/** Sunday first, as Thai wall calendars are: the short name shown, the full name read out. */
export const WEEKDAYS = [
  ["อา", "วันอาทิตย์"],
  ["จ", "วันจันทร์"],
  ["อ", "วันอังคาร"],
  ["พ", "วันพุธ"],
  ["พฤ", "วันพฤหัสบดี"],
  ["ศ", "วันศุกร์"],
  ["ส", "วันเสาร์"],
] as const;

/** The keys that move focus between days. Enter and Space need no handling: they click the focused day's button. */
const MOVE_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

/** Never walk further than two years looking for a day that can be picked. */
const MAX_WALK = 732;

const labels = new Map<string, string>();

/** `thaiDate(iso)`, kept once made: building its two Intl formatters for 42 days on every render is slow on cheap phones. */
export function dayLabel(iso: string): string {
  let label = labels.get(iso);
  if (label === undefined) {
    label = thaiDate(iso);
    labels.set(iso, label);
  }
  return label;
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

function isoOf(year: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, from the date itself (UTC), never from the phone's time zone. */
function weekday(iso: string): number {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** `month` (YYYY-MM) moved by `months`. */
export function shiftMonth(month: string, months: number): string {
  const [y, m] = parts(`${month}-01`);
  return isoOf(y, m - 1 + months, 1).slice(0, 7);
}

/** The same day of the month `months` away, or that month's last day when it is shorter (31 Jan → 28 Feb). */
function addMonths(iso: string, months: number): string {
  const [y, m, d] = parts(iso);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return isoOf(y, m - 1 + months, Math.min(d, last));
}

/**
 * The first day that can be picked, walking from `start` towards `limit` by `step` days, never outside min..max; null
 * when there is none.
 */
function walk(start: string, step: number, limit: string, min: string, max: string, pickable: (iso: string) => boolean): string | null {
  const forward = step > 0;
  let iso = forward ? (start < min ? min : start) : start > max ? max : start;
  const end = forward ? (limit < max ? limit : max) : limit > min ? limit : min;
  for (let n = 0; n < MAX_WALK && (forward ? iso <= end : iso >= end); n++, iso = addDays(iso, step)) {
    if (pickable(iso)) return iso;
  }
  return null;
}

/** The calendar's title for a YYYY-MM month, with the Buddhist year: "2026-11" gives "พฤศจิกายน 2569". Exported for tests. */
export function thaiMonthTitle(month: string): string {
  const [y, m] = parts(`${month}-01`);
  return `${MONTHS[m - 1]} ${y + 543}`;
}

/**
 * The days of a YYYY-MM month laid out in weeks from Sunday, as YYYY-MM-DD, with null for the blanks before the 1st
 * and after the last day. Its length is a whole number of weeks (four to six). Exported for tests.
 */
export function monthGrid(month: string): (string | null)[] {
  const first = `${month}-01`;
  const [y, m] = parts(first);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: weekday(first) }, () => null);
  for (let d = 1; d <= days; d++) cells.push(isoOf(y, m - 1, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/**
 * Where a key moves the calendar's focus from the day `from`, or null to stay put. Days that cannot be picked are
 * stepped over in the key's direction, since a disabled button cannot take focus: the right arrow on a Friday lands on
 * Monday, the down arrow on a holiday lands a week later. Home and End go to the first and last day of the week that can
 * be picked, PageUp and PageDown to the same day a month away (or the nearest day after it that can be picked). Nothing
 * leaves min..max. Exported for tests.
 */
export function keyTarget(from: string, key: string, min: string, max: string, pickable: (iso: string) => boolean): string | null {
  const go = (start: string, step: number, limit: string) => walk(start, step, limit, min, max, pickable);
  switch (key) {
    case "ArrowRight":
      return go(addDays(from, 1), 1, max);
    case "ArrowLeft":
      return go(addDays(from, -1), -1, min);
    case "ArrowDown":
      return go(addDays(from, 7), 7, max);
    case "ArrowUp":
      return go(addDays(from, -7), -7, min);
    case "Home":
      return go(addDays(from, -weekday(from)), 1, from);
    case "End":
      return go(addDays(from, 6 - weekday(from)), -1, from);
    case "PageDown": {
      const target = addMonths(from, 1);
      return go(target, 1, max) ?? go(addDays(target, -1), -1, addDays(from, 1));
    }
    case "PageUp": {
      const target = addMonths(from, -1);
      return go(target, -1, min) ?? go(addDays(target, 1), 1, addDays(from, -1));
    }
    default:
      return null;
  }
}

function CalendarIcon() {
  // Lucide "calendar".
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-muted">
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}

function Chevron({ to }: { to: "left" | "right" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={to === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}

/**
 * A month calendar in Thai with the Buddhist year (‹ month › and a grid of days from Sunday), on its own: the booking
 * form's date field opens it under the field, and the board's date picker shows it in a floating card. Days outside
 * min..max or that `dayState` disables cannot be picked; a disabled weekday with a note is taken to be a holiday, marked
 * with a dot and named under the grid (Pong, 15 Nov 2026: "for special holiday, disable click and remark underneath
 * calendar. Use reference from BOT holiday API"). A month of a year the Bank of Thailand gave no holidays for says so
 * there too, since its holidays cannot be closed. The keyboard works as in the ARIA date picker pattern. It opens on the picked
 * day's month (before a day is picked, on the first day that can be picked); `focusOnOpen` moves the focus to that day,
 * for a calendar opened by the keyboard, since script focus after a tap still draws the focus ring in Chrome. All date
 * math is on YYYY-MM-DD strings as UTC dates, so the phone's time zone never moves a day.
 *
 * Each day is a 44px tall button a seventh of the calendar wide. The browser keeps a modal dialog 2em + 6px narrower
 * than the screen, so on a 360px phone the dialog's content is 280px and a day is 38px wide (40px at 375px, 42px at
 * 390px); its circle shrinks with it and stays round.
 */
export function ThaiCalendar({
  id,
  value,
  min,
  max,
  dayState,
  onPick,
  onEscape,
  focusOnOpen = false,
  revealOnOpen = false,
  testId,
  className = CALENDAR_LOOK,
  today: givenToday,
  unlisted = [],
}: {
  /** The calendar's id; its month title is `${id}-title`. */
  id: string;
  /** The picked day, YYYY-MM-DD, or "" before one is picked. */
  value: string;
  min: string;
  max: string;
  dayState: (iso: string) => DayState;
  onPick: (iso: string) => void;
  /** Escape inside the calendar, kept from the dialog around it; left to the dialog when not given. */
  onEscape?: () => void;
  focusOnOpen?: boolean;
  /** Scroll the calendar into view once drawn (it opens inside a scrolling form). */
  revealOnOpen?: boolean;
  testId?: string;
  className?: string;
  /** Today in Thailand, YYYY-MM-DD, by the server's clock; the phone's own date when left out. */
  today?: string;
  /** The years (Gregorian) the BOT gave no holidays for (lib/holidays.ts holidaysBetween), named under their months. */
  unlisted?: readonly number[];
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = `${id}-title`;
  const inRange = (iso: string) => iso >= min && iso <= max;
  const pickable = (iso: string) => inRange(iso) && !dayState(iso).disabled;

  // The picked day's month; before a day is picked, the month of the first day that can be picked.
  const [start] = useState(() => {
    const shown = monthOf(value || min);
    return value && pickable(value)
      ? value
      : (walk(`${shown}-01`, 1, `${shown}-31`, min, max, pickable) ?? walk(min, 1, max, min, max, pickable));
  });
  const [month, setMonth] = useState(() => (value || !start ? monthOf(value || min) : monthOf(start)));
  // The day that keeps keyboard focus in the grid (roving tabindex), while it is in the month shown.
  const [focused, setFocused] = useState<string | null>(start);
  // What to focus once the calendar has been drawn (a CSS selector inside it), and whether to scroll it into view first.
  const focusNext = useRef<string | null>(start && focusOnOpen ? `[data-date="${start}"]` : null);
  const revealNext = useRef(revealOnOpen);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const reveal = revealNext.current;
    revealNext.current = false;
    if (reveal) panel.scrollIntoView({ block: "nearest" });
    const selector = focusNext.current;
    focusNext.current = null;
    if (selector) panel.querySelector<HTMLElement>(selector)?.focus({ preventScroll: reveal });
  });

  function onPanelKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !onEscape) return;
    // Escape would also close a dialog around the calendar: this one only does what its owner says.
    event.preventDefault();
    event.stopPropagation();
    onEscape();
  }

  function onGridKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!MOVE_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    const from = (event.target as HTMLElement).closest<HTMLElement>("[data-date]")?.dataset.date;
    if (!from) return;
    event.preventDefault();
    const to = keyTarget(from, event.key, min, max, pickable);
    if (!to || to === from) return;
    setFocused(to);
    // A day of the month shown takes the focus now, so it moves even when the state is unchanged and nothing re-renders.
    const shown = panelRef.current?.querySelector<HTMLElement>(`[data-date="${to}"]`);
    if (shown) {
      shown.focus();
      return;
    }
    setMonth(monthOf(to));
    focusNext.current = `[data-date="${to}"]`;
  }

  function showMonth(next: string, event: MouseEvent<HTMLButtonElement>) {
    setMonth(next);
    // A focused button that turns disabled drops focus to the page; the other one takes it instead.
    const button = event.currentTarget.dataset.nav;
    const atEdge = button === "prev" ? next <= monthOf(min) : next >= monthOf(max);
    if (atEdge && document.activeElement === event.currentTarget) {
      focusNext.current = `[data-nav="${button === "prev" ? "next" : "prev"}"]`;
    }
  }

  const cells = monthGrid(month);
  const states = new Map<string, DayState>();
  // A day outside the range cannot be picked, but keeps its note: a holiday just before the first day that can be
  // booked is still named, which says why the days around it are closed.
  for (const iso of cells) if (iso) states.set(iso, inRange(iso) ? dayState(iso) : { disabled: true, note: dayState(iso).note });
  const canPick = (iso: string) => states.get(iso)?.disabled === false;
  // A disabled weekday with a note: weekends are disabled every week and need no mark.
  const holidayNote = (iso: string) => {
    const state = states.get(iso);
    const day = weekday(iso);
    return state?.disabled && state.note && day !== 0 && day !== 6 ? state.note : null;
  };
  const days = cells.filter((iso): iso is string => iso !== null);
  const tabDay =
    [focused, value].find((iso): iso is string => !!iso && monthOf(iso) === month && canPick(iso)) ?? days.find(canPick) ?? null;
  const today = givenToday ?? todayIso();
  const holidays = days.flatMap((iso) => {
    const note = holidayNote(iso);
    return note ? [{ iso, note }] : [];
  });
  const weeks = Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
  const year = Number(month.slice(0, 4));
  const noHolidays = unlisted.includes(year);

  return (
    <div ref={panelRef} id={id} role="group" aria-label="ปฏิทิน" onKeyDown={onPanelKey} className={className} data-testid={testId}>
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          data-nav="prev"
          className="btn btn-ghost size-11 min-h-0 shrink-0 rounded-full p-0"
          aria-label="เดือนก่อนหน้า"
          disabled={month <= monthOf(min)}
          onClick={(event) => showMonth(shiftMonth(month, -1), event)}
        >
          <Chevron to="left" />
        </button>
        <p id={titleId} aria-live="polite" className="text-base font-bold text-ink">
          {thaiMonthTitle(month)}
        </p>
        <button
          type="button"
          data-nav="next"
          className="btn btn-ghost size-11 min-h-0 shrink-0 rounded-full p-0"
          aria-label="เดือนถัดไป"
          disabled={month >= monthOf(max)}
          onClick={(event) => showMonth(shiftMonth(month, 1), event)}
        >
          <Chevron to="right" />
        </button>
      </div>
      <div role="grid" aria-labelledby={titleId} onKeyDown={onGridKey} className="mt-1">
        <div role="row" className="grid grid-cols-7">
          {WEEKDAYS.map(([short, long], index) => (
            <span
              key={short}
              role="columnheader"
              aria-label={long}
              className={`flex h-8 items-center justify-center text-xs font-semibold ${index === 0 || index === 6 ? "text-muted" : "text-ink"}`}
            >
              {short}
            </span>
          ))}
        </div>
        {weeks.map((week, row) => (
          <div key={row} role="row" className="grid grid-cols-7">
            {week.map((iso, column) => {
              if (!iso) return <span key={`blank-${column}`} role="gridcell" />;
              const enabled = canPick(iso);
              const selected = iso === value;
              const note = states.get(iso)?.note;
              const holiday = holidayNote(iso) !== null;
              const face = selected
                ? "bg-brand font-bold text-white"
                : enabled
                  ? "font-semibold text-ink group-hover:bg-brand-tint"
                  : "text-muted/55";
              return (
                <span key={iso} role="gridcell">
                  <button
                    type="button"
                    data-date={iso}
                    tabIndex={iso === tabDay ? 0 : -1}
                    disabled={!enabled}
                    aria-label={!enabled && note ? `${dayLabel(iso)}, ${note}` : dayLabel(iso)}
                    aria-pressed={selected || undefined}
                    aria-current={iso === today ? "date" : undefined}
                    onClick={() => onPick(iso)}
                    // Raised while focused, so the next day's filled circle does not cover its focus ring.
                    className="group relative flex h-11 w-full cursor-pointer items-center justify-center rounded-xl focus-visible:z-10 disabled:cursor-default"
                  >
                    {/* Up to 40px, and never wider than the column: 38px on a 360px phone, still a circle. */}
                    <span
                      className={`relative flex aspect-square w-full max-w-10 items-center justify-center rounded-full text-[0.9375rem] tabular-nums motion-safe:transition-colors ${face} ${iso === today && !selected ? "ring-[1.5px] ring-brand ring-inset" : ""}`}
                    >
                      {Number(iso.slice(8))}
                      {holiday ? (
                        <span aria-hidden="true" className="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-[var(--stop)]" />
                      ) : null}
                    </span>
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>

      {holidays.length > 0 || monthOf(today) === month || noHolidays ? (
        <ul className="mt-1.5 space-y-0.5 border-t border-line px-1.5 pt-2 pb-1 text-xs text-muted">
          {monthOf(today) === month ? (
            <li className="flex items-center gap-2">
              <span aria-hidden="true" className="-mx-[3px] size-3 shrink-0 rounded-full ring-[1.5px] ring-brand ring-inset" />
              วันนี้
            </li>
          ) : null}
          {holidays.map(({ iso, note }) => {
            const [, m, d] = parts(iso);
            return (
              <li key={iso} className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--stop)]" />
                <span className="min-w-0">
                  <span className="tabular-nums">
                    {d} {MONTHS_SHORT[m - 1]}
                  </span>{" "}
                  {note}
                </span>
              </li>
            );
          })}
          {noHolidays ? (
            <li className="flex items-start gap-2" data-testid={testId ? `${testId}-unlisted` : undefined}>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="-mx-[3px] mt-[3px] size-3 shrink-0"
              >
                {/* Lucide "info" (https://lucide.dev, ISC licence, Copyright (c) Lucide Contributors). */}
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              <span className="min-w-0">ยังไม่มีวันหยุดปี {year + 543} จากธนาคารแห่งประเทศไทย</span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/** The calendar's own look under a field: a white card with a soft shadow that slides in. */
const CALENDAR_LOOK =
  "mt-2 scroll-my-3 rounded-2xl border border-line bg-white p-1.5 shadow-[var(--shadow-md)] min-[420px]:p-2.5 motion-safe:transition-[opacity,translate] motion-safe:duration-150 motion-safe:starting:-translate-y-1 motion-safe:starting:opacity-0";

/**
 * The surgery date as a field that is shown and picked in Thai, whatever language the phone is set to: the native date
 * input follows the phone's language, so an English iPhone showed "16 Nov BE 2569". The field shows the day written
 * out ("วันอังคารที่ 17 พฤศจิกายน 2569") and opens ThaiCalendar right under it. The calendar sits in the page, pushing
 * what follows down, rather than floating over it, so the booking dialog's scroll carries it and never clips it.
 * Escape closes the calendar without closing the dialog around it. A tap opens the calendar with the focus left on the
 * field, so no focus ring shows; Enter or Space on the field moves the focus to the picked day (or the first one that
 * can be picked).
 */
export function ThaiDateField({
  id,
  value,
  onChange,
  min,
  max,
  dayState,
  invalid = false,
  describedBy,
  testId,
  today,
  unlisted,
}: {
  /** For the parent's <label htmlFor>, which names the field. */
  id: string;
  /** YYYY-MM-DD, or "" before a day is picked. */
  value: string;
  onChange: (iso: string) => void;
  /** The first day that can be picked, YYYY-MM-DD. */
  min: string;
  /** The last day that can be picked, YYYY-MM-DD. */
  max: string;
  /** Asked for each day between min and max, e.g. weekends and holidays disabled with the holiday's name as the note. */
  dayState: (iso: string) => DayState;
  invalid?: boolean;
  describedBy?: string;
  /** On the field button (with data-value); the calendar gets `${testId}-calendar`. */
  testId?: string;
  /** Today in Thailand, YYYY-MM-DD, by the server's clock; the phone's own date when left out. */
  today?: string;
  /** The years the BOT gave no holidays for, named under their months (ThaiCalendar). */
  unlisted?: readonly number[];
}): JSX.Element {
  const fieldRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Whether the keyboard opened the calendar, which moves the focus into it.
  const [byKey, setByKey] = useState(false);

  const panelId = `${id}-calendar`;
  const valueId = `${id}-value`;

  // The dialog stays mounted between bookings, so its closing folds the calendar away for the next time it opens.
  useEffect(() => {
    const dialog = fieldRef.current?.closest("dialog");
    if (!dialog) return;
    // The close event comes a task later: a dialog already opened again keeps the calendar it has.
    const fold = () => {
      if (!dialog.open) setOpen(false);
    };
    dialog.addEventListener("close", fold);
    return () => dialog.removeEventListener("close", fold);
  }, []);

  function close() {
    setOpen(false);
    fieldRef.current?.focus();
  }

  /** `key` when Enter or Space clicked the field (a click with no pointer has detail 0). */
  function toggle(key: boolean) {
    if (open) {
      setOpen(false);
      return;
    }
    setByKey(key);
    setOpen(true);
  }

  function pick(iso: string) {
    onChange(iso);
    close();
  }

  return (
    <div>
      <button
        ref={fieldRef}
        id={id}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        // A button cannot be aria-invalid (ARIA 1.2), so the day it holds is described as not right instead.
        data-invalid={invalid || undefined}
        aria-describedby={[valueId, describedBy].filter(Boolean).join(" ")}
        onClick={(event) => toggle(event.detail === 0)}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !open) return;
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }}
        className="field field-text mt-1.5 flex cursor-pointer items-center gap-2 text-left aria-expanded:border-brand data-invalid:border-[var(--stop)] data-invalid:shadow-[inset_0_0_0_1px_var(--stop)]"
        data-testid={testId}
        data-value={value}
      >
        {/* The parent's label names the button, so the day it holds is read as its description. */}
        {/* A long day can take two lines on a 360px phone: balanced, so the year is not left alone on the second. */}
        <span id={valueId} className={`min-w-0 flex-1 text-balance ${value ? "text-ink" : "text-muted"}`}>
          {value ? thaiDate(value) : "เลือกวันที่ผ่าตัด"}
          {invalid ? <span className="sr-only"> (ไม่ถูกต้อง)</span> : null}
        </span>
        <CalendarIcon />
      </button>
      <input type="hidden" name="date" value={value} />

      {open ? (
        <ThaiCalendar
          id={panelId}
          value={value}
          min={min}
          max={max}
          dayState={dayState}
          onPick={pick}
          onEscape={close}
          focusOnOpen={byKey}
          revealOnOpen
          testId={testId ? `${testId}-calendar` : undefined}
          today={today}
          unlisted={unlisted}
        />
      ) : null}
    </div>
  );
}
