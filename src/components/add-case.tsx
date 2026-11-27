"use client";

import { useRouter } from "next/navigation";
import { flushSync } from "react-dom";
import { Fragment, useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import type { CaseResult, DayResult } from "@/app/(board)/actions";
import { BACK_ICON } from "@/components/booking-actions";
import { DayView } from "@/components/day-view";
import { HnField } from "@/components/hn-field";
import { InlineStatus } from "@/components/inline-status";
import { ThaiDateField, type DayState } from "@/components/thai-date-field";
import {
  addDays,
  ADMIN_BOOKING_RULE,
  atThaChalom,
  bookAheadDays,
  BOOKING_CUTOFF_PHRASES,
  bookableFrom,
  bookedAlready,
  bookedChoice,
  bookedRoom,
  checkCase,
  cleanOperation,
  closedDayNote,
  deptRooms,
  DRESSING_ROOM_NAME,
  earliestText,
  editRequeues,
  MAX_NOTE,
  MAX_OPERATION,
  NO_OPERATION_LABEL,
  NO_ROOM_NOTE,
  NOTE_ONLY_TEXT,
  placeBookingRoom,
  placeRoomName,
  POOLED_ROOM_NOTE,
  REQUEUE_TEXT,
  roomToBook,
  SCRUB_NO,
  SCRUB_QUESTION,
  SCRUB_YES,
  SAME_DAY_TEXT,
  scrubTag,
  timeOf,
  type AddedCase,
  type CaseField,
  type DaySlot,
  type RoomChoice,
} from "@/lib/added-cases";
import { lengthText, rangeText, TIME_MISSING_TEXT, type TimeRange } from "@/lib/booking-time";
import { allocationFor, readableTextOn, type Department } from "@/lib/allocation";
import { thaiDate } from "@/lib/days";
import { displayHn, normalizeHn } from "@/lib/hn";
import type { Holiday } from "@/lib/holidays";
import type { RepairPeriods } from "@/lib/repair";
import type { PlaceId } from "@/lib/places";
import { roomUse } from "@/lib/rooms";
import { thaChalomAllocation } from "@/lib/tha-chalom-schedule";
import { subtypeLabel } from "@/lib/user-labels";

const DIALOG_LOOK =
  "m-auto max-h-[calc(100dvh-1.5rem)] overflow-y-auto overscroll-contain rounded-[18px] border border-line bg-surface p-4 text-ink shadow-[0_24px_60px_rgb(41_29_20/0.3)] backdrop:bg-[rgb(36_28_22/0.35)] backdrop:backdrop-blur-[2px] min-[360px]:p-5 sm:p-6";
const DIALOG = `${DIALOG_LOOK} w-[min(32rem,calc(100%-1.5rem))]`;
/** The scrub question, a smaller dialog over the booking form. */
const QUESTION_DIALOG = `${DIALOG_LOOK} w-[min(24rem,calc(100%-2.5rem))]`;

const UNSAVED = "บันทึกไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่";
const DAY_UNREAD = "โหลดการจองไม่ได้ ลองใหม่";

const CHEVRON = (dir: "left" | "right") => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={dir === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
  </svg>
);

/** A picked radio: brown edge and tint. The input itself is visually hidden but still takes focus and arrow keys. */
const OPTION =
  "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-line-strong bg-white px-1 py-2 text-center transition-colors hover:border-brand has-checked:border-brand has-checked:bg-brand-tint has-checked:shadow-[inset_0_0_0_1px_var(--brand)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus has-disabled:cursor-not-allowed has-disabled:border-line has-disabled:bg-surface-2 has-disabled:text-muted has-disabled:hover:border-line";
/** An answer to the scrub question: the answer given before is marked like a picked option. */
const ANSWER =
  "flex min-h-14 items-center justify-center rounded-xl border border-line-strong bg-white px-2 py-3 text-center text-[0.9375rem] font-semibold text-ink transition-colors hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-pressed:border-brand aria-pressed:bg-brand-tint aria-pressed:shadow-[inset_0_0_0_1px_var(--brand)]";

export type Doctor = { name: string; subtype: string | null };

/**
 * How the booking form opens: a new booking (จองห้อง), or from the actions on one of the doctor's own bookings
 * (components/booking-actions.tsx): "edit" on that booking, its calendar open for a move (`focus: "date"`); "again", a
 * new booking of the same patient, room choice and note on another day.
 */
/** `back`, from a row's จัดการ sheet: the form's back arrow closes it and opens that sheet again. */
export type CaseRequest =
  | { mode: "new" }
  | { mode: "edit"; booking: AddedCase; focus: "details" | "date"; back?: () => void }
  | { mode: "again"; booking: AddedCase; back?: () => void };

function DeptTag({ dept }: { dept: Department | null }) {
  // A little larger than it was, 12px and 13px from 400px wide (Pong, 15 Nov 2026: "slight increase txt size of dept
  // badge").
  if (!dept) return <span className="text-xs leading-6 text-muted">ไม่จัดสรร</span>;
  return (
    <span
      className="chip min-h-0 px-1.5 py-0 text-xs leading-6 min-[400px]:px-2 min-[400px]:text-[0.8125rem]"
      style={{ "--chip": dept.color, color: readableTextOn(dept.color) } as CSSProperties}
      title={dept.name}
    >
      {dept.label}
    </span>
  );
}

/** The later of two YYYY-MM-DD days. */
const later = (a: string, b: string | null) => (b && b > a ? b : a);

/**
 * The doctor's booking of a room for one patient, in a dialog, in two steps (Pong, 27 Nov 2026: "select time (time range
 * 8.30 to 15.30) on day view of calendar (just like in google calendar app) then show form input"): first the day and the
 * time on a day view (components/day-view.tsx) that shows the bookings already in the room, whose times may overlap
 * freely (Pong, 27 Nov 2026: "allow time of each case to be freely overlapped"); then ต่อไป shows the rest, under the day and time with เปลี่ยน to go back. The time is
 * optional, behind a ระบุเวลา switch that starts off (Pong, 27 Nov 2026: "Add toggle time input : disable as default").
 *
 * The rest (Pong, 15 Nov 2026): the day, in Thai with a calendar
 * that offers only the days that can be booked (from the next workday, or the one after once 15:00 has passed, up to
 * 60 days ahead, never a weekend or holiday); the patient's 7-digit HN on its own card (the HOSxP workbook's case is
 * matched by it); the operation's name, required; the room, the doctor's own choice between their department's room
 * that day (OR X, picked to start with) and the dressing room (ห้องทำแผล; Pong, 15 Nov 2026: "let surgeon decide which
 * room to use"), each named with the room it is that day. There is no in or out of hours choice: a booking is saved as
 * ในเวลา (Pong, 15 Nov 2026). Picking the dressing room asks, in
 * a dialog over the form, whether the scrub nurse does the dressing for the doctor (Pong's "scrub ทำให้แทนไหม ?");
 * closing it unanswered puts the choice back on the department's room. Last, an optional note to the OR team (หมายเหตุ;
 * Pong, 17 Nov 2026), which everyone who opens the board sees on the booking's row, so the form says so and asks for
 * no patient's name or HN in it. The surgeon is always the signed-in doctor.
 * Below it, the doctor's own bookings from today on, with their HN and note, each one editable and cancellable. `request`
 * opens it.
 *
 * The same form edits one of the doctor's own bookings (Pong, 25 Nov 2026: "on DR case row : allow surgeon to edit, move
 * date, delete and other functions"), filled with it: แก้ไขการจอง, saved with บันทึก (app/(board)/actions.ts editCase). Its
 * day can move to any day that can be booked. Once 15:00 the day before its day has passed, only the note can change
 * there (the HN, the operation and the room are locked, and say so), unless the doctor moves it to an open day. A change
 * of day, room or HN puts the case at the back of the queue, which the form says under the note while it would. Booking
 * again (จองซ้ำวันอื่น) is a new booking filled with the same patient, room choice and note; it stays filled after a save,
 * so a series of days takes one tap each.
 */
export function AddCase({
  request,
  onClosed,
  doctor,
  today,
  earliest,
  admin = false,
  holidays,
  unlisted,
  periods,
  initialMine,
  onAdd,
  onEdit,
  onRemove,
  onDay,
  place = "skh",
}: {
  /** Set to a new object to open the dialog (CaseRequest). */
  request: CaseRequest | null;
  onClosed: () => void;
  doctor: Doctor;
  /** Today in Thailand, YYYY-MM-DD. */
  today: string;
  /** The first day that can be booked, by the server's clock (lib/added-cases.ts firstBookingDay). */
  earliest: string;
  /** An admin: no 15:00 cut-off (earliest is today) and a year ahead (lib/added-cases.ts bookAheadDays). */
  admin?: boolean;
  /** The holidays from today to 60 days ahead, closed in the calendar as on the server. */
  holidays: readonly Holiday[];
  /** The years in those 60 days the BOT gave no holidays for, named under the calendar. */
  unlisted: readonly number[];
  /** The repair's dates (lib/repair-store.ts), which decide the rooms open on each day. */
  periods: RepairPeriods;
  initialMine: readonly AddedCase[];
  onAdd: (input: unknown) => Promise<CaseResult>;
  onEdit: (id: string, input: unknown) => Promise<CaseResult>;
  onRemove: (id: string) => Promise<CaseResult>;
  /** The bookings of one day, every room's, for the day view (app/(board)/actions.ts dayBookings). */
  onDay: (date: string) => Promise<DayResult>;
  /**
   * The hospital booked at: รพ.สมุทรสาคร, or รพ.ท่าฉลอม (Pong, 27 Nov 2026: "Add booking btn on ท่าฉลอม also"), where a
   * doctor books only their department's room in its table that day (lib/added-cases.ts placeBookingRoom), with no
   * dressing room to pick.
   */
  place?: PlaceId;
}) {
  const tc = place === "tha-chalom";
  const ahead = bookAheadDays(admin);
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const hnRef = useRef<HTMLInputElement>(null);
  const operationRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<HTMLFieldSetElement>(null);
  const scrubRef = useRef<HTMLDialogElement>(null);
  // A later first day the server gave when 15:00 passed while the form was open, until the page brings its own.
  const [movedOn, setMovedOn] = useState<string | null>(null);
  // The page's own first day replaces it: after midnight, say, the first day can be earlier than the one the server
  // gave the evening before (Friday 15:00 gives Tuesday; Saturday gives Monday).
  const [prevEarliest, setPrevEarliest] = useState(earliest);
  if (prevEarliest !== earliest) {
    setPrevEarliest(earliest);
    setMovedOn(null);
  }
  const first = later(earliest, prevEarliest !== earliest ? null : movedOn);
  const [date, setDate] = useState(first);
  const [hn, setHn] = useState("");
  const [operation, setOperation] = useState("");
  const [note, setNote] = useState("");
  const [choice, setChoice] = useState<RoomChoice>("dept");
  // The answer to the scrub question, for the dressing room only; null until asked.
  const [scrubDoes, setScrubDoes] = useState<boolean | null>(null);
  // The field the shown error is about, marked for screen readers too, not only by the message.
  const [invalid, setInvalid] = useState<CaseField | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  // Which action the shown answer is about: a save's is said beside จองห้อง, a cancel's under the list it changed.
  const [about, setAbout] = useState<"save" | "remove">("save");
  const [mine, setMine] = useState<AddedCase[]>(() => [...initialMine]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // What the form is doing: a new booking, an edit of `editing` (as last saved), or booking a patient again.
  const [mode, setMode] = useState<CaseRequest["mode"]>("new");
  // An edit opened to move the booking (เลื่อนวัน), which the title says.
  const [moving, setMoving] = useState(false);
  // The back arrow of a form opened from a row's จัดการ sheet (CaseRequest `back`).
  const [back, setBack] = useState<(() => void) | null>(null);
  const [editing, setEditing] = useState<AddedCase | null>(null);
  // Opens the calendar (a move): a new object each time.
  const [calendarOpen, setCalendarOpen] = useState<object | null>(null);
  // The time picked on the day view (null until one is, and while the doctor gives none).
  const [time, setTime] = useState<TimeRange | null>(null);
  // Whether the doctor gives a time (Pong, 27 Nov 2026: "Add toggle time input : disable as default"): off for a new
  // booking, on for one that has a time. Turned off, the time is set aside here, and comes back if it is turned on again.
  const [timed, setTimed] = useState(false);
  const [timeKept, setTimeKept] = useState<TimeRange | null>(null);
  // The form's two steps: the day view, then the rest. `opened`: the one it opened on (an edit of a booking's details
  // opens on them, and its back arrow then goes to the row's sheet).
  const [step, setStep] = useState<"time" | "details">("time");
  const [opened, setOpened] = useState<"time" | "details">("time");
  // The day view's bookings by day, as last read; `version` reads them again (on each opening, and after a save).
  const [days, setDays] = useState<Record<string, { version: number; slots: DaySlot[]; error: string }>>({});
  const [version, setVersion] = useState(0);

  // The server's list wins whenever the page reloads (another device may have added or removed a case).
  const [prevInitial, setPrevInitial] = useState(initialMine);
  if (prevInitial !== initialMine) {
    setPrevInitial(initialMine);
    setMine([...initialMine]);
  }

  // An edit's own day, which needs no day checks and may be closed already (only the note changes there then).
  const keepsDay = mode === "edit" && editing !== null && date === editing.date;
  const locked = keepsDay && date < first;
  // Back on its closed day after picking another, or closed by 15:00 while open: the locked fields show the booking's
  // own again, and 15:00 says so when it took back what the doctor had typed.
  const [prevLocked, setPrevLocked] = useState(locked);
  const [prevLockFirst, setPrevLockFirst] = useState(first);
  if (prevLocked !== locked || prevLockFirst !== first) {
    setPrevLocked(locked);
    setPrevLockFirst(first);
    if (locked && !prevLocked && editing) {
      const picked = bookedChoice(editing, periods);
      const own = editing.hn ? displayHn(editing.hn) : "";
      const ownTime = timeOf(editing);
      const typed =
        normalizeHn(hn) !== normalizeHn(own) ||
        operation.trim() !== editing.operation ||
        choice !== picked ||
        time?.start !== ownTime?.start ||
        time?.end !== ownTime?.end;
      setHn(own);
      setOperation(editing.operation);
      setChoice(picked);
      setScrubDoes(picked === "dressing" && typeof editing.scrubDoes === "boolean" ? editing.scrubDoes : null);
      // The time too, and the switch with it: both are locked now, so a time turned off or moved could not be put back.
      setTime(ownTime);
      setTimed(ownTime !== null);
      setTimeKept(null);
      if (typed && prevLockFirst !== first) {
        setAbout("save");
        setInvalid(null);
        setError(`${NOTE_ONLY_TEXT} HN การผ่าตัด ห้อง และเวลากลับเป็นแบบเดิม`);
        setDone("");
      }
    }
  }

  // At 15:00 the page refreshes with a later first day (components/board-refresh.tsx). A picked day that can no longer
  // be booked moves on to it, and the form says why; an edit's own day stays (it is now closed).
  const [prevFirst, setPrevFirst] = useState(first);
  if (prevFirst !== first) {
    setPrevFirst(first);
    if (date < first && !keepsDay) {
      setDate(first);
      setAbout("save");
      setInvalid("date");
      setError(earliestText(today, first, holidays));
      setDone("");
    }
  }

  /**
   * Fills the form for a request: empty on the first day that can be booked for a new booking; the booking itself for an
   * edit; its patient, room choice and note on the first day that can be booked to book again, or the next open day when
   * that is the booking's own (booking again is for another day).
   */
  function begin(next: CaseRequest) {
    const from = next.mode === "new" ? null : next.booking;
    const picked: RoomChoice = from ? bookedChoice(from, periods) : "dept";
    setMode(next.mode);
    // Wrapped: a function given to a state setter is taken as an updater.
    setBack(() => (next.mode === "new" ? null : (next.back ?? null)));
    setMoving(next.mode === "edit" && next.focus === "date");
    setEditing(next.mode === "edit" ? next.booking : null);
    let start = first;
    if (next.mode === "again" && next.booking.date === first) {
      const end = addDays(today, ahead);
      do start = addDays(start, 1);
      while (start < end && closedDayNote(start, holidays));
    }
    setDate(next.mode === "edit" ? next.booking.date : start);
    setHn(from?.hn ? displayHn(from.hn) : "");
    setOperation(from?.operation ?? "");
    setNote(from?.note ?? "");
    setChoice(picked);
    setScrubDoes(picked === "dressing" && typeof from?.scrubDoes === "boolean" ? from.scrubDoes : null);
    // An edit keeps its time; booking again keeps the same time on the other day.
    setTime(from ? timeOf(from) : null);
    setTimed(from ? timeOf(from) !== null : false);
    setTimeKept(null);
    const opensOn = next.mode === "edit" && next.focus === "details" ? "details" : "time";
    setStep(opensOn);
    setOpened(opensOn);
    setVersion((current) => current + 1);
    setInvalid(null);
    setError("");
    setDone("");
    setConfirming(null);
    setCalendarOpen(next.mode === "edit" && next.focus === "date" ? {} : null);
  }

  const [prevRequest, setPrevRequest] = useState(request);
  if (prevRequest !== request) {
    setPrevRequest(request);
    if (request) begin(request);
  }

  // The day view's bookings: read for the day shown whenever it changes, on each opening and after each save.
  const isOpen = request !== null;
  useEffect(() => {
    if (!isOpen) return;
    let live = true;
    const keep = (slots: DaySlot[], error: string) => {
      if (live) setDays((all) => ({ ...all, [date]: { version, slots, error } }));
    };
    onDay(date).then(
      (result) => (result.ok ? keep(result.slots, "") : keep([], result.error)),
      () => keep([], DAY_UNREAD),
    );
    return () => {
      live = false;
    };
  }, [isOpen, date, version, onDay]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (request && !dialog.open) dialog.showModal();
    if (!request && dialog.open) dialog.close();
    if (!request && scrubRef.current?.open) scrubRef.current.close();
  }, [request]);

  function edited(field: CaseField) {
    // A save's message goes with any change, so its mark goes too: a field left red with nothing said would puzzle.
    setInvalid((current) => (current === field || about === "save" ? null : current));
    if (about === "save") {
      setError("");
      setDone("");
    }
  }

  function focusField(field: CaseField | undefined) {
    if (field === "time") {
      const dialog = ref.current;
      (
        dialog?.querySelector<HTMLElement>('[data-testid="day-pick"] [role="button"]') ??
        dialog?.querySelector<HTMLElement>('[data-testid="day-start"]:enabled') ??
        dialog?.querySelector<HTMLElement>('[data-testid="case-time-toggle"]')
      )?.focus();
    } else if (field === "hn") hnRef.current?.focus();
    else if (field === "operation") operationRef.current?.focus();
    else if (field === "note") noteRef.current?.focus();
    else if (field === "date") dateRef.current?.querySelector<HTMLElement>("button")?.focus();
    else if (field === "room") {
      const group = roomRef.current;
      (group?.querySelector<HTMLElement>("input:checked") ?? group?.querySelector<HTMLElement>("input:enabled"))?.focus();
    }
  }

  // The doctor's choice of room. The dressing room asks the scrub question at once, in a dialog over the form.
  // Whether the open scrub question came from picking ห้องทำแผล (leaving it unanswered then goes back to the department's
  // room) rather than from answering it for a booking that already has the dressing room (which keeps it).
  const scrubFromPick = useRef(false);

  function pickRoom(next: RoomChoice) {
    setChoice(next);
    edited("room");
    if (next === "dressing") {
      scrubFromPick.current = true;
      scrubRef.current?.showModal();
    } else setScrubDoes(null);
  }

  function askScrub() {
    scrubFromPick.current = false;
    scrubRef.current?.showModal();
  }

  function answerScrub(answer: boolean) {
    setScrubDoes(answer);
    setChoice("dressing");
    // A message about another field stays: one about the day may have come while the dialog hid it (15:00 passed).
    if (invalid === null || invalid === "room") edited("room");
    scrubRef.current?.close();
  }

  // Closed without an answer (ย้อนกลับ, Escape, the phone's back gesture): a dressing room without one is no choice,
  // so the department's room is picked again. An answer given before stays when the doctor only looked again.
  function leaveScrub() {
    if (scrubDoes === null && scrubFromPick.current) setChoice("dept");
  }

  function apply(result: CaseResult, from: "save" | "remove") {
    setAbout(from);
    // A cancel's answer replaces a save's message, so the field that message marked is cleared too.
    if (from === "remove") setInvalid(null);
    if (result.mine) {
      setMine(result.mine);
      // The edited booking as saved, which the next save compares with (and which may now be closed).
      const saved = editing ? result.mine.find((item) => item.id === editing.id) : undefined;
      if (saved) setEditing(saved);
    }
    if (result.ok) {
      setDone(result.message);
      setError("");
      router.refresh();
    } else {
      setError(result.error);
      setDone("");
    }
  }

  // A field to focus once a save is over: the fields are disabled while it runs, and a disabled field takes no focus.
  const focusAfter = useRef<CaseField | null>(null);
  useEffect(() => {
    const field = focusAfter.current;
    if (pending || !field) return;
    focusAfter.current = null;
    focusField(field);
  }, [pending, step]);

  function refuse(message: string, field: CaseField | undefined, saving = false) {
    // The day and the time are on the day view.
    if (field === "date" || field === "time") setStep("time");
    setAbout("save");
    setError(message);
    setDone("");
    setInvalid(field ?? null);
    if (saving) focusAfter.current = field ?? null;
    else focusField(field);
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (step === "time") {
      next();
      return;
    }
    // No ในเวลา/นอกเวลา choice (Pong, 15 Nov 2026): a booking is saved as ในเวลา, and a HOSxP case it matches keeps
    // its own เวร on the board.
    const input = { date, hn, operation, room: choice, scrubDoes, note, start: time?.start ?? null, end: time?.end ?? null, ...(tc ? { place } : {}) };
    const edit = mode === "edit" ? editing : null;
    const checked = checkCase(input, {
      today,
      earliest: first,
      periods,
      subtype: doctor.subtype,
      holidays,
      place,
      ...(edit ? { editing: { ...edit, subtype: doctor.subtype } } : {}),
    });
    if (!checked.ok) {
      refuse(checked.error, checked.field);
      return;
    }
    // Booking again keeps the form filled for the next day of a series, so a second tap would book the same day twice.
    if (mode === "again" && bookedAlready(mine, { date, hn, choice }, periods)) {
      refuse(SAME_DAY_TEXT, "date");
      return;
    }
    setInvalid(null);
    startTransition(async () => {
      try {
        // The checked value carries the HN normalised and the room; the server checks it all again and works out the
        // room itself, from the doctor's choice and their department as the database has it.
        const result = edit ? await onEdit(edit.id, input) : await onAdd(input);
        if (!result.ok && result.field === "time") {
          // The server refused the time: the day view reads the day again.
          setVersion((current) => current + 1);
          refuse(result.error, "time", true);
          if (result.mine) setMine(result.mine);
          return;
        }
        if (!result.ok && result.earliest) {
          // 15:00 passed while the form was open: the calendar moves on with the server's first day.
          setMovedOn(result.earliest);
          setPrevFirst(later(earliest, result.earliest));
          if (date < result.earliest) setDate(result.earliest);
          refuse(result.error, "date", true);
          if (result.mine) setMine(result.mine);
          return;
        }
        apply(result, "save");
        // The day view shows the saved booking.
        if (result.ok) setVersion((current) => current + 1);
        // An edit keeps what it saved, and booking again keeps the patient for the next day of a series.
        if (result.ok && mode === "new") {
          // Ready for the next patient on the same day: back on the day view, whose room is chosen afresh.
          setHn("");
          setOperation("");
          setNote("");
          setChoice("dept");
          setScrubDoes(null);
          // The switch stays as the doctor left it: on, the day view shows the booking just made.
          setTime(null);
          setTimeKept(null);
          setStep("time");
          focusAfter.current = "time";
        }
        // Booking again: the next day of a series is picked on the day view, the patient and the time kept.
        if (result.ok && mode === "again") {
          setStep("time");
          focusAfter.current = "date";
        }
      } catch {
        setAbout("save");
        setError(UNSAVED);
        setDone("");
      }
    });
  }

  /**
   * ต่อไป on the day view: the day and the time are checked as a save checks them, then the rest of the form shows (its
   * other fields are checked on the save).
   */
  function next() {
    const input = { date, hn, operation, room: choice, scrubDoes, note, start: time?.start ?? null, end: time?.end ?? null, ...(tc ? { place } : {}) };
    const edit = mode === "edit" ? editing : null;
    const checked = checkCase(input, {
      today,
      earliest: first,
      periods,
      subtype: doctor.subtype,
      holidays,
      place,
      ...(edit ? { editing: { ...edit, subtype: doctor.subtype } } : {}),
    });
    if (!checked.ok && (checked.field === "date" || checked.field === "time")) {
      refuse(checked.error, checked.field);
      return;
    }
    if (mode === "again" && bookedAlready(mine, { date, hn, choice }, periods)) {
      refuse(SAME_DAY_TEXT, "date");
      return;
    }
    // รพ.ท่าฉลอม lends no room: a day without the department's own waits for another day here.
    if (tc && !room.ok) {
      refuse(room.error, "date");
      return;
    }
    // Turned on, the time is wanted.
    if (timed && !time && timeOpen) {
      refuse(TIME_MISSING_TEXT, "time");
      return;
    }
    if (invalid === "date" || invalid === "time" || about === "save") {
      setInvalid(null);
      setError("");
      setDone("");
    }
    setStep("details");
    // Back on the day view later, the calendar stays shut.
    setCalendarOpen(null);
    focusAfter.current = hn ? "operation" : "hn";
  }

  /** The workday before or after the one shown, among the days that can be booked (an edit's own day too). */
  function dayStep(direction: 1 | -1): string | null {
    const from = editing && editing.date < first ? editing.date : first;
    let day = date;
    for (let tries = 0; tries < ahead + 7; tries += 1) {
      day = addDays(day, direction);
      if (day < from || day > last) return null;
      if (editing && day === editing.date) return day;
      if (day >= first && !closedDayNote(day, holidays)) return day;
    }
    return null;
  }

  function remove(id: string) {
    if (confirming !== id) {
      setConfirming(id);
      return;
    }
    startTransition(async () => {
      try {
        apply(await onRemove(id), "remove");
      } catch {
        setAbout("remove");
        setError("ยกเลิกไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่");
        setDone("");
      } finally {
        setConfirming(null);
      }
    });
  }

  const specialty = subtypeLabel("DR", doctor.subtype);
  const last = addDays(today, ahead);
  const dayState = (iso: string): DayState => {
    const note = closedDayNote(iso, holidays);
    return note ? { disabled: true, note } : { disabled: false };
  };
  // The two rooms the doctor can pick that day, worked out again on each render from the day (and the name, which sends
  // a general surgeon's endoscopy to the SCOPE room, OR 3, in the weekly schedule).
  const name = cleanOperation(operation);
  // A department with several rooms that day keeps a surgeon's list in one (lib/added-cases.ts roomAmong): the room of
  // the doctor's own booking there; with none yet, the server gives the one with fewer bookings, so the card names both.
  // รพ.ท่าฉลอม gives a department one room a day and lends none.
  const pooled = tc ? [] : deptRooms(doctor.subtype, name, date, periods);
  const ownRoom =
    pooled.length > 1
      ? (mine
          .filter((item) => item.date === date)
          .map((item) => bookedRoom(item, periods))
          .find((item) => !item.dressing && pooled.includes(item.roomId))?.roomId ?? null)
      : null;
  // An edit on its own day keeps a room borrowed before 27 Nov 2026 (lib/added-cases.ts roomToBook), as the server does.
  const deptPlaced = roomToBook(place, doctor.subtype, name, date, periods, "dept", keepsDay && editing ? { ...editing, subtype: doctor.subtype } : undefined);
  const deptRoom = deptPlaced.ok && ownRoom ? { ...deptPlaced, roomId: ownRoom } : deptPlaced;
  const deptChoices = pooled.length > 1 && !ownRoom ? pooled : null;
  const dressingRoom = placeBookingRoom(place, doctor.subtype, name, date, periods, "dressing");
  const room = choice === "dressing" ? dressingRoom : deptRoom;
  const allocation = deptRoom.ok ? (tc ? thaChalomAllocation(deptRoom.roomId, date) : allocationFor(deptRoom.roomId, date, periods)) : null;
  const label = (roomId: string) => placeRoomName(roomId, place);
  // The day view: the bookings in the room the doctor's choice gives (a department's rooms that day, when the server
  // still picks one of them), the doctor's own edited booking left out.
  const shownRooms = room.ok ? (choice === "dept" && deptChoices ? deptChoices : [room.roomId]) : [];
  const read = days[date];
  const loading = !read || read.version !== version;
  const slots = read?.slots ?? [];
  const selfId = mode === "edit" && editing ? editing.id : null;
  // Whether a time can be given at all: not on a closed day, nor at รพ.ท่าฉลอม on a day without the department's room
  // (it lends none, and has no dressing room to fall back on).
  const timeOpen = !locked && !(tc && !room.ok);
  const shownName = room.ok ? (shownRooms.length > 1 ? shownRooms.map(label).join(" / ") : label(room.roomId)) : "";
  const prevDay = dayStep(-1);
  const nextDay = dayStep(1);
  const pickDay = (iso: string) => {
    setDate(iso);
    edited("date");
  };

  // The rest of the form, reached from the day view: its back arrow goes to the day view.
  const toTime = step === "details" && opened === "time";
  function showTime() {
    focusAfter.current = "time";
    setStep("time");
  }
  function giveTime(on: boolean) {
    if (on) {
      if (!time && timeKept) setTime(timeKept);
    } else {
      setTimeKept(time);
      setTime(null);
    }
    setTimed(on);
    edited("time");
  }
  const lockedNote = (
    <p className="mt-1.5 text-[0.8125rem] leading-5 font-semibold text-ink-2" data-testid="case-locked">
      {NOTE_ONLY_TEXT} หรือเลื่อนไปวันอื่น
    </p>
  );

  const saveError = about === "save" && error ? error : "";
  // Whether saving this edit puts the case at the back of the queue (lib/added-cases.ts bookingChange): a new day, room
  // choice or HN.
  const requeues = mode === "edit" && editing !== null && editRequeues(editing, { date, hn, operation, choice }, doctor.subtype, periods);
  const title = mode === "edit" ? (moving ? "เลื่อนวัน" : "แก้ไขการจอง") : mode === "again" ? "จองซ้ำวันอื่น" : "จองห้องผ่าตัด";
  // The message under จองห้อง names the field it is about, for screen readers on that field.
  const describe = (field: CaseField, own?: string) => [own, invalid === field && saveError ? "case-save-status" : null].filter(Boolean).join(" ") || undefined;

  return (
    <>
    {/* While a save runs the dialog stays open (Escape too), so its answer lands in the dialog that sent it. */}
    <dialog
      ref={ref}
      aria-labelledby="add-case-title"
      className={DIALOG}
      onCancel={(event) => pending && event.preventDefault()}
      onClose={onClosed}
      data-testid="add-case-dialog"
    >
      <form onSubmit={save} noValidate>
        <div className="flex items-start justify-between gap-3">
          {/*
            Opened from a row's จัดการ: back to its actions (Pong, 26 Nov 2026: "add back button"). On the rest of the
            form, after the day view: back to the day view.
          */}
          {back || toTime ? (
            <button
              type="button"
              className="btn btn-ghost -mr-2 -ml-2 size-11 min-h-0 shrink-0 rounded-full p-0"
              aria-label="ย้อนกลับ"
              title="ย้อนกลับ"
              disabled={pending}
              onClick={() => {
                if (toTime) {
                  showTime();
                  return;
                }
                ref.current?.close();
                back?.();
              }}
              data-testid="add-case-back"
            >
              {BACK_ICON}
            </button>
          ) : null}
          <div className="min-w-0 flex-1 pt-px">
            <h2 id="add-case-title" className="text-lg font-bold" data-mode={mode}>
              {title}
            </h2>
            <p className="mt-0.5 text-sm text-ink-2">
              ศัลยแพทย์ <span className="font-semibold text-ink">{doctor.name}</span>
            </p>
            {/* The department on a line of its own (Pong, 15 Nov 2026): it picks the room. */}
            {specialty ? (
              <p className="text-sm text-muted" data-testid="case-dept">
                {specialty}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-ghost size-11 min-h-0 shrink-0 rounded-full p-0"
            aria-label="ปิด"
            title="ปิด"
            disabled={pending}
            onClick={() => ref.current?.close()}
            data-testid="add-case-close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/*
          Locked while a save runs, so what is saved is what the doctor sees: an HN corrected during a slow save would
          otherwise be cleared by the save's answer, with the old HN booked. min-w-0: a fieldset is as wide as its
          content by default, which would push the form past a narrow phone's edge.
        */}
        <fieldset disabled={pending} className="mt-5 min-w-0 space-y-4">
          {step === "time" ? (
          <>
          <div ref={dateRef}>
            {/*
              The day before and after beside the label, as Google Calendar's arrows over its day: one pill, its right
              edge on the field's (Pong, 27 Nov 2026: "try check time book design, it looks weird").
            */}
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="case-date" className="text-sm font-semibold text-ink">
                วันที่ผ่าตัด
              </label>
              <span className="day-arrows">
                <button
                  type="button"
                  className="day-arrow"
                  aria-label="วันก่อนหน้า"
                  title="วันก่อนหน้า"
                  disabled={!prevDay}
                  onClick={() => prevDay && pickDay(prevDay)}
                  data-testid="case-day-prev"
                >
                  {CHEVRON("left")}
                </button>
                <button
                  type="button"
                  className="day-arrow"
                  aria-label="วันถัดไป"
                  title="วันถัดไป"
                  disabled={!nextDay}
                  onClick={() => nextDay && pickDay(nextDay)}
                  data-testid="case-day-next"
                >
                  {CHEVRON("right")}
                </button>
              </span>
            </div>
            <ThaiDateField
              id="case-date"
              value={date}
              onChange={pickDay}
              min={first}
              max={last}
              dayState={dayState}
              invalid={invalid === "date"}
              describedBy={describe("date", "case-date-hint")}
              testId="case-date"
              today={today}
              unlisted={unlisted}
              openSignal={calendarOpen}
            />
            {/*
              The 15:00 rule always, in Pong's words, a little larger than a hint (Pong, 15 Nov 2026), then the first day. An
              admin has no cut-off (Pong, 27 Nov 2026: "No restriction"), so the line says that instead.
            */}
            <p id="case-date-hint" className="mt-1.5 text-[0.8125rem] leading-5 text-muted" data-testid="case-date-hint">
              <span className="block">
                {admin
                  ? ADMIN_BOOKING_RULE
                  : BOOKING_CUTOFF_PHRASES.map((phrase, index) => (
                      <Fragment key={phrase}>
                        {index > 0 ? " " : null}
                        <span className="whitespace-nowrap">{phrase}</span>
                      </Fragment>
                    ))}
              </span>{" "}
              <span className="block">{bookableFrom(first)}</span>
            </p>
            {/* An edit's own day once 15:00 the day before passed: the fields below wait for another day. */}
            {locked ? lockedNote : null}
          </div>

          {/*
            The time, on the day view of the room the doctor's choice gives that day (the department's, until the rest of
            the form picks the dressing room).
          */}
          <div data-testid="case-time-section">
            {/*
              The time is the doctor's to give (Pong, 27 Nov 2026: "Add toggle time input : disable as default"): the
              switch beside the room, off to start with; on, the start and end lists and the day view.
            */}
            <div className="flex items-center justify-between gap-3">
              <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm" data-testid="case-day-room">
                <span className="font-semibold text-ink">เวลาผ่าตัด</span>{" "}
                {shownName ? <span className="text-ink-2">· {shownName}</span> : null}
              </p>
              <button
                type="button"
                role="switch"
                aria-checked={timed}
                className="time-toggle"
                disabled={!timeOpen}
                onClick={() => giveTime(!timed)}
                data-testid="case-time-toggle"
              >
                ระบุเวลา
                <span className="switch" aria-hidden="true" />
              </button>
            </div>
            {!room.ok ? (
              <p className="mt-0.5 text-[0.8125rem] leading-5 font-semibold text-[var(--stop)]">{room.error}</p>
            ) : null}
            {timed ? (
            <div className="mt-1.5">
              <DayView
                slots={slots}
                loading={loading}
                rooms={shownRooms}
                selfId={selfId}
                value={time}
                onChange={(next) => {
                  setTime(next);
                  edited("time");
                }}
                readOnly={!timeOpen}
                invalid={invalid === "time"}
                describedBy={describe("time")}
              />
            </div>
            ) : null}
            {timed && read?.error && !loading ? (
              <div className="mt-1.5 flex items-center gap-2">
                <InlineStatus tone="warning" role="alert" className="flex-1">
                  {read.error}
                </InlineStatus>
                <button type="button" className="btn btn-ghost min-h-11 px-3 text-sm" onClick={() => setVersion((current) => current + 1)}>
                  ลองใหม่
                </button>
              </div>
            ) : null}
          </div>
          </>
          ) : (
          <>
          {/* The day and the time picked, with the way back to them. */}
          <div className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2" data-testid="case-when">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{thaiDate(date)}</p>
              <p className="text-sm text-ink-2 tabular-nums" data-testid="case-when-time">
                {time ? `${rangeText(time)} น. · ${lengthText(time)}` : "ไม่ระบุเวลา"}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost min-h-11 shrink-0 px-3 text-sm"
              aria-label="เปลี่ยนวันและเวลา"
              onClick={showTime}
              data-testid="case-when-change"
            >
              เปลี่ยน
            </button>
          </div>
          {locked ? lockedNote : null}

          {/* min-w-0 as the outer fieldset; disabled on an edit's closed day. */}
          <fieldset disabled={locked} className="locked-fields min-w-0 space-y-4" data-testid="case-locked-fields">
          <HnField
            id="case-hn"
            value={hn}
            onChange={(digits) => {
              setHn(digits);
              edited("hn");
            }}
            inputRef={hnRef}
            invalid={invalid === "hn"}
            describedBy={describe("hn")}
            testId="case-hn"
          />

          <div>
            <span className="flex items-baseline justify-between gap-2">
              <label htmlFor="case-operation" className="text-sm font-semibold text-ink">
                การผ่าตัด
              </label>
              <span className="text-xs text-muted tabular-nums">
                {operation.length}/{MAX_OPERATION}
              </span>
            </span>
            <input
              id="case-operation"
              ref={operationRef}
              value={operation}
              onChange={(event) => {
                setOperation(event.target.value);
                edited("operation");
              }}
              maxLength={MAX_OPERATION}
              autoComplete="off"
              // No example on a closed day: in a fixed field it would read as the case's name.
              placeholder={locked ? undefined : "LC, ORIF PS femur"}
              required
              aria-required="true"
              aria-invalid={invalid === "operation" || undefined}
              aria-describedby={describe("operation")}
              className="field field-text mt-1.5"
              data-testid="case-operation"
            />
          </div>

          {/*
            The doctor's choice of room, each named with the room it is that day. A room the day does not have is shown
            greyed, with the reason under the choices, and is never shown picked: a picked radio that is disabled would
            keep the keyboard out of the whole group.
          */}
          <fieldset
            ref={roomRef}
            data-testid="case-room"
            data-choice={choice}
            data-room-id={room.ok ? room.roomId : undefined}
            aria-describedby="case-room-why"
          >
            <legend className="text-sm font-semibold text-ink">ห้องผ่าตัด</legend>
            <div className={`mt-1.5 grid gap-1.5 ${tc ? "grid-cols-1" : "grid-cols-2"}`}>
              <label className={`${OPTION} min-h-16`}>
                <input
                  type="radio"
                  name="room"
                  value="dept"
                  checked={choice === "dept" && deptRoom.ok}
                  disabled={!deptRoom.ok}
                  onChange={() => pickRoom("dept")}
                  aria-invalid={(invalid === "room" && choice === "dept") || undefined}
                  aria-describedby={describe("room")}
                  className="sr-only"
                  data-testid="case-room-dept"
                />
                {/* The department above the room number (Pong, 15 Nov 2026) */}
                {allocation ? (
                  <span className="flex flex-wrap justify-center gap-1">
                    {allocation.split ? (
                      <>
                        <DeptTag dept={allocation.am} />
                        <DeptTag dept={allocation.pm} />
                      </>
                    ) : (
                      <DeptTag dept={allocation.am} />
                    )}
                  </span>
                ) : null}
                <span className="text-[0.9375rem] font-bold" data-testid="case-room-dept-name">
                  {deptRoom.ok ? (deptChoices ? deptChoices.map(label).join(" / ") : label(deptRoom.roomId)) : "ห้องของสาขา"}
                </span>
                {deptRoom.ok && deptChoices ? <span className="text-xs text-muted">{POOLED_ROOM_NOTE}</span> : null}
                {!allocation && !deptRoom.ok ? <span className="text-xs">{NO_ROOM_NOTE[deptRoom.reason]}</span> : null}
              </label>
              {/* รพ.ท่าฉลอม has no dressing room to book (Pong, 27 Nov 2026: "own department's room only"). */}
              {tc ? null : (
                <label className={`${OPTION} min-h-16`}>
                  <input
                    type="radio"
                    name="room"
                    value="dressing"
                    checked={choice === "dressing" && dressingRoom.ok}
                    disabled={!dressingRoom.ok}
                    onChange={() => pickRoom("dressing")}
                    aria-invalid={(invalid === "room" && choice === "dressing") || undefined}
                    aria-describedby={describe("room")}
                    className="sr-only"
                    data-testid="case-room-dressing"
                  />
                  <span className="text-[0.9375rem] font-bold">{DRESSING_ROOM_NAME}</span>
                  <span className="text-xs text-muted">{dressingRoom.ok ? label(dressingRoom.roomId) : NO_ROOM_NOTE[dressingRoom.reason]}</span>
                </label>
              )}
            </div>
            {/* Empty for the department's room (Pong, 15 Nov 2026: "remove ห้องของสาขาคุณ..."), so it takes no room then. */}
            <div
              id="case-room-why"
              className="mt-1.5 flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 empty:mt-0 empty:min-h-0"
              aria-live="polite"
            >
              {!room.ok ? (
                <span className="text-sm font-semibold text-[var(--stop)]" data-testid="case-room-why">
                  {room.error}
                </span>
              ) : choice === "dressing" && scrubDoes !== null ? (
                <>
                  <span className="text-xs text-muted" data-testid="case-room-why">
                    {SCRUB_QUESTION} <span className="font-semibold text-ink">{scrubDoes ? SCRUB_YES : SCRUB_NO}</span>
                  </span>
                  <button type="button" className="btn btn-ghost min-h-11 px-2 text-sm" onClick={askScrub} data-testid="case-scrub-change">
                    เปลี่ยนคำตอบ
                  </button>
                </>
              ) : choice === "dressing" ? (
                // A booking from before the form asked has the dressing room without an answer: the room is already
                // picked, so a tap on it asks nothing, and this asks instead.
                <>
                  <span className="text-xs text-muted" data-testid="case-room-why">
                    ตอบคำถาม {SCRUB_QUESTION}
                  </span>
                  <button type="button" className="btn btn-ghost min-h-11 px-2 text-sm" onClick={askScrub} data-testid="case-scrub-answer">
                    ตอบ
                  </button>
                </>
              ) : null}
            </div>
          </fieldset>
          </fieldset>

          {/*
            The note to the OR team (Pong, 17 Nov 2026), optional, last. Everyone who opens the board sees it on the
            booking's row, so the hint says so (the patient's name and HN stay with who may see them).
          */}
          <div>
            <span className="flex items-baseline justify-between gap-2">
              <label htmlFor="case-note" className="text-sm font-semibold text-ink">
                หมายเหตุ <span className="font-normal text-muted">(ถ้ามี)</span>
              </label>
              <span className="text-xs text-muted tabular-nums">
                {note.length}/{MAX_NOTE}
              </span>
            </span>
            <textarea
              id="case-note"
              ref={noteRef}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                edited("note");
              }}
              maxLength={MAX_NOTE}
              rows={3}
              autoComplete="off"
              placeholder="เช่น ขอ C-arm, เตรียมเลือด 2 unit"
              aria-invalid={invalid === "note" || undefined}
              aria-describedby={describe("note", "case-note-hint")}
              className="field field-text mt-1.5 block min-h-[5.5rem] resize-y leading-6"
              data-testid="case-note"
            />
            <p id="case-note-hint" className="mt-1 text-xs leading-5 text-muted" data-testid="case-note-hint">
              ทุกคนที่เปิดตารางเห็นข้อความนี้ ไม่ต้องใส่ชื่อหรือ HN ผู้ป่วย
            </p>
          </div>
          {requeues ? (
            <p className="text-[0.8125rem] leading-5 font-semibold text-late" data-testid="case-requeue">
              {REQUEUE_TEXT}
            </p>
          ) : null}
          </>
          )}
        </fieldset>

        {step === "time" ? (
          // The day view is taller than a phone: ต่อไป stays in sight at the dialog's foot, with the time picked.
          // It sits on the dialog's own foot, over its padding, so no hour shows under it while the day scrolls by.
          <div className="sticky -bottom-4 z-10 -mx-4 mt-4 -mb-4 flex items-center gap-3 border-t border-line bg-surface px-4 py-3 min-[360px]:-bottom-5 min-[360px]:-mx-5 min-[360px]:-mb-5 min-[360px]:px-5 sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:px-6">
            <div className="min-w-0 flex-1">
              {saveError ? (
                <InlineStatus tone="warning" role="alert" id="case-save-status" testId="case-save-status">
                  {saveError}
                </InlineStatus>
              ) : about === "save" && done ? (
                <InlineStatus tone="success" role="status">
                  {done}
                </InlineStatus>
              ) : (
                <p className="text-sm leading-5 tabular-nums" data-testid="case-time-text" aria-live="polite">
                  {time ? (
                    <>
                      <span className="font-bold text-ink">{rangeText(time)} น.</span>{" "}
                      <span className="whitespace-nowrap text-muted">{lengthText(time)}</span>
                    </>
                  ) : timed && timeOpen ? (
                    <span className="text-muted">เลือกเวลาที่ต้องการ</span>
                  ) : (
                    <span className="text-muted">ไม่ระบุเวลา</span>
                  )}
                </p>
              )}
            </div>
            <button type="submit" disabled={pending} className="btn btn-primary shrink-0" data-testid="case-next">
              ต่อไป
            </button>
          </div>
        ) : (
        /* A save's answer is said quietly beside จองห้อง: left of the buttons, or on its own line above them on a phone. */
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-4">
          {saveError ? (
            <InlineStatus tone="warning" role="alert" className="sm:flex-1" id="case-save-status" testId="case-save-status">
              {saveError}
            </InlineStatus>
          ) : about === "save" && done ? (
            <InlineStatus tone="success" role="status" className="sm:flex-1">
              {done}
            </InlineStatus>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button type="button" onClick={() => ref.current?.close()} disabled={pending} className="btn btn-secondary">
              ปิด
            </button>
            <button type="submit" disabled={pending} aria-busy={pending} className="btn btn-primary" data-testid="case-submit">
              {pending ? "กำลังบันทึก…" : mode === "edit" ? "บันทึก" : "จองห้อง"}
            </button>
          </div>
        </div>
        )}
      </form>

      {/*
        An edit is about one booking: the list waits until the form books again. On the day view the doctor's own bookings
        are its "ของคุณ" blocks, and ต่อไป stays the dialog's foot: the list comes with the rest of the form.
      */}
      <section className="mt-6 border-t border-line pt-4" aria-labelledby="my-cases-title" hidden={mode === "edit" || step === "time"}>
        <h3 id="my-cases-title" className="flex items-center gap-2 text-sm font-bold">
          การจองของฉัน
          <span className="count-tag">
            <span className="tabular-nums">{mine.length}</span> รายการ
          </span>
        </h3>
        {/* A cancel's answer is said quietly under the count it changed (the booking itself may be gone from the list). */}
        {about === "remove" && error ? (
          <InlineStatus tone="warning" role="alert" className="mt-1">
            {error}
          </InlineStatus>
        ) : about === "remove" && done ? (
          <InlineStatus tone="success" role="status" className="mt-1">
            {done}
          </InlineStatus>
        ) : null}
        {mine.length === 0 ? (
          <p className="mt-2 text-sm text-muted">ยังไม่มีการจองตั้งแต่วันนี้</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-white/70" data-testid="my-cases">
            {mine.map((item) => {
              // Where the booking is now (the app works the room out again if the repair's dates moved).
              const { roomId, dressing } = bookedRoom(item, periods);
              const roomName = placeRoomName(roomId, item.place);
              const asking = confirming === item.id;
              const when = timeOf(item);
              // A case whose room is not in use that day (the ventilation repair moves the rooms) is not on the board.
              // รพ.ท่าฉลอม's rooms stay where they are.
              const offBoard = !atThaChalom(item) && roomUse(roomId, item.date, periods) !== "open";
              // Names the booking for the cancel button's screen-reader label: several can share a day and an HN.
              const what = [
                thaiDate(item.date, "short"),
                roomName,
                item.hn ? `HN ${displayHn(item.hn)}` : item.operation,
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <li key={item.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-ink-2">
                      {thaiDate(item.date, "short")} · {roomName}
                      {dressing ? ` ${DRESSING_ROOM_NAME}` : null}
                      {when ? <span className="tabular-nums" data-testid="my-case-time">{` · ${rangeText(when)} น.`}</span> : null}
                      {dressing && typeof item.scrubDoes === "boolean" ? (
                        <span className="badge badge-muted ml-1.5 align-middle" data-testid="my-case-scrub">
                          {scrubTag(item.scrubDoes)}
                        </span>
                      ) : null}
                      {item.shift === "out" ? <span className="badge badge-warning ml-1.5 align-middle">นอกเวลา</span> : null}
                      {offBoard ? <span className="badge badge-warning ml-1.5 align-middle">ห้องนี้ไม่เปิดวันนั้น</span> : null}
                    </p>
                    {/* Cases saved before bookings carried an HN have none; they show their operation as before. */}
                    {item.hn ? (
                      <p className="text-sm font-semibold break-all text-ink tabular-nums" data-testid="my-case-hn">
                        HN {displayHn(item.hn)}
                      </p>
                    ) : null}
                    <p className={`text-sm break-words ${item.operation ? (item.hn ? "text-ink-2" : "font-semibold text-ink") : "text-muted"}`}>
                      {item.operation || NO_OPERATION_LABEL}
                    </p>
                    {item.note ? (
                      <p className="mt-0.5 text-xs leading-5 whitespace-pre-line text-muted [overflow-wrap:anywhere]" data-testid="my-case-note">
                        หมายเหตุ: {item.note}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-stretch gap-1">
                    {/* The form edits it in place (a booking whose day has gone is not in the list). */}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        // The list hides while editing: the focus goes up to the form's first field with it.
                        flushSync(() => begin({ mode: "edit", booking: item, focus: "details" }));
                        ref.current?.scrollTo({ top: 0 });
                        ref.current?.querySelector<HTMLElement>('[data-testid="case-when-change"]')?.focus({ preventScroll: true });
                      }}
                      className="btn btn-ghost min-h-11 px-3 text-sm"
                      aria-label={`แก้ไข ${what}`}
                      data-testid="my-case-edit"
                    >
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => remove(item.id)}
                      onBlur={() => setConfirming((current) => (current === item.id ? null : current))}
                      className={`btn min-h-11 px-3 text-sm ${asking ? "btn-danger" : "btn-ghost btn-ghost-danger"}`}
                      aria-label={asking ? `ยืนยันยกเลิก ${what}` : `ยกเลิกจอง ${what}`}
                    >
                      {asking ? "ยืนยันยกเลิก" : "ยกเลิกจอง"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </dialog>

    {/*
      The scrub question, over the booking form (Pong, 15 Nov 2026: "show consecutive question on another dialog
      (overlying previous one)"). Beside the form's dialog rather than inside it, so its close never reaches the form's.
    */}
    <dialog
      ref={scrubRef}
      aria-labelledby="scrub-title"
      aria-describedby="scrub-room"
      className={QUESTION_DIALOG}
      onCancel={leaveScrub}
      data-testid="scrub-dialog"
    >
      <h2 id="scrub-title" className="text-lg font-bold">
        {SCRUB_QUESTION}
      </h2>
      <p id="scrub-room" className="mt-0.5 text-sm text-ink-2">
        {DRESSING_ROOM_NAME}
        {dressingRoom.ok ? ` ${label(dressingRoom.roomId)}` : ""} · {thaiDate(date, "short")}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" className={ANSWER} aria-pressed={scrubDoes === true} onClick={() => answerScrub(true)} data-testid="scrub-yes">
          {SCRUB_YES}
        </button>
        <button type="button" className={ANSWER} aria-pressed={scrubDoes === false} onClick={() => answerScrub(false)} data-testid="scrub-no">
          {SCRUB_NO}
        </button>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            leaveScrub();
            scrubRef.current?.close();
          }}
          data-testid="scrub-back"
        >
          ย้อนกลับ
        </button>
      </div>
    </dialog>
    </>
  );
}
