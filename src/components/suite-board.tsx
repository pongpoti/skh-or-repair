"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { CaseResult, DayResult } from "@/app/(board)/actions";
import { AddCase, type CaseRequest, type Doctor } from "@/components/add-case";
import type { OwnBookings } from "@/components/booking-actions";
import type { DatePick } from "@/components/board-date-picker";
import { BoardNotices, noticeBadge } from "@/components/board-notices";
import { CaseList, isCaseBubbleOpen } from "@/components/case-list";
import { DaySwipe } from "@/components/day-swipe";
import { FloorPlan, UNALLOCATED_FILL } from "@/components/floor-plan";
import { NoTableIcon } from "@/components/no-table-icon";
import { RoomPill, type RoomPillPart } from "@/components/room-pill";
import type { AddedCase } from "@/lib/added-cases";
import { boardNotices, type BoardNotice } from "@/lib/board-notices";
import { allocationFor, readableTextOn, type Department } from "@/lib/allocation";
import { missingUploadDay, type BoardRow, type BoardRows, type OffBoardCount } from "@/lib/board-rows";
import { boardHref, thaiDate } from "@/lib/days";
import type { Holiday } from "@/lib/holidays";
import { BOARD_PATH } from "@/lib/places";
import type { RepairPeriods } from "@/lib/repair";
import { getRoom, isSelectableRoom, openRooms, roomLabel, type Room } from "@/lib/rooms";
import { roomMark } from "@/lib/schedule";

const NONE: BoardRow[] = [];
const NO_MISMATCH: Record<string, number> = {};

/**
 * The board's day: its date and case rows (lib/board-rows.ts: the HOSxP workbook's cases matched with the doctors'
 * bookings). The server has already left out every HN the viewer may not see.
 */
export type BoardView = Pick<BoardRows, "uploaded" | "mismatchCount" | "mismatchByRoom"> & {
  /** The board's date, YYYY-MM-DD: today until 16:00, then the next workday (lib/board-day.ts), or the day picked. */
  date: string;
  rows: readonly BoardRow[];
  /** The HOSxP cases no room takes that day, for the strip's notice (BoardRows.offBoard); none when left out. */
  offBoard?: readonly OffBoardCount[];
};

const NO_OFF_BOARD: readonly OffBoardCount[] = [];

/** The board's own notices (lib/board-notices.ts): no HOSxP list yet, and the HOSxP cases no room takes that day. */
export function useBoardNotices(board: Pick<BoardView, "date" | "uploaded" | "offBoard"> | null, casesUnavailable: boolean): readonly BoardNotice[] {
  const missingUpload = missingUploadDay(board, casesUnavailable);
  const offBoard = board?.offBoard ?? NO_OFF_BOARD;
  return useMemo(() => boardNotices({ missingUpload, offBoard }), [missingUpload, offBoard]);
}

/** A room's rows in their order. */
function rowsOf(rows: readonly BoardRow[], roomId: string): BoardRow[] {
  return rows.filter((item) => item.roomId === roomId).sort((a, b) => a.order - b.order);
}

/** What a doctor needs to add cases (null for everyone else). */
export type CaseAdding = {
  doctor: Doctor;
  /** Today in Thailand, YYYY-MM-DD. */
  today: string;
  /** The first day the doctor can book (lib/added-cases.ts firstBookingDay), by the server's clock. */
  earliest: string;
  /** An admin, who books with no time limits: from today at any hour, a year ahead (lib/added-cases.ts bookAheadDays). */
  admin?: boolean;
  /** The holidays from today to 60 days ahead (a year for an admin), which the calendar closes. */
  holidays: readonly Holiday[];
  /** The years in those 60 days the BOT gave no holidays for (lib/holidays.ts), named under the calendar. */
  unlisted: readonly number[];
  mine: readonly AddedCase[];
  onAdd: (input: unknown) => Promise<CaseResult>;
  /** Saves the doctor's edit of one of their own bookings: its new state, as a booking's input (app/(board)/actions.ts editCase). */
  onEdit: (id: string, input: unknown) => Promise<CaseResult>;
  onRemove: (id: string) => Promise<CaseResult>;
  /** Books back a booking cancelled moments ago, in its old place (app/(board)/actions.ts undoCancel). */
  onRestore: (id: string) => Promise<CaseResult>;
  /** One day's bookings, every room's, for the booking form's day view (app/(board)/actions.ts dayBookings). */
  onDay: (date: string) => Promise<DayResult>;
};

