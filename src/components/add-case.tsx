"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import type { CaseResult } from "@/app/(board)/actions";
import { HnField } from "@/components/hn-field";
import { InlineStatus } from "@/components/inline-status";
import { ThaiDateField, type DayState } from "@/components/thai-date-field";
import {
  addDays,
  BOOK_AHEAD_DAYS,
  BOOKING_CUTOFF_PHRASES,
  bookableFrom,
  bookedRoom,
  bookingRoom,
  checkCase,
  cleanOperation,
  closedDayNote,
  DRESSING_ROOM_NAME,
  earliestText,
  MAX_OPERATION,
  NO_OPERATION_LABEL,
  NO_ROOM_NOTE,
  SCRUB_NO,
  SCRUB_QUESTION,
  SCRUB_YES,
  scrubTag,
  type AddedCase,
  type CaseField,
  type RoomChoice,
} from "@/lib/added-cases";
import { allocationFor, readableTextOn, type Department } from "@/lib/allocation";
import { thaiDate } from "@/lib/days";
import { displayHn } from "@/lib/hn";
import type { Holiday } from "@/lib/holidays";
import type { RepairPeriods } from "@/lib/repair";
import { getRoom, roomLabel, roomUse } from "@/lib/rooms";
import { subtypeLabel } from "@/lib/user-labels";

const DIALOG_LOOK =
  "m-auto max-h-[calc(100dvh-1.5rem)] overflow-y-auto overscroll-contain rounded-[18px] border border-line bg-surface p-4 text-ink shadow-[0_24px_60px_rgb(41_29_20/0.3)] backdrop:bg-[rgb(36_28_22/0.35)] backdrop:backdrop-blur-[2px] min-[360px]:p-5 sm:p-6";
const DIALOG = `${DIALOG_LOOK} w-[min(32rem,calc(100%-1.5rem))]`;
/** The scrub question, a smaller dialog over the booking form. */
const QUESTION_DIALOG = `${DIALOG_LOOK} w-[min(24rem,calc(100%-2.5rem))]`;

const UNSAVED = "บันทึกไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่";

/** A picked radio: brown edge and tint. The input itself is visually hidden but still takes focus and arrow keys. */
const OPTION =
  "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-line-strong bg-white px-1 py-2 text-center transition-colors hover:border-brand has-checked:border-brand has-checked:bg-brand-tint has-checked:shadow-[inset_0_0_0_1px_var(--brand)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus has-disabled:cursor-not-allowed has-disabled:border-line has-disabled:bg-surface-2 has-disabled:text-muted has-disabled:hover:border-line";
/** An answer to the scrub question: the answer given before is marked like a picked option. */
const ANSWER =
  "flex min-h-14 items-center justify-center rounded-xl border border-line-strong bg-white px-2 py-3 text-center text-[0.9375rem] font-semibold text-ink transition-colors hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-pressed:border-brand aria-pressed:bg-brand-tint aria-pressed:shadow-[inset_0_0_0_1px_var(--brand)]";

