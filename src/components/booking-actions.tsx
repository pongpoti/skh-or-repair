"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type RefObject } from "react";
import type { CaseResult } from "@/app/(board)/actions";
import { InlineStatus } from "@/components/inline-status";
import {
  atThaChalom,
  bookedRoom,
  bookingState,
  editClosesOn,
  opensFrom,
  NO_OPERATION_LABEL,
  CALENDAR_TEXT,
  NOTE_ONLY_TEXT,
  placeRoomName,
  STARTED_TEXT,
  UNDER_WAY,
  type AddedCase,
} from "@/lib/added-cases";
import type { BoardRow } from "@/lib/board-rows";
import { thaiDate } from "@/lib/days";
import type { Holiday } from "@/lib/holidays";
import type { RepairPeriods } from "@/lib/repair";
import { getRoom, roomLabel } from "@/lib/rooms";

/**
 * What a doctor needs for the actions on their own bookings' rows (Pong, 25 Nov 2026: "on DR case row : allow surgeon to
 * edit, move date, delete and other functions"): their bookings from today on (lib/cases.ts listCasesBy), the server's
 * today and first bookable day, and what each action does. Null for everyone else.
 */
export type OwnBookings = {
  mine: readonly AddedCase[];
  /** Today in Thailand, YYYY-MM-DD, by the server's clock. */
  today: string;
  /** The first day that can be booked (lib/added-cases.ts earliestBookingDay): a day before it is closed for edits. */
  earliest: string;
  /**
   * The first weekend day or holiday that can be booked (lib/added-cases.ts firstOffDay), for a doctor who books them (CVT, an
   * admin: booksOffDays); null for everyone else.
   */
  offFrom?: string | null;
  /** The holidays the 15:00 cut-off steps over, for when a booking closes (editClosesOn). */
  holidays: readonly Holiday[];
  periods: RepairPeriods;
  /**
   * Opens the booking form on this booking: its details, or its day (a move: the calendar opens). `back` brings the
   * sheet it came from back (the form's ย้อนกลับ).
   */
  onEdit: (booking: AddedCase, focus: "details" | "date", back?: () => void) => void;
  /** Opens the booking form for a new booking of the same patient on another day (book again). */
  onAgain: (booking: AddedCase, back?: () => void) => void;
  onRemove: (id: string) => Promise<CaseResult>;
  /** Books a cancelled booking again in its old place in the queue, within minutes of the cancel (lib/cases.ts restoreCase). */
  onRestore: (id: string) => Promise<CaseResult>;
};

/** Taps this soon after a step appears are ignored: a slow phone's double tap must not land on what just opened. */
const SETTLE_MS = 350;

/** The bottom sheet on a phone, a card in the middle from 640px (a computer, a tablet), over the room and its card. */
const SHEET =
  "m-auto max-h-[calc(100dvh-1.5rem)] w-[min(27rem,calc(100%-1.5rem))] overflow-y-auto overscroll-contain rounded-[18px] border border-line bg-surface p-0 text-ink shadow-[0_24px_60px_rgb(41_29_20/0.3)] backdrop:bg-[rgb(36_28_22/0.35)] backdrop:backdrop-blur-[2px] max-sm:mb-0 max-sm:max-h-[calc(100dvh-2.5rem)] max-sm:w-full max-sm:max-w-full max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0";

/** A left chevron: ย้อนกลับ, in the sheet's confirm step and in the booking form an action opened. */
export const BACK_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m15 18-6-6 6-6" />
  </svg>
);

/** A pencil over a line (Lucide "pen-line"): the row's จัดการ button. */
export function ManageIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
    </svg>
  );
}

const ICONS = {
  edit: (
    <>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </>
  ),
  move: (
    <>
      <path d="M8 2v4M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18M8 16h7" />
      <path d="m13 14 2 2-2 2" />
    </>
  ),
  again: (
    <>
      <path d="M8 2v4M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18M12 14v5M9.5 16.5h5" />
    </>
  ),
  cancel: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
} as const;

function ActionIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    <span className="booking-action-icon" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {ICONS[name]}
      </svg>
    </span>
  );
}