export const PLUS = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/** Whether a popover (the account menu) is open. False where the Popover API is missing, since nothing can be open. */
export function isPopoverOpen(): boolean {
  try {
    return document.querySelector(":popover-open") !== null;
  } catch {
    return false;
  }
}

function Owner({ dept, part, split = false }: { dept: Department | null; part?: string; split?: boolean }) {
  // Two badges share the line in a split room, so each is a little smaller there.
  const size = split ? "chip-lg chip-split" : "chip-lg";
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {part ? <span className="shrink-0 text-sm font-semibold whitespace-nowrap text-ink-2">{part}</span> : null}
      {dept ? (
        <span className={`chip ${size}`} title={dept.name} style={{ "--chip": dept.color, color: readableTextOn(dept.color) } as CSSProperties}>
          <span className="chip-text">{dept.name}</span>
        </span>
      ) : (
        <span className={`chip ${size}`} style={{ "--chip": UNALLOCATED_FILL, color: readableTextOn(UNALLOCATED_FILL) } as CSSProperties}>
          <span className="chip-text">ไม่จัดสรร</span>
        </span>
      )}
    </span>
  );
}

/** A department's colour and name for a badge; a room no one is given shows as ไม่จัดสรร in warm grey. */
function deptFace(dept: Department | null): { color: string; name: string } {
  return dept ? { color: dept.color, name: dept.name } : { color: UNALLOCATED_FILL, name: "ไม่จัดสรร" };
}

/** A room's badge in the list of open rooms (components/room-pill.tsx): its department, or เช้า and บ่าย parts. */
function RoomPillFor({ room, allocation }: { room: Room; allocation: ReturnType<typeof allocationFor> }) {
  const parts: RoomPillPart[] = allocation?.split
    ? [
        { part: "เช้า", ...deptFace(allocation.am) },
        { part: "บ่าย", ...deptFace(allocation.pm) },
      ]
    : [{ part: null, ...deptFace(allocation?.am ?? null) }];
  return <RoomPill prefix="OR" number={room.number} label={roomLabel(room)} parts={parts} testId={`room-pill-${room.id}`} />;
}

/**
 * The side panel on a computer before a room is picked (Pong, 16 Nov 2026: the board opens on desktop): the rooms in use
 * that day in number order, each with its department and how many cases it holds, as a second way to open a room beside
 * the plan. Hidden below 1024px, where the panel is the bottom sheet and only opens with a room.
 */