export type Doctor = { name: string; subtype: string | null };

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
 * The doctor's booking of a room for one patient, in a dialog (Pong, 15 Nov 2026): the day, in Thai with a calendar
 * that offers only the days that can be booked (from the next workday, or the one after once 15:00 has passed, up to
 * 60 days ahead, never a weekend or holiday); the patient's 7-digit HN on its own card (the HOSxP workbook's case is
 * matched by it); the operation's name, required; the room, the doctor's own choice between their department's room
 * that day (OR X, picked to start with) and the dressing room (ห้องทำแผล; Pong, 15 Nov 2026: "let surgeon decide which
 * room to use"), each named with the room it is that day. There is no in or out of hours choice: a booking is saved as
 * ในเวลา (Pong, 15 Nov 2026). Picking the dressing room asks, in
 * a dialog over the form, whether the scrub nurse does the dressing for the doctor (Pong's "scrub ทำให้แทนไหม ?");
 * closing it unanswered puts the choice back on the department's room. The surgeon is always the signed-in doctor.
 * Below it, the doctor's own bookings from today on, with their HN, each one cancellable. `request` opens it.
 */
export function AddCase({
  request,
  onClosed,
  doctor,
  today,
  earliest,
  holidays,
  unlisted,
  periods,
  initialMine,
  onAdd,
  onRemove,
}: {
  /** Set to a new object to open the dialog. */
  request: object | null;
  onClosed: () => void;
  doctor: Doctor;
  /** Today in Thailand, YYYY-MM-DD. */
  today: string;
  /** The first day that can be booked, by the server's clock (lib/added-cases.ts earliestBookingDay). */
  earliest: string;
  /** The holidays from today to 60 days ahead, closed in the calendar as on the server. */
  holidays: readonly Holiday[];
  /** The years in those 60 days the BOT gave no holidays for, named under the calendar. */
  unlisted: readonly number[];
  /** The repair's dates (lib/repair-store.ts), which decide the rooms open on each day. */
  periods: RepairPeriods;
  initialMine: readonly AddedCase[];
  onAdd: (input: unknown) => Promise<CaseResult>;
  onRemove: (id: string) => Promise<CaseResult>;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const hnRef = useRef<HTMLInputElement>(null);
  const operationRef = useRef<HTMLInputElement>(null);
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

  // The server's list wins whenever the page reloads (another device may have added or removed a case).
  const [prevInitial, setPrevInitial] = useState(initialMine);
  if (prevInitial !== initialMine) {
    setPrevInitial(initialMine);
    setMine([...initialMine]);
  }

  // At 15:00 the page refreshes with a later first day (components/board-refresh.tsx). A picked day that can no longer
  // be booked moves on to it, and the form says why.
  const [prevFirst, setPrevFirst] = useState(first);
  if (prevFirst !== first) {
    setPrevFirst(first);
    if (date < first) {
      setDate(first);
      setAbout("save");
      setInvalid("date");
      setError(earliestText(today, first, holidays));
      setDone("");
    }
  }

  // Opening starts a fresh form on the first day that can be booked.
  const [prevRequest, setPrevRequest] = useState(request);
  if (prevRequest !== request) {
    setPrevRequest(request);
    if (request) {
      setDate(first);
      setHn("");
      setOperation("");
      setChoice("dept");
      setScrubDoes(null);
      setInvalid(null);
      setError("");
      setDone("");
      setConfirming(null);
    }
  }

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
    if (field === "hn") hnRef.current?.focus();
    else if (field === "operation") operationRef.current?.focus();
    else if (field === "date") dateRef.current?.querySelector<HTMLElement>("button")?.focus();
    else if (field === "room") {
      const group = roomRef.current;
      (group?.querySelector<HTMLElement>("input:checked") ?? group?.querySelector<HTMLElement>("input:enabled"))?.focus();
    }
  }

  // The doctor's choice of room. The dressing room asks the scrub question at once, in a dialog over the form.
  function pickRoom(next: RoomChoice) {
    setChoice(next);
    edited("room");
    if (next === "dressing") scrubRef.current?.showModal();
    else setScrubDoes(null);
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
    if (scrubDoes === null) setChoice("dept");
  }

  function apply(result: CaseResult, from: "save" | "remove") {
    setAbout(from);
    // A cancel's answer replaces a save's message, so the field that message marked is cleared too.
    if (from === "remove") setInvalid(null);
    if (result.mine) setMine(result.mine);
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
  }, [pending]);

  function refuse(message: string, field: CaseField | undefined, saving = false) {
    setAbout("save");
    setError(message);
    setDone("");
    setInvalid(field ?? null);
    if (saving) focusAfter.current = field ?? null;
    else focusField(field);
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    // No ในเวลา/นอกเวลา choice (Pong, 15 Nov 2026): a booking is saved as ในเวลา, and a HOSxP case it matches keeps
    // its own เวร on the board.
    const input = { date, hn, operation, room: choice, scrubDoes };
    const checked = checkCase(input, { today, earliest: first, periods, subtype: doctor.subtype, holidays });
    if (!checked.ok) {
      refuse(checked.error, checked.field);
      return;
    }
    setInvalid(null);
    startTransition(async () => {
      try {
        // The checked value carries the HN normalised and the room; the server checks it all again and works out the
        // room itself, from the doctor's choice and their department as the database has it.
        const result = await onAdd(input);
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
        if (result.ok) {
          // Ready for the next patient on the same day, whose room is chosen afresh.
          setHn("");
          setOperation("");
          setChoice("dept");
          setScrubDoes(null);
          focusAfter.current = "hn";
        }
      } catch {
        setAbout("save");
        setError(UNSAVED);
        setDone("");
      }
    });
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
  const last = addDays(today, BOOK_AHEAD_DAYS);
  const dayState = (iso: string): DayState => {
    const note = closedDayNote(iso, holidays);
    return note ? { disabled: true, note } : { disabled: false };
  };
  // The two rooms the doctor can pick that day, worked out again on each render from the day (and the name, which sends
  // a general surgeon's endoscopy to the mixed room during the repair).
  const name = cleanOperation(operation);
  const deptRoom = bookingRoom(doctor.subtype, name, date, periods, "dept");
  const dressingRoom = bookingRoom(doctor.subtype, name, date, periods, "dressing");
  const room = choice === "dressing" ? dressingRoom : deptRoom;
  const allocation = deptRoom.ok ? allocationFor(deptRoom.roomId, date, periods) : null;
  const label = (roomId: string) => {
    const found = getRoom(roomId);
    return found ? roomLabel(found) : roomId;
  };
  const saveError = about === "save" && error ? error : "";
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
          <div className="min-w-0">
            <h2 id="add-case-title" className="text-lg font-bold">
              จองห้องผ่าตัด
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
          <div ref={dateRef}>
            <label htmlFor="case-date" className="text-sm font-semibold text-ink">
              วันที่ผ่าตัด
            </label>
            <ThaiDateField
              id="case-date"
              value={date}
              onChange={(iso) => {
                setDate(iso);
                edited("date");
              }}
              min={first}
              max={last}
              dayState={dayState}
              invalid={invalid === "date"}
              describedBy={describe("date", "case-date-hint")}
              testId="case-date"
              today={today}
              unlisted={unlisted}
            />
            {/* The 15:00 rule always, in Pong's words, a little larger than a hint (Pong, 15 Nov 2026), then the first day. */}
            <p id="case-date-hint" className="mt-1.5 text-[0.8125rem] leading-5 text-muted" data-testid="case-date-hint">
              <span className="block">
                {BOOKING_CUTOFF_PHRASES.map((phrase, index) => (
                  <Fragment key={phrase}>
                    {index > 0 ? " " : null}
                    <span className="whitespace-nowrap">{phrase}</span>
                  </Fragment>
                ))}
              </span>{" "}
              <span className="block">{bookableFrom(first)}</span>
            </p>
          </div>

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
              placeholder="เช่น Lap chole, ORIF radius"
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
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
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
                <span className="text-[0.9375rem] font-bold">{deptRoom.ok ? label(deptRoom.roomId) : "ห้องของสาขา"}</span>
                {!allocation && !deptRoom.ok ? <span className="text-xs">{NO_ROOM_NOTE[deptRoom.reason]}</span> : null}
              </label>
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
                  <button
                    type="button"
                    className="btn btn-ghost min-h-11 px-2 text-sm"
                    onClick={() => scrubRef.current?.showModal()}
                    data-testid="case-scrub-change"
                  >
                    เปลี่ยนคำตอบ
                  </button>
                </>
              ) : choice === "dressing" ? (
                <span className="text-xs text-muted" data-testid="case-room-why">
                  ตอบคำถาม {SCRUB_QUESTION}
                </span>
              ) : null}
            </div>
          </fieldset>
        </fieldset>

        {/* A save's answer is said quietly beside จองห้อง: left of the buttons, or on its own line above them on a phone. */}
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
              {pending ? "กำลังบันทึก…" : "จองห้อง"}
            </button>
          </div>
        </div>
      </form>

      <section className="mt-6 border-t border-line pt-4" aria-labelledby="my-cases-title">
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
              const room = getRoom(roomId);
              const asking = confirming === item.id;
              // A case whose room is not in use that day (the ventilation repair moves the rooms) is not on the board.
              const offBoard = roomUse(roomId, item.date, periods) !== "open";
              // Names the booking for the cancel button's screen-reader label: several can share a day and an HN.
              const what = [
                thaiDate(item.date, "short"),
                room ? roomLabel(room) : roomId,
                item.hn ? `HN ${displayHn(item.hn)}` : item.operation,
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <li key={item.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-ink-2">
                      {thaiDate(item.date, "short")} · {room ? roomLabel(room) : roomId}
                      {dressing ? ` ${DRESSING_ROOM_NAME}` : null}
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
                  </div>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(item.id)}
                    onBlur={() => setConfirming((current) => (current === item.id ? null : current))}
                    className={`btn min-h-11 shrink-0 px-3 text-sm ${asking ? "btn-danger" : "btn-ghost btn-ghost-danger"}`}
                    aria-label={asking ? `ยืนยันยกเลิก ${what}` : `ยกเลิกจอง ${what}`}
                  >
                    {asking ? "ยืนยันยกเลิก" : "ยกเลิกจอง"}
                  </button>
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