function Action({
  icon,
  label,
  onClick,
  danger = false,
  disabled = false,
  testId,
}: {
  icon: keyof typeof ICONS;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <li>
      <button type="button" className={`booking-action${danger ? " booking-action-danger" : ""}`} onClick={onClick} disabled={disabled} data-testid={testId}>
        <ActionIcon name={icon} />
        <span className="min-w-0 flex-1 text-base leading-6 font-semibold">{label}</span>
      </button>
    </li>
  );
}

/**
 * Where the doctor's own booking stands (lib/added-cases.ts bookingState): a CVT booking of a weekend day or holiday closes at
 * 15:00 the day before it (opensFrom), any other at the 15:00 cut-off.
 */
export function ownState(booking: Pick<AddedCase, "date" | "subtype" | "place">, own: Pick<OwnBookings, "today" | "earliest" | "offFrom" | "holidays">) {
  const offFrom = own.offFrom != null && booking.place !== "tha-chalom" ? own.offFrom : null;
  return bookingState(booking.date, own.today, opensFrom(booking.date, own.earliest, offFrom, own.holidays));
}

/**
 * Until when an open booking's details can change, as the sheet says it: 15:00 on the day the booking cut-off passes its
 * day (lib/added-cases.ts editClosesOn; the day before, or the workday before for a Monday), when MX makes the HOSxP
 * list. A move to an open day and a cancel stay open after it.
 */
export function editDeadline(date: string, today: string, holidays: readonly Holiday[] = [], offDays = false): string {
  const day = editClosesOn(date, today, holidays, offDays);
  return day ? `แก้ไขได้ถึง 15.00 น. ${thaiDate(day, "short")}` : NOTE_ONLY_TEXT;
}

/**
 * The doctor's own booking with what they can do with it, opened by the จัดการ button on its row (components/case-list.tsx;
 * the judges' pick of three designs, 25 Nov 2026; made shorter on 26 Nov: "make it more concise. add back button"): a
 * bottom sheet on a phone and a card in the middle on a computer, over the room. It names the case (its operation, then
 * the room, its place in the queue and the day), says until when it can change, then lists the actions, one line each:
 *
 * - แก้ไข: the booking form on this booking (the operation, HN, room, note). After 15:00 the day before, only the note
 *   (แก้ไขหมายเหตุ; the HOSxP list is MX's by then).
 * - เลื่อนวัน: the same form with its calendar open. A new day puts the case at the back of that day's queue.
 * - จองซ้ำวันอื่น: a new booking of the same patient, room and note on another day (serial dressings).
 * - ยกเลิกจอง: apart from the others, with a step that asks again (its back arrow, in focus, keeps the booking), then
 *   เลิกทำ for a few minutes, which books it back in its old place.
 *
 * The form an action opens has a back arrow that brings this sheet back (`onReopen`).
 *
 * A case HOSxP says is under way or over keeps only จองซ้ำวันอื่น. Taps in the first moment of a step are ignored. The
 * sheet keeps the booking it opened with should a refresh take its row away (the cancel itself, or another device).
 */
