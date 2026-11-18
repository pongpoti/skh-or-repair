"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { CaseResult } from "@/app/(board)/actions";
import { AddCase, type Doctor } from "@/components/add-case";
import { BoardNotices, noticeBadge } from "@/components/board-notices";
import { CaseList, isCaseBubbleOpen } from "@/components/case-list";
import { FloorPlan, UNALLOCATED_FILL } from "@/components/floor-plan";
import { NoTableIcon } from "@/components/no-table-icon";
import type { AddedCase } from "@/lib/added-cases";
import { boardNotices, type BoardNotice } from "@/lib/board-notices";
import { allocationFor, readableTextOn, type Department } from "@/lib/allocation";
import { missingUploadDay, type BoardRow, type BoardRows } from "@/lib/board-rows";
import { boardHref } from "@/lib/days";
import type { Holiday } from "@/lib/holidays";
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
};

/** A room's rows in their order. */
function rowsOf(rows: readonly BoardRow[], roomId: string): BoardRow[] {
  return rows.filter((item) => item.roomId === roomId).sort((a, b) => a.order - b.order);
}

/** What a doctor needs to add cases (null for everyone else). */
export type CaseAdding = {
  doctor: Doctor;
  /** Today in Thailand, YYYY-MM-DD. */
  today: string;
  /** The first day the doctor can book (lib/added-cases.ts earliestBookingDay), by the server's clock. */
  earliest: string;
  /** The holidays from today to 60 days ahead, which the calendar closes. */
  holidays: readonly Holiday[];
  /** The years in those 60 days the BOT gave no holidays for (lib/holidays.ts), named under the calendar. */
  unlisted: readonly number[];
  mine: readonly AddedCase[];
  onAdd: (input: unknown) => Promise<CaseResult>;
  onRemove: (id: string) => Promise<CaseResult>;
};

