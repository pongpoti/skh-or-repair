"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { AddCase, type CaseRequest } from "@/components/add-case";
import type { OwnBookings } from "@/components/booking-actions";
import type { DatePick } from "@/components/board-date-picker";
import { BoardNotices, noticeBadge } from "@/components/board-notices";
import { CaseList, isCaseBubbleOpen } from "@/components/case-list";
import { DaySwipe } from "@/components/day-swipe";
import { RoomPill, type RoomPillPart } from "@/components/room-pill";
import {
  CLOSE_ICON,
  EXPAND_ICON,
  isPopoverOpen,
  MismatchWarning,
  PLUS,
  RoomCard,
  RoomHead,
  SHRINK_ICON,
  useBoardNotices,
  type BoardView,
  type CaseAdding,
} from "@/components/suite-board";
import { ThaChalomPlan } from "@/components/tha-chalom-plan";
import type { BoardRow } from "@/lib/board-rows";
import { boardHref, thaiDate } from "@/lib/days";
import { THA_CHALOM_PATH } from "@/lib/places";
import { DEFAULT_REPAIR_PERIODS, type RepairPeriods } from "@/lib/repair";
import { openRooms, thaChalomAllocation, thaChalomDay, usageText, type ThaChalomRoomDay, type ThaChalomUse } from "@/lib/tha-chalom-schedule";

/** A free half's badge: the plan's light floor, with dark text. */
const FREE_COLOR = "#E6DCCF";
/** OR 3 under works: the board's closed-room taupe. */
const CLOSED_COLOR = "#B4A594";
const NONE: readonly BoardRow[] = [];
const NO_MISMATCH: Record<string, number> = {};

function partOf(use: ThaChalomUse, part: string | null): RoomPillPart {
  const color = use.kind === "dept" ? use.dept.color : use.kind === "closed" ? CLOSED_COLOR : FREE_COLOR;
  return { part, color, name: usageText(use) };
}

function partsOf(entry: ThaChalomRoomDay): RoomPillPart[] {
  return entry.split ? [partOf(entry.am, "เช้า"), partOf(entry.pm, "บ่าย")] : [partOf(entry.am, null)];
}

/**
 * รพ.ท่าฉลอม's day (Pong, 26 Nov 2026: the hospital's weekly table, lib/tha-chalom-schedule.ts), laid out as รพ.สมุทรสาคร's
 * board is (Pong, 27 Nov 2026: "Arrange component of ท่าฉลอม exact same as สมทุรสาคร"; components/suite-board.tsx): the
 * floor plan, each OR in its department's colour, which a sideways swipe moves to the workday before or after; from
 * 1024px the list of the day's open rooms beside it, on the same glass card as รพ.สมุทรสาคร's ห้องที่เปิด, the Scope room
 * among them on the days it is in use. Its doctors book its rooms there too (Pong, 27 Nov 2026: "Add booking btn on
 * ท่าฉลอม also"): the จองห้อง button under the plan opens the booking form for this hospital (their department's room
 * in its table only), and a tap on an open room, on the plan or in the list, shows its booked cases in รพ.สมุทรสาคร's
 * sheet (bottom sheet on a phone, the card beside the plan on a computer), the doctor's own with their actions. MX's
 * HOSxP upload holds its cases too (Pong, 27 Nov 2026: "Excel file include both place on one sheet"): its rows are
 * รพ.สมุทรสาคร's kind (lib/board-rows.ts buildThaChalomRows), HOSxP cases matched with the bookings by HN, with the same
 * icons and "!" marks, and the strip above the plan has รพ.สมุทรสาคร's notices: no HOSxP list yet for the day, and the
 * cases no room takes that day ("Leave off board and display on noti bar for both places").
 */
