"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import type { CaseResult } from "@/app/(board)/actions";
import { HnField } from "@/components/hn-field";
import { InlineStatus } from "@/components/inline-status";
import { ThaiDateField, type DayState } from "@/components/thai-date-field";
import {
  addDays,
  BOOK_AHEAD_DAYS,
  bookedRoom,
  bookingRoom,
  checkCase,
  cleanOperation,
  closedDayNote,
  earliestText,
  MAX_OPERATION,
  NO_OPERATION_LABEL,
  type AddedCase,
  type CaseField,
} from "@/lib/added-cases";
import { allocationFor, readableTextOn, type Department } from "@/lib/allocation";
import { thaiDate } from "@/lib/days";
import { displayHn } from "@/lib/hn";
import type { Holiday } from "@/lib/holidays";
import type { RepairPeriods } from "@/lib/repair";
import { getRoom, roomLabel, roomUse } from "@/lib/rooms";
import type { Shift } from "@/lib/schedule";
import { subtypeLabel } from "@/lib/user-labels";

const DIALOG =
  "m-auto max-h-[calc(100dvh-1.5rem)] w-[min(32rem,calc(100%-1.5rem))] overflow-y-auto overscroll-contain rounded-[18px] border border-line bg-surface p-4 text-ink shadow-[0_24px_60px_rgb(41_29_20/0.3)] backdrop:bg-[rgb(36_28_22/0.35)] backdrop:backdrop-blur-[2px] min-[360px]:p-5 sm:p-6";

const UNSAVED = "บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง";

/** A picked radio: brown edge and tint. The input itself is visually hidden but still takes focus and arrow keys. */
const OPTION =
  "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-line-strong bg-white px-1 py-2 text-center transition-colors hover:border-brand has-checked:border-brand has-checked:bg-brand-tint has-checked:shadow-[inset_0_0_0_1px_var(--brand)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus";

export type Doctor = { name: string; subtype: string | null };

function DeptTag({ dept }: { dept: Department | null }) {
  if (!dept) return <span className="text-[0.6875rem] leading-5 text-muted">ไม่จัดสรร</span>;
  return (
    <span
      className="chip min-h-0 px-1 py-0 text-[0.625rem] leading-5 min-[400px]:px-1.5 min-[400px]:text-[0.6875rem]"
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
 * matched by it); the operation's name, required; and in or out of hours. A booking is an elective case, so the room
 * is not asked: the app arranges it from the doctor's department, or the dressing room for a dressing case, and the
 * form shows which before it is saved. The surgeon is always the signed-in doctor. Below it, the doctor's own bookings
 * from today on, with their HN, each one cancellable. `request` opens it.
 */
export function AddCase({
  request,
  onClosed,
  doctor,
  today,
  earliest,
  holidays,
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
  const [shift, setShift] = useState<Shift>("in");
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
      setShift("in");
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
    if (field === "hn") hnRef.current?.focus();
    else if (field === "operation") operationRef.current?.focus();
    else if (field === "date") dateRef.current?.querySelector<HTMLElement>("button")?.focus();
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
    const checked = checkCase({ date, hn, operation, shift }, { today, earliest: first, periods, subtype: doctor.subtype, holidays });
    if (!checked.ok) {
      refuse(checked.error, checked.field);
      return;
    }
    setInvalid(null);
    startTransition(async () => {
      try {
        // The checked value carries the HN normalised and the room; the server checks it all again and picks the room
        // itself, from the doctor's department as the database has it.
        const result = await onAdd({ date, hn, operation, shift });
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
          // Ready for the next patient on the same day.
          setHn("");
          setOperation("");
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
        setError("ยกเลิกไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง");
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
  // The room the server will pick, shown before saving: worked out again on each render from the day and the name.
  const room = bookingRoom(doctor.subtype, cleanOperation(operation), date, periods);
  const allocation = room.ok ? allocationFor(room.roomId, date, periods) : null;
  const shownRoom = room.ok ? getRoom(room.roomId) : null;
  const saveError = about === "save" && error ? error : "";
  // The message under จองห้อง names the field it is about, for screen readers on that field.
  const describe = (field: CaseField, own?: string) => [own, invalid === field && saveError ? "case-save-status" : null].filter(Boolean).join(" ") || undefined;

  return (
    // While a save runs the dialog stays open (Escape too), so its answer lands in the dialog that sent it.
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
              <p className="text-sm text-ink-3" data-testid="case-dept">
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
            />
            <p id="case-date-hint" className="mt-1 text-xs text-ink-3" data-testid="case-date-hint">
              {earliestText(today, first, holidays)}
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

          {/* No room to pick: the app arranges it, and says which before the booking is saved. */}
          <div>
            <p className="text-sm font-semibold text-ink" id="case-room-label">
              ห้องผ่าตัด
            </p>
            <div
              className="mt-1.5 flex min-h-12 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-line bg-surface-2 px-3 py-2"
              role="status"
              aria-labelledby="case-room-label"
              data-testid="case-room"
              data-room-id={room.ok ? room.roomId : undefined}
            >
              {room.ok ? (
                <>
                  <span className="text-[0.9375rem] font-bold text-ink">{shownRoom ? roomLabel(shownRoom) : room.roomId}</span>
                  {allocation?.split ? (
                    <>
                      <DeptTag dept={allocation.am} />
                      <DeptTag dept={allocation.pm} />
                    </>
                  ) : allocation ? (
                    <DeptTag dept={allocation.am} />
                  ) : null}
                  <span className="basis-full text-xs text-ink-3" data-testid="case-room-why">
                    {room.dressing ? "ห้องทำแผล: ชื่อการผ่าตัดเป็นการทำแผล" : "จัดให้อัตโนมัติตามสาขาของคุณ (เคสนัด)"}
                  </span>
                </>
              ) : (
                <span className="text-sm font-semibold text-[var(--stop)]" data-testid="case-room-why">
                  {room.error}
                </span>
              )}
            </div>
          </div>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">เวลา</legend>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {(
                [
                  ["in", "ในเวลา"],
                  ["out", "นอกเวลา"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className={`${OPTION} min-h-11 flex-row`}>
                  <input
                    type="radio"
                    name="shift"
                    value={value}
                    checked={shift === value}
                    onChange={() => setShift(value)}
                    className="sr-only"
                  />
                  <span className="text-sm font-semibold">{label}</span>
                </label>
              ))}
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
              // Where the booking is now (the app picks the room again if the repair's dates moved).
              const roomId = bookedRoom(item, periods).roomId;
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
  );
}