function RoomOverview({
  rooms,
  date,
  periods,
  counts,
  mismatches,
  onOpen,
  total,
}: {
  rooms: readonly Room[];
  date: string;
  periods: RepairPeriods;
  counts: Record<string, number>;
  mismatches: Record<string, number>;
  onOpen: (id: string) => void;
  /** The day's cases in these rooms, each once (a department's case is listed in each of its rooms; BoardRow.shownFrom). */
  total: number;
}) {
  return (
    <div className="hidden min-h-0 flex-1 flex-col lg:flex" data-testid="room-overview">
      <div className="shrink-0 border-b border-line px-5 pt-4 pb-3.5">
        <div className="flex min-h-11 items-center gap-2.5">
          <h2 className="text-xl leading-snug font-bold text-ink">ห้องที่เปิด</h2>
          <span className="count-tag">
            <span className="tabular-nums">{rooms.length}</span> ห้อง · <span className="tabular-nums">{total}</span> รายการ
          </span>
        </div>
        <p className="mt-0.5 text-sm text-muted">เลือกห้องบนแปลนหรือในรายการนี้เพื่อดูรายการผ่าตัด</p>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1.5">
        {rooms.map((room) => {
          const allocation = allocationFor(room.id, date, periods);
          const count = counts[room.id] ?? 0;
          const mismatch = (mismatches[room.id] ?? 0) > 0;
          return (
            <li key={room.id}>
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-3 px-5 py-2.5 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                onClick={() => onOpen(room.id)}
                data-testid={`overview-${room.id}`}
              >
                {/* The warning sits right after the badge, as in the samples. */}
                <span className="flex min-w-0 flex-1 items-center gap-2.5">
                  <RoomPillFor room={room} allocation={allocation} />
                  {mismatch ? <MismatchWarning /> : null}
                </span>
                <span className={`shrink-0 text-sm tabular-nums ${count ? "font-semibold text-ink-2" : "text-muted"}`}>
                  {count ? `${count} รายการ` : "ไม่มีรายการ"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The open-room list's warning for a room with HOSxP cases nobody booked (both hospitals' lists). */
export function MismatchWarning() {
  return (
    <span className="shrink-0 text-late" title="ข้อมูลไม่ตรงกับการจอง">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />
      </svg>
      <span className="sr-only">ข้อมูลไม่ตรงกับการจอง</span>
    </span>
  );
}

export const EXPAND_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </svg>
);

export const SHRINK_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
  </svg>
);

export const CLOSE_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

/**
 * The top of a room's list, in the sheet and in the full screen card alike: the room's name, how many cases, the no-table
 * mark, the department badges on their own line, and the buttons (`children`) at the right, over a wash of the
 * department's colour. รพ.ท่าฉลอม's board (components/tha-chalom-board.tsx) has the same.
 */
export function RoomHead({
  title,
  count,
  allocation,
  noTable,
  headingRef,
  headingId,
  eyebrow,
  handle = false,
  children,
}: {
  /** The room's name: "OR 4". */
  title: string;
  count: number;
  allocation: ReturnType<typeof allocationFor>;
  noTable: boolean;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  headingId?: string;
  /** A line above the name: the card says the day, since it covers the top bar. */
  eyebrow?: string;
  /** The bottom sheet's drag handle, on phones. */
  handle?: boolean;
  children: ReactNode;
}) {
  const wash = allocation?.am?.color ?? allocation?.pm?.color;
  return (
    <div className="sheet-head shrink-0 border-b border-line" style={wash ? ({ "--wash": wash } as CSSProperties) : undefined}>
      {handle ? <span aria-hidden className="mx-auto mt-2 block h-1 w-10 rounded-full bg-line-strong lg:hidden" /> : null}
      <div className={`flex items-start justify-between gap-3 px-5 ${handle ? "pt-1.5 lg:pt-4" : "pt-4"}`}>
        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <p className="truncate pt-0.5 text-sm font-medium text-muted" data-testid="room-full-day">
              {eyebrow}
            </p>
          ) : null}
          <div className="flex min-h-11 items-center gap-2.5">
            <h2 ref={headingRef} id={headingId} tabIndex={-1} className="text-xl leading-snug font-bold text-ink outline-none">
              {title}
            </h2>
            <span className="count-tag">
              <span className="tabular-nums">{count}</span> รายการ
            </span>
            {noTable ? (
              <span className="room-no-table" data-testid="room-no-table">
                <NoTableIcon size={22} label="ยังไม่มีตาราง HOSxP" />
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">{children}</div>
      </div>
      {/* The department badges always sit on one line, across the full width. */}
      <div className="flex min-w-0 flex-nowrap items-center gap-x-2.5 px-5 pt-1 pb-3.5 text-sm">
        {allocation?.split ? (
          <>
            <Owner part="เช้า" dept={allocation.am} split />
            <Owner part="บ่าย" dept={allocation.pm} split />
          </>
        ) : allocation ? (
          <Owner dept={allocation.am} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * The full screen card: centred over the dimmed, blurred board, all but 8px of a phone's width, and up to 64rem wide on
 * a computer, where its list takes two columns (.room-full in globals.css). Two thirds of the screen's height whatever
 * the room holds (Pong, 20 Nov 2026: "floating card height should expand about 2/3 of viewport height"): a short list
 * leaves room below it, a long one scrolls inside.
 */
const ROOM_CARD =
  "room-full m-auto h-[67dvh] max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-none flex-col sm:w-[min(64rem,calc(100%-3rem))] overflow-hidden rounded-[22px] border border-line bg-surface p-0 text-ink shadow-[0_24px_60px_rgb(41_29_20/0.3)] open:flex backdrop:bg-[rgb(36_28_22/0.45)] backdrop:backdrop-blur-[3px]";

/**
 * A room's list in a floating card in the middle of the screen (Pong, 19 Nov 2026: "add full screen btn on room dialog,
 * click to display Y-scrollable floating card center - center"): the sheet's head with the day above the room's name,
 * then every case, the list scrolling up and down when they are more than the screen holds; from 768px in two columns,
 * read across and then down, so a computer's width shows twice as many. The shrink button, Escape or
 * a tap outside the card closes it, back to the sheet as it was, the focus on the button that opened it.
 */
export function RoomCard({ onClose, headingRef, children }: { onClose: () => void; headingRef: RefObject<HTMLHeadingElement | null>; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  // Whether the press began on the backdrop: a selection dragged out past the card ends with a click on the dialog
  // itself, which must not close it.
  const pressedOutside = useRef(false);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    headingRef.current?.focus({ preventScroll: true });
  }, [headingRef]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="room-full-title"
      className={ROOM_CARD}
      // Its own close only: React passes the close of a dialog inside it (a row's note or actions) up to here too.
      onClose={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onPointerDown={(event) => {
        pressedOutside.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const outside = pressedOutside.current && event.target === event.currentTarget;
        pressedOutside.current = false;
        if (outside) ref.current?.close();
      }}
      data-room-view=""
      data-testid="room-full"
    >
      {children}
    </dialog>
  );
}

export function SuiteBoard({
  board,
  today,
  periods,
  roomId = null,
  pathname = BOARD_PATH,
  adding = null,
  casesUnavailable = false,
  notices: givenNotices,
  swipe = null,
}: {
  /** The board's day, or null when the suite is closed (the preview of a weekend or holiday). */
  board: BoardView | null;
  /** Today in Thailand, YYYY-MM-DD: decides which rooms are in use when there is no board. */
  today: string;
  /** The repair's dates (lib/repair-store.ts), loaded by the page. */
  periods: RepairPeriods;
  roomId?: string | null;
  pathname?: string;
  /** Shown to doctors: the จองห้อง button and its booking form. */
  adding?: CaseAdding | null;
  /** The bookings and the HOSxP cases could not be loaded, so the rooms show none. */
  casesUnavailable?: boolean;
  /** The notices above the plan, when the page sets them itself (the tutorial's, or the preview's); else the board's own. */
  notices?: readonly BoardNotice[];
  /** The days a swipe across the plan moves between (the date picker's); none turns the swipe off. */
  swipe?: DatePick | null;
}) {
  const router = useRouter();
  // The day whose rooms are shown: the board's own date, or today when the suite is closed.
  const day = board?.date ?? today;
  const found = getRoom(roomId);
  const urlRoom = found && isSelectableRoom(found, day, periods) ? found.id : null;
  const [selectedId, setSelectedId] = useState<string | null>(urlRoom);
  const [prevUrl, setPrevUrl] = useState(urlRoom);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cardHeadingRef = useRef<HTMLHeadingElement>(null);
  // The open room's list in the full screen card.
  const [full, setFull] = useState(false);
  // The booking form's opening: a new booking (จองห้อง), or one of the doctor's own bookings from its row's actions.
  const [addRequest, setAddRequest] = useState<CaseRequest | null>(null);
  // The notice whose chat bubble is open (BoardNotices).
  const [noticeId, setNoticeId] = useState<string | null>(null);
  const menuWasOpen = useRef(false);

  if (prevUrl !== urlRoom) {
    setPrevUrl(urlRoom);
    setSelectedId(urlRoom);
  }
  // The booking form can go while open (a refresh that could not read the bookings): a dialog taken off the page says
  // nothing on its way out, so the request is dropped here, or the form would open by itself when it comes back.
  if (!adding && addRequest) setAddRequest(null);

  const operations = board?.rows ?? NONE;
  const ownNotices = useBoardNotices(board, casesUnavailable);
  const notices = givenNotices ?? ownNotices;
  // A notice can go while its bubble is open (the 16:00 refresh, an upload): forget it, so its bubble does not open
  // again by itself when the notice comes back, and the next Escape is not spent on it.
  if (noticeId !== null && !notices.some((notice) => notice.id === noticeId)) setNoticeId(null);
  const room = getRoom(selectedId);
  const open = room !== null;
  // The card goes with its room (closed, or gone with a refresh).
  if (full && !open) setFull(false);

  const counts = useMemo(() => {
    const next: Record<string, number> = {};
    for (const item of operations) next[item.roomId] = (next[item.roomId] ?? 0) + 1;
    return next;
  }, [operations]);

  const marks = useMemo(() => {
    const next: Record<string, ReturnType<typeof roomMark>> = {};
    for (const item of operations) {
      if (next[item.roomId]) continue;
      const target = getRoom(item.roomId);
      if (!target || !isSelectableRoom(target, day, periods)) continue;
      // The room's own cases: a copy of the other room's case (BoardRow.shownFrom) is not running here.
      next[item.roomId] = roomMark(rowsOf(operations, item.roomId).filter((row) => !row.shownFrom));
    }
    return next;
  }, [operations, day, periods]);

  function choose(id: string | null) {
    if (id) {
      const next = getRoom(id);
      if (!next || !isSelectableRoom(next, day, periods)) return;
    }
    setSelectedId(id);
    startTransition(() => {
      router.replace(boardHref(id, pathname, window.location.search), { scroll: false });
    });
  }

  useEffect(() => {
    if (open) headingRef.current?.focus({ preventScroll: true });
  }, [open, selectedId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Escape in the add-case dialog, or in any other open dialog (the date picker's card), closes the dialog only.
      if (addRequest || document.querySelector("dialog[open]")) return;
      // Escape belongs to an open popover (the account menu) first.
      if (isPopoverOpen()) return;
      // Then to an open notice bubble. Its badge gets the focus back only when the focus was in the strip or the
      // bubble, so a person in the room's list stays there.
      if (noticeId) {
        const id = noticeId;
        setNoticeId(null);
        if (document.activeElement?.closest("[data-notice-strip]")) noticeBadge(id)?.focus();
        return;
      }
      choose(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function onSelect(id: string) {
    choose(selectedId === id ? null : id);
  }

  // The board's own date decides who holds each room (it matches the cases). When the suite is closed
  // (the weekend or a holiday) no one does, so every room keeps the plain colour.
  const planDate = board?.date ?? null;
  const cases = room ? rowsOf(operations, room.id) : NONE;
  const allocation = room && planDate ? allocationFor(room.id, planDate, periods) : null;
  // While the strip says there is no HOSxP table yet, the header of every operating room's card says so too, except the
  // emergency room's (Pong, 16 Nov 2026). The room's department on the day whose rooms are shown decides, so the
  // emergency room is known even when the suite is closed (the preview's test mode).
  const roomDept = room ? allocationFor(room.id, day, periods) : null;
  const emergency = roomDept?.am?.code === "EMER" || roomDept?.pm?.code === "EMER";
  const noTable = room?.kind === "or" && !emergency && notices.some((notice) => notice.id === "no-upload");
  const overviewRooms = useMemo(() => (planDate ? openRooms(planDate, periods) : []), [planDate, periods]);
  // The doctor's own bookings for their rows' actions (components/booking-actions.tsx): the form opens on one of them.
  const own: OwnBookings | null = useMemo(
    () =>
      adding
        ? {
            mine: adding.mine,
            today: adding.today,
            earliest: adding.earliest,
            holidays: adding.holidays,
            periods,
            onEdit: (booking, focus, back) => setAddRequest({ mode: "edit", booking, focus, back }),
            onAgain: (booking, back) => setAddRequest({ mode: "again", booking, back }),
            onRemove: adding.onRemove,
            onRestore: adding.onRestore,
          }
        : null,
    [adding, periods],
  );

  return (
    <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="relative mx-auto flex min-h-0 w-full max-w-[120rem] flex-1 flex-col overflow-hidden sm:px-3 lg:flex-row lg:gap-6 lg:px-6 lg:pt-3 lg:pb-4">
        {/* From 1024px the column lets the booking button's glow spill into the padding below it instead of cutting it off
            flat; the plan keeps its own clipping. */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:overflow-visible">
          <BoardNotices notices={notices} openId={noticeId} onOpenChange={setNoticeId} />
          {/* The plan stops above the จองห้อง button and its glow, so the button never covers a room (Pong, 15 Nov
              2026). */}
          {/* A sideways swipe across the plan shows the day before or after (Pong, 19 Nov 2026). */}
          <DaySwipe
            day={day}
            pick={board ? swipe : null}
            pathname={pathname}
            className={`flex min-h-0 flex-1 overflow-hidden p-1 lg:p-0 ${adding ? "pb-[calc(max(0.75rem,env(safe-area-inset-bottom))_+_3.75rem)] lg:pb-[4.5rem]" : ""}`}
          >
            <FloorPlan
              selectedId={selectedId}
              marks={marks}
              cases={counts}
              date={planDate}
              day={day}
              periods={periods}
              mismatches={board?.mismatchByRoom ?? NO_MISMATCH}
              onSelect={onSelect}
            />
          </DaySwipe>
          {adding ? (
            // Centred under the plan on every screen, with a slow glow that draws the eye (Pong, 15 Nov 2026); on phones
            // the room sheet covers it. The wrapper centres it, so the button's own press transform stays free.
            <div className="pointer-events-none absolute inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[5] flex justify-center lg:bottom-0">
              <button
                type="button"
                className="btn btn-primary book-glow pointer-events-auto rounded-full px-6"
                onClick={() => setAddRequest({ mode: "new" })}
                data-testid="add-case-button"
              >
                {PLUS}
                จองห้อง
              </button>
            </div>
          ) : null}
        </div>

        {open ? (
          <button
            type="button"
            className="scrim fixed inset-0 z-10 cursor-default bg-[rgb(36_28_22/0.25)] lg:hidden"
            aria-label="ปิดรายการห้อง"
            onPointerDown={() => {
              // A tap outside the account menu, or outside a bubble in the room's list, closes it; it should not also
              // close the room. The menu or bubble is already gone by the time the click fires, so note it now.
              menuWasOpen.current = isPopoverOpen() || isCaseBubbleOpen();
            }}
            onClick={(event) => {
              // A press that closed a menu or bubble ends here, or elsewhere after a drag: the flag never outlives the
              // next click, and a key press (no pointer, detail 0) always closes the room.
              const closedMenu = menuWasOpen.current && event.detail !== 0;
              menuWasOpen.current = false;
              if (!closedMenu) choose(null);
            }}
          />
        ) : null}

        <aside
          aria-label="รายการผ่าตัดของห้อง"
          data-room-view=""
          className={`room-sheet z-20 flex min-h-0 flex-col overflow-hidden max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[60dvh] max-lg:rounded-t-[24px] lg:static lg:h-full lg:w-[26rem] lg:shrink-0 xl:w-[30rem] 2xl:w-[34rem] ${open ? "is-open" : "max-lg:pointer-events-none"}`}
        >
          {open ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {room ? (
                <RoomHead title={roomLabel(room)} count={cases.length} allocation={allocation} noTable={noTable} headingRef={headingRef} handle>
                  {/* The room's list in a floating card in the middle of the screen (RoomCard). */}
                  <button
                    type="button"
                    className="btn btn-ghost size-11 min-h-0 shrink-0 rounded-full p-0"
                    aria-label="ขยายเต็มจอ"
                    aria-haspopup="dialog"
                    title="ขยายเต็มจอ"
                    onClick={() => setFull(true)}
                    data-testid="room-expand"
                  >
                    {EXPAND_ICON}
                  </button>
                  {/* On a computer it goes back to the list of open rooms (RoomOverview). */}
                  <button
                    type="button"
                    className="btn btn-ghost size-11 min-h-0 shrink-0 rounded-full p-0"
                    aria-label="ปิด"
                    title="ปิด"
                    onClick={() => choose(null)}
                    data-testid="room-close"
                  >
                    {CLOSE_ICON}
                  </button>
                </RoomHead>
              ) : null}
              {/* An empty room too: the list says ไม่มีรายการ itself, so a note open when a refresh empties the room stays. */}
              <CaseList key={room?.id} cases={cases} own={own} />
              {full && room ? (
                <RoomCard onClose={() => setFull(false)} headingRef={cardHeadingRef}>
                  <RoomHead
                    title={roomLabel(room)}
                    count={cases.length}
                    allocation={allocation}
                    noTable={noTable}
                    headingRef={cardHeadingRef}
                    headingId="room-full-title"
                    eyebrow={thaiDate(day, "short")}
                  >
                    <button
                      type="button"
                      className="btn btn-ghost size-11 min-h-0 shrink-0 rounded-full p-0"
                      aria-label="ย่อหน้าต่าง"
                      title="ย่อหน้าต่าง"
                      onClick={(event) => event.currentTarget.closest("dialog")?.close()}
                      data-testid="room-full-close"
                    >
                      {SHRINK_ICON}
                    </button>
                  </RoomHead>
                  <CaseList key={room.id} cases={cases} own={own} />
                </RoomCard>
              ) : null}
            </div>
          ) : planDate && overviewRooms.length > 0 ? (
            <RoomOverview
              rooms={overviewRooms}
              date={planDate}
              periods={periods}
              counts={counts}
              mismatches={board?.mismatchByRoom ?? NO_MISMATCH}
              onOpen={choose}
              total={operations.filter((item) => !item.shownFrom && overviewRooms.some((entry) => entry.id === item.roomId)).length}
            />
          ) : (
            <div className="hidden flex-1 flex-col items-center justify-center gap-3 px-8 text-center lg:flex">
              <span aria-hidden className="flex size-11 items-center justify-center rounded-full bg-brand-tint text-brand">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 3l14 7-6 2.2L10.8 19z" />
                </svg>
              </span>
              <p className="text-sm font-medium text-muted">เลือกห้องบนแปลนเพื่อดูรายการ</p>
            </div>
          )}
        </aside>
      </div>
      {adding ? (
        <AddCase
          request={addRequest}
          onClosed={() => {
            setAddRequest(null);
            // Opened from a row's actions, the form gives the focus back to that row's จัดการ, which a move or a cancel
            // may have taken off the page: the open room's heading has it then, else จองห้อง.
            if (document.activeElement === null || document.activeElement === document.body) {
              const heading =
                document.querySelector<HTMLElement>("dialog[open][data-room-view] h2[tabindex='-1']") ??
                document.querySelector<HTMLElement>("[data-room-view] h2[tabindex='-1']");
              (heading ?? document.querySelector<HTMLElement>('[data-testid="add-case-button"]'))?.focus({ preventScroll: true });
            }
          }}
          doctor={adding.doctor}
          today={adding.today}
          earliest={adding.earliest}
          admin={adding.admin}
          holidays={adding.holidays}
          unlisted={adding.unlisted}
          periods={periods}
          initialMine={adding.mine}
          onAdd={adding.onAdd}
          onEdit={adding.onEdit}
          onRemove={adding.onRemove}
          onDay={adding.onDay}
        />
      ) : null}
    </main>
  );
}