export function ThaChalomBoard({
  date,
  pick,
  pathname = THA_CHALOM_PATH,
  board = null,
  roomId = null,
  adding = null,
  periods = DEFAULT_REPAIR_PERIODS,
}: {
  date: string;
  pick: DatePick | null;
  pathname?: string;
  /**
   * The day's rows (lib/board-rows.ts buildThaChalomRows), with an HN only where the viewer may see it, and what the
   * strip's notices need; none (the preview) shows no cases and no notice.
   */
  board?: Pick<BoardView, "rows" | "uploaded" | "mismatchByRoom" | "offBoard"> | null;
  /** The room open from the address (?room=), when it is open that day. */
  roomId?: string | null;
  /** Shown to doctors: the จองห้อง button and its booking form. */
  adding?: CaseAdding | null;
  /** The repair's dates, which the booking form's checks take (they touch only รพ.สมุทรสาคร's rooms). */
  periods?: RepairPeriods;
}) {
  const router = useRouter();
  const rows = board?.rows ?? NONE;
  const mismatches = board?.mismatchByRoom ?? NO_MISMATCH;
  const notices = useBoardNotices(board ? { date, uploaded: board.uploaded, offBoard: board.offBoard } : null, false);
  // The notice whose chat bubble is open (BoardNotices); forgotten when its notice goes (a refresh, an upload).
  const [noticeId, setNoticeId] = useState<string | null>(null);
  if (noticeId !== null && !notices.some((notice) => notice.id === noticeId)) setNoticeId(null);
  const noTable = notices.some((notice) => notice.id === "no-upload");
  const day = useMemo(() => thaChalomDay(date), [date]);
  const open = useMemo(() => openRooms(day), [day]);
  const selectable = (id: string | null) => (id ? (open.find((entry) => entry.room.id === id) ?? null) : null);
  const urlRoom = selectable(roomId)?.room.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(urlRoom);
  const [prevUrl, setPrevUrl] = useState(urlRoom);
  if (prevUrl !== urlRoom) {
    setPrevUrl(urlRoom);
    setSelectedId(urlRoom);
  }
  const [full, setFull] = useState(false);
  const [addRequest, setAddRequest] = useState<CaseRequest | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cardHeadingRef = useRef<HTMLHeadingElement>(null);
  const menuWasOpen = useRef(false);
  if (!adding && addRequest) setAddRequest(null);

  // A refresh or another day can close the room: the sheet and its card go with it.
  const entry = selectable(selectedId);
  const isOpen = entry !== null;
  if (full && !isOpen) setFull(false);

  const counts = useMemo(() => {
    const next: Record<string, number> = {};
    for (const item of rows) next[item.roomId] = (next[item.roomId] ?? 0) + 1;
    return next;
  }, [rows]);
  const total = open.reduce((sum, item) => sum + (counts[item.room.id] ?? 0), 0);
  const cases = entry ? rows.filter((item) => item.roomId === entry.room.id).sort((a, b) => a.order - b.order) : [];
  const allocation = entry ? thaChalomAllocation(entry.room.id, date) : null;

  function choose(id: string | null) {
    if (id && !selectable(id)) return;
    setSelectedId(id);
    startTransition(() => {
      router.replace(boardHref(id, pathname, window.location.search), { scroll: false });
    });
  }

  useEffect(() => {
    if (isOpen) headingRef.current?.focus({ preventScroll: true });
  }, [isOpen, selectedId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Escape in a dialog (the booking form, the date picker's card) or an open popover (the account menu) is theirs.
      if (addRequest || document.querySelector("dialog[open]") || isPopoverOpen()) return;
      // Then an open notice bubble's, as on รพ.สมุทรสาคร's board: its badge gets the focus back only from the strip.
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
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:overflow-visible">
          {/* รพ.สมุทรสาคร's notice strip, the same height, so the plan sits where its plan does (Pong, 27 Nov 2026: "No
              booking button and notification bar on ท่าฉลอม"), with its notices. */}
          <BoardNotices notices={notices} openId={noticeId} onOpenChange={setNoticeId} />
          {/* The plan stops above the จองห้อง button and its glow, as on รพ.สมุทรสาคร's board. */}
          <DaySwipe
            day={date}
            pick={pick}
            pathname={pathname}
            className={`flex min-h-0 flex-1 overflow-hidden p-1 lg:p-0 ${adding ? "pb-[calc(max(0.75rem,env(safe-area-inset-bottom))_+_3.75rem)] lg:pb-[4.5rem]" : ""}`}
          >
            {/* As wide as รพ.สมุทรสาคร's plan, in the same place (globals.css .tc-plan). */}
            <ThaChalomPlan
              day={day}
              className="tc-plan"
              selectedId={selectedId}
              onSelect={(id) => choose(selectedId === id ? null : id)}
              cases={counts}
              mismatches={mismatches}
            />
          </DaySwipe>
          {adding ? (
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

        {isOpen ? (
          <button
            type="button"
            className="scrim fixed inset-0 z-10 cursor-default bg-[rgb(36_28_22/0.25)] lg:hidden"
            aria-label="ปิดรายการห้อง"
            onPointerDown={() => {
              menuWasOpen.current = isPopoverOpen() || isCaseBubbleOpen();
            }}
            onClick={(event) => {
              const closedMenu = menuWasOpen.current && event.detail !== 0;
              menuWasOpen.current = false;
              if (!closedMenu) choose(null);
            }}
          />
        ) : null}

        <aside
          aria-label="รายการผ่าตัดของห้อง"
          data-room-view=""
          className={`room-sheet z-20 flex min-h-0 flex-col overflow-hidden max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[60dvh] max-lg:rounded-t-[24px] lg:static lg:h-full lg:w-[26rem] lg:shrink-0 xl:w-[30rem] 2xl:w-[34rem] ${isOpen ? "is-open" : "max-lg:pointer-events-none"}`}
        >
          {entry ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <RoomHead title={entry.room.name} count={cases.length} allocation={allocation} noTable={noTable} headingRef={headingRef} handle>
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
              <CaseList key={entry.room.id} cases={cases} own={own} />
              {full ? (
                <RoomCard onClose={() => setFull(false)} headingRef={cardHeadingRef}>
                  <RoomHead
                    title={entry.room.name}
                    count={cases.length}
                    allocation={allocation}
                    noTable={noTable}
                    headingRef={cardHeadingRef}
                    headingId="room-full-title"
                    eyebrow={thaiDate(date, "short")}
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
                  <CaseList key={entry.room.id} cases={cases} own={own} />
                </RoomCard>
              ) : null}
            </div>
          ) : (
            // Before a room is picked, on a computer: the day's open rooms, each a way to open it as on the plan.
            <div aria-labelledby="tc-rooms-heading" className="hidden min-h-0 flex-1 flex-col lg:flex" data-testid="tc-rooms">
              <div className="shrink-0 border-b border-line px-5 pt-4 pb-3.5">
                <div className="flex min-h-11 items-center gap-2.5">
                  <h2 id="tc-rooms-heading" className="text-xl leading-snug font-bold text-ink">
                    ห้องที่เปิด
                  </h2>
                  <span className="count-tag" data-testid="tc-open-count">
                    <span className="tabular-nums">{open.length}</span> ห้อง · <span className="tabular-nums">{total}</span> รายการ
                  </span>
                </div>
                {/* The hospital's table is for office hours only. */}
                <p className="mt-0.5 text-sm text-muted">เฉพาะในเวลาราชการ</p>
              </div>
              {open.length > 0 ? (
                <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1.5">
                  {open.map((item) => {
                    const count = counts[item.room.id] ?? 0;
                    const mismatch = (mismatches[item.room.id] ?? 0) > 0;
                    return (
                      <li key={item.room.id} data-testid="tc-room" data-room={item.room.id}>
                        <button
                          type="button"
                          className="flex w-full cursor-pointer items-center gap-3 px-5 py-2.5 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                          onClick={() => choose(item.room.id)}
                          data-testid={`tc-open-${item.room.id}`}
                        >
                          {/* The warning sits right after the badge, as in รพ.สมุทรสาคร's list. */}
                          <span className="flex min-w-0 flex-1 items-center gap-2.5">
                            <RoomPill
                              prefix={item.room.prefix}
                              number={item.room.number}
                              label={item.room.name}
                              parts={partsOf(item)}
                              testId={`tc-pill-${item.room.id}`}
                            />
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
              ) : (
                <p className="flex flex-1 items-center justify-center px-8 text-center text-sm font-medium text-muted">ไม่มีห้องที่เปิด</p>
              )}
            </div>
          )}
        </aside>
      </div>
      {adding ? (
        <AddCase
          request={addRequest}
          onClosed={() => {
            setAddRequest(null);
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
          holidays={adding.holidays}
          unlisted={adding.unlisted}
          periods={periods}
          initialMine={adding.mine}
          onAdd={adding.onAdd}
          onEdit={adding.onEdit}
          onRemove={adding.onRemove}
          onDay={adding.onDay}
          place="tha-chalom"
        />
      ) : null}
    </main>
  );
}