const PLUS = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/** Whether a popover (the account menu) is open. False where the Popover API is missing, since nothing can be open. */
function isPopoverOpen(): boolean {
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

/**
 * A room's badge in the list of open rooms (Pong, 18 Nov 2026: "merge room number & name", style A of the samples): one
 * capsule, "OR 9" in a darker part of the department's colour, then the department's name. A room split between two
 * departments shows เช้า and บ่าย parts, each in its own colour. A name too long for the line ends in an ellipsis; the
 * badge's title holds it in full.
 */
function RoomPill({ room, allocation }: { room: Room; allocation: ReturnType<typeof allocationFor> }) {
  const parts = allocation?.split
    ? [
        { part: "เช้า", ...deptFace(allocation.am) },
        { part: "บ่าย", ...deptFace(allocation.pm) },
      ]
    : [{ part: null, ...deptFace(allocation?.am ?? null) }];
  const title = parts.map(({ part, name }) => (part ? `${part} ${name}` : name)).join(" · ");
  return (
    <span
      className={`room-pill ${parts.length > 1 ? "room-pill-split" : ""}`}
      title={`${roomLabel(room)} · ${title}`}
      style={{ "--room": parts[0].color, "--room-pm": parts[parts.length - 1].color } as CSSProperties}
      data-testid={`room-pill-${room.id}`}
    >
      <span className="room-pill-no" style={{ color: readableTextOn(parts[0].color) }} aria-hidden>
        <span className="room-pill-or">OR</span>
        {room.number}
      </span>
      <span className="sr-only">{roomLabel(room)}</span>
      {parts.map(({ part, color, name }) => (
        <span key={part ?? "day"} className="room-pill-dept" style={{ color: readableTextOn(color) }}>
          {part ? <span className="room-pill-part">{part}</span> : null}
          <span className="room-pill-name">{name}</span>
        </span>
      ))}
    </span>
  );
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
}: {
  rooms: readonly Room[];
  date: string;
  periods: RepairPeriods;
  counts: Record<string, number>;
  mismatches: Record<string, number>;
  onOpen: (id: string) => void;
}) {
  const total = rooms.reduce((sum, room) => sum + (counts[room.id] ?? 0), 0);
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
                  <RoomPill room={room} allocation={allocation} />
                  {mismatch ? (
                    <span className="shrink-0 text-late" title="ข้อมูลไม่ตรงกับการจอง">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />
                      </svg>
                      <span className="sr-only">ข้อมูลไม่ตรงกับการจอง</span>
                    </span>
                  ) : null}
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

export function SuiteBoard({
  board,
  today,
  periods,
  roomId = null,
  pathname = "/",
  adding = null,
  casesUnavailable = false,
  notices: givenNotices,
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
  /** The notices above the plan, when the page sets them itself (an admin's /?notices=all, or the preview's); else the board's own. */
  notices?: readonly BoardNotice[];
}) {
  const router = useRouter();
  // The day whose rooms are shown: the board's own date, or today when the suite is closed.
  const day = board?.date ?? today;
  const found = getRoom(roomId);
  const urlRoom = found && isSelectableRoom(found, day, periods) ? found.id : null;
  const [selectedId, setSelectedId] = useState<string | null>(urlRoom);
  const [prevUrl, setPrevUrl] = useState(urlRoom);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [addRequest, setAddRequest] = useState<object | null>(null);
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
  const missingUpload = missingUploadDay(board, casesUnavailable);
  const ownNotices = useMemo(() => boardNotices({ missingUpload }), [missingUpload]);
  const notices = givenNotices ?? ownNotices;
  // A notice can go while its bubble is open (the 16:00 refresh, an upload): forget it, so its bubble does not open
  // again by itself when the notice comes back, and the next Escape is not spent on it.
  if (noticeId !== null && !notices.some((notice) => notice.id === noticeId)) setNoticeId(null);
  const room = getRoom(selectedId);
  const open = room !== null;

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
      next[item.roomId] = roomMark(rowsOf(operations, item.roomId));
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
  const wash = allocation?.am?.color ?? allocation?.pm?.color;
  // While the strip says there is no HOSxP table yet, the header of every operating room's card says so too, except the
  // emergency room's (Pong, 16 Nov 2026). The room's department on the day whose rooms are shown decides, so the
  // emergency room is known even when the suite is closed (the preview's test mode).
  const roomDept = room ? allocationFor(room.id, day, periods) : null;
  const emergency = roomDept?.am?.code === "EMER" || roomDept?.pm?.code === "EMER";
  const noTable = room?.kind === "or" && !emergency && notices.some((notice) => notice.id === "no-upload");
  const overviewRooms = useMemo(() => (planDate ? openRooms(planDate, periods) : []), [planDate, periods]);

  return (
    <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="relative mx-auto flex min-h-0 w-full max-w-[120rem] flex-1 flex-col overflow-hidden sm:px-3 lg:flex-row lg:gap-6 lg:px-6 lg:pt-3 lg:pb-4">
        {/* From 1024px the column lets the booking button's glow spill into the padding below it instead of cutting it off
            flat; the plan keeps its own clipping. */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:overflow-visible">
          <BoardNotices notices={notices} openId={noticeId} onOpenChange={setNoticeId} />
          {/* The plan stops above the จองห้อง button and its glow, so the button never covers a room (Pong, 15 Nov
              2026). */}
          <div
            className={`flex min-h-0 flex-1 justify-center overflow-hidden p-1 lg:p-0 ${adding ? "pb-[calc(max(0.75rem,env(safe-area-inset-bottom))_+_3.75rem)] lg:pb-[4.5rem]" : ""}`}
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
          </div>
          {adding ? (
            // Centred under the plan on every screen, with a slow glow that draws the eye (Pong, 15 Nov 2026); on phones
            // the room sheet covers it. The wrapper centres it, so the button's own press transform stays free.
            <div className="pointer-events-none absolute inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[5] flex justify-center lg:bottom-0">
              <button
                type="button"
                className="btn btn-primary book-glow pointer-events-auto rounded-full px-6"
                onClick={() => setAddRequest({})}
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
          className={`room-sheet z-20 flex min-h-0 flex-col overflow-hidden max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[60dvh] max-lg:rounded-t-[24px] lg:static lg:h-full lg:w-[26rem] lg:shrink-0 xl:w-[30rem] 2xl:w-[34rem] ${open ? "is-open" : "max-lg:pointer-events-none"}`}
        >
          {open ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="sheet-head shrink-0 border-b border-line" style={wash ? ({ "--wash": wash } as CSSProperties) : undefined}>
                <span aria-hidden className="mx-auto mt-2 block h-1 w-10 rounded-full bg-line-strong lg:hidden" />
                <div className="flex items-start justify-between gap-3 px-5 pt-1.5 lg:pt-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-h-11 items-center gap-2.5">
                      <h2 ref={headingRef} tabIndex={-1} className="text-xl leading-snug font-bold text-ink outline-none">
                        {room ? roomLabel(room) : null}
                      </h2>
                      <span className="count-tag">
                        <span className="tabular-nums">{cases.length}</span> รายการ
                      </span>
                      {noTable ? (
                        <span className="room-no-table" data-testid="room-no-table">
                          <NoTableIcon size={22} label="ยังไม่มีตาราง HOSxP" />
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {/* On a computer it goes back to the list of open rooms (RoomOverview). */}
                  <button
                    type="button"
                    className="btn btn-ghost size-11 min-h-0 shrink-0 rounded-full p-0"
                    aria-label="ปิด"
                    title="ปิด"
                    onClick={() => choose(null)}
                    data-testid="room-close"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
                {/* The department badges always sit on one line, across the sheet's full width. */}
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
              {/* An empty room too: the list says ไม่มีรายการ itself, so a note open when a refresh empties the room stays. */}
              <CaseList key={room?.id} cases={cases} />
            </div>
          ) : planDate && overviewRooms.length > 0 ? (
            <RoomOverview
              rooms={overviewRooms}
              date={planDate}
              periods={periods}
              counts={counts}
              mismatches={board?.mismatchByRoom ?? NO_MISMATCH}
              onOpen={choose}
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
          onClosed={() => setAddRequest(null)}
          doctor={adding.doctor}
          today={adding.today}
          earliest={adding.earliest}
          holidays={adding.holidays}
          unlisted={adding.unlisted}
          periods={periods}
          initialMine={adding.mine}
          onAdd={adding.onAdd}
          onRemove={adding.onRemove}
        />
      ) : null}
    </main>
  );
}