export function BookingSheet({
  dialogRef,
  row,
  booking,
  own,
  opened,
  onClosed,
  onReopen,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  row: BoardRow | null;
  booking: AddedCase | null;
  own: OwnBookings;
  /** A new value each time the sheet opens, which starts it at its list of actions. */
  opened: number;
  onClosed: () => void;
  /** Opens the sheet again on its booking, when it is still on the room's list: the form's back arrow. */
  onReopen: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"menu" | "confirm" | "cancelled">("menu");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [pending, startTransition] = useTransition();
  const shownAt = useRef(0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Its own id: the room's sheet and its full screen card each have a list, so two sheets live on the page at once, and
  // the closed one keeps the heading of the booking it last showed.
  const titleId = useId();
  const restoreRef = useRef<HTMLButtonElement>(null);
  const [prevOpened, setPrevOpened] = useState(opened);
  if (prevOpened !== opened) {
    setPrevOpened(opened);
    setStep("menu");
    setError("");
    setDone("");
  }
  // Each step starts the settle time again.
  useEffect(() => {
    shownAt.current = performance.now();
  }, [opened, step]);
  const settled = () => performance.now() - shownAt.current >= SETTLE_MS;
  // A step that takes the focused button away (ไม่ยกเลิก, ยืนยันยกเลิก, เลิกทำ), or a wait that disables it, leaves the
  // focus inside the sheet: on เลิกทำ once a cancel is done (the one thing worth doing then), else on the sheet's title
  // (a calendar booking's cancel has no เลิกทำ).
  // The confirm step's back arrow takes it itself (autoFocus); an opening sheet gets it from showModal.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.open || pending) return;
    const focused = document.activeElement;
    const lost = !dialog.contains(focused) || focused === titleRef.current;
    if (step === "cancelled" && lost && restoreRef.current) restoreRef.current.focus();
    else if (!dialog.contains(focused)) titleRef.current?.focus({ preventScroll: true });
  }, [step, pending, dialogRef]);
  // Whether the press began on the backdrop: a selection dragged out of the card ends with a click on the dialog itself.
  const pressedOutside = useRef(false);
  const close = () => dialogRef.current?.close();

  const state = booking ? ownState(booking, own) : "past";
  const underWay = row ? UNDER_WAY.has(row.status) : false;
  // A booking from the doctor's calendar (lib/calendar-api.ts) changes there: here it can only be cancelled for good.
  const fromCalendar = booking?.via === "calendar";
  const room = booking ? getRoom(booking.roomId) : undefined;
  const where = booking ? bookedRoom(booking, own.periods) : null;
  // The room the case is in, and its place there: a copy in a department's other room (BoardRow.shownFrom) says its own.
  const rowRoom = row ? (row.shownFrom?.roomId ?? row.roomId) : null;
  const rowOrder = row ? (row.shownFrom?.order ?? row.order) : null;
  const placeRoom = getRoom(rowRoom ?? where?.roomId ?? null) ?? room;
  // รพ.ท่าฉลอม's rooms by its own names ("ห้อง Scope"): the row's, where MX's list puts a matched case, as at รพ.สมุทรสาคร.
  const roomName = booking
    ? atThaChalom(booking)
      ? placeRoomName(rowRoom ?? booking.roomId, booking.place)
      : placeRoom
        ? roomLabel(placeRoom)
        : booking.roomId
    : "";
  const heading = booking ? [roomName, rowOrder ? `ลำดับ ${rowOrder}` : null, thaiDate(booking.date, "short")].filter(Boolean).join(" · ") : "";

  function act(run: () => void) {
    if (!settled() || pending) return;
    run();
  }

  function openForm(run: (item: AddedCase, back: () => void) => void) {
    act(() => {
      if (!booking) return;
      close();
      run(booking, onReopen);
    });
  }

  function cancel() {
    act(() => {
      if (!booking) return;
      setError("");
      startTransition(async () => {
        try {
          const result = await own.onRemove(booking.id);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setDone(result.message);
          setStep("cancelled");
          router.refresh();
        } catch {
          setError("ยกเลิกไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่");
        }
      });
    });
  }

  function restore() {
    act(() => {
      if (!booking) return;
      setError("");
      startTransition(async () => {
        try {
          const result = await own.onRestore(booking.id);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setDone(result.message);
          setStep("menu");
          router.refresh();
        } catch {
          setError("จองคืนไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่");
        }
      });
    });
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className={SHEET}
      onCancel={(event) => pending && event.preventDefault()}
      onClose={onClosed}
      onPointerDown={(event) => {
        pressedOutside.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const outside = pressedOutside.current && event.target === event.currentTarget;
        pressedOutside.current = false;
        // Not in the first moment either: the second tap of a double tap on what opened it (a row's จัดการ, the form's
        // back arrow) lands on the backdrop.
        if (outside && !pending && settled()) close();
      }}
      data-testid="booking-sheet"
      data-step={step}
    >
      {booking ? (
        <div className="px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] min-[360px]:px-5 sm:pt-5 sm:pb-5">
          <span aria-hidden className="mx-auto mb-1.5 block h-1 w-10 rounded-full bg-line-strong sm:hidden" />
          <div className="flex items-start gap-1">
            {step === "confirm" ? (
              // Back to the actions, keeping the booking: the safe answer, in focus.
              <button
                type="button"
                className="btn btn-ghost -ml-2 size-11 min-h-0 shrink-0 rounded-full p-0"
                aria-label="ย้อนกลับ"
                title="ย้อนกลับ"
                autoFocus
                onClick={() => act(() => setStep("menu"))}
                disabled={pending}
                data-testid="booking-back"
              >
                {BACK_ICON}
              </button>
            ) : null}
            <div className="min-w-0 flex-1 pt-1.5">
              <h2 ref={titleRef} tabIndex={-1} id={titleId} className="line-clamp-2 text-lg leading-snug font-bold text-ink outline-none" data-testid="booking-sheet-title">
                {step === "confirm" ? "ยกเลิกการจองนี้?" : (row?.procedure ?? booking.operation) || NO_OPERATION_LABEL}
              </h2>
              <p className="text-sm text-ink-2" data-testid="booking-sheet-where">
                {heading}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost -mr-2 size-11 min-h-0 shrink-0 rounded-full p-0"
              aria-label="ปิด"
              title="ปิด"
              disabled={pending}
              onClick={close}
              data-testid="booking-sheet-close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>

          {step === "menu" ? (
            <>
              <p className="mt-1 text-[0.8125rem] leading-5 text-ink-3" data-testid="booking-sheet-rule">
                {underWay
                  ? STARTED_TEXT
                  : fromCalendar
                    ? CALENDAR_TEXT
                    : state === "open"
                      ? editDeadline(booking.date, own.today, own.holidays, own.offFrom != null && booking.place !== "tha-chalom")
                      : NOTE_ONLY_TEXT}
              </p>
              {done ? (
                <InlineStatus tone="success" role="status" className="mt-3">
                  {done}
                </InlineStatus>
              ) : null}
              <ul className="booking-actions mt-3" data-testid="booking-actions">
                {underWay || fromCalendar ? null : (
                  <>
                    <Action
                      icon="edit"
                      label={state === "open" ? "แก้ไข" : "แก้ไขหมายเหตุ"}
                      onClick={() => openForm((item, back) => own.onEdit(item, "details", back))}
                      disabled={pending}
                      testId="booking-edit"
                    />
                    <Action
                      icon="move"
                      label="เลื่อนวัน"
                      onClick={() => openForm((item, back) => own.onEdit(item, "date", back))}
                      disabled={pending}
                      testId="booking-move"
                    />
                  </>
                )}
                <Action icon="again" label="จองซ้ำวันอื่น" onClick={() => openForm(own.onAgain)} disabled={pending} testId="booking-again" />
              </ul>
              {underWay ? null : (
                <ul className="booking-actions mt-2.5">
                  <Action icon="cancel" label="ยกเลิกจอง" onClick={() => act(() => setStep("confirm"))} danger disabled={pending} testId="booking-cancel" />
                </ul>
              )}
            </>
          ) : step === "confirm" ? (
            <>
              <p className="mt-2 text-sm leading-6 text-ink-2" data-testid="booking-confirm-note">
                {row?.source === "matched"
                  ? fromCalendar
                    ? "เคสนี้อยู่ในตาราง HOSxP แล้ว แจ้งห้องผ่าตัดด้วย · ยกเลิกแล้วเลิกทำไม่ได้"
                    : "เคสนี้อยู่ในตาราง HOSxP แล้ว แจ้งห้องผ่าตัดด้วย"
                  : fromCalendar
                    ? "ยกเลิกแล้วเลิกทำไม่ได้ จองใหม่ที่ปฏิทิน"
                    : "เลิกทำได้ภายใน 10 นาที"}
              </p>
              {error ? (
                <InlineStatus tone="warning" role="alert" className="mt-3">
                  {error}
                </InlineStatus>
              ) : null}
              <button type="button" className="btn btn-danger mt-3 w-full" onClick={cancel} disabled={pending} aria-busy={pending} data-testid="booking-confirm">
                {pending ? "กำลังยกเลิก…" : "ยืนยันยกเลิก"}
              </button>
            </>
          ) : (
            <>
              {error ? (
                <InlineStatus tone="warning" role="alert" className="mt-3">
                  {error}
                </InlineStatus>
              ) : (
                <InlineStatus tone="success" role="status" className="mt-3" testId="booking-cancelled">
                  {done}
                </InlineStatus>
              )}
              {fromCalendar ? null : (
                <button ref={restoreRef} type="button" className="btn btn-secondary mt-3 w-full" onClick={restore} disabled={pending} aria-busy={pending} data-testid="booking-restore">
                  {pending ? "กำลังจองคืน…" : "เลิกทำ จองคืนคิวเดิม"}
                </button>
              )}
            </>
          )}
        </div>
      ) : null}
    </dialog>
  );
}
