"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { CaseResult } from "@/app/(board)/actions";
import { AddCase, type Doctor } from "@/components/add-case";
import { BoardAlerts } from "@/components/board-alerts";
import { CaseFlag, CaseSource } from "@/components/case-source";
import { FloorPlan, UNALLOCATED_FILL } from "@/components/floor-plan";
import { firstBookingDay, type AddedCase } from "@/lib/added-cases";
import { allocationFor, readableTextOn, type Department } from "@/lib/allocation";
import { missingUploadDay, type BoardRow, type BoardRows } from "@/lib/board-rows";
import { boardHref } from "@/lib/days";
import { repairOn, type RepairPeriods } from "@/lib/repair";
import { getRoom, isSelectableRoom, roomLabel } from "@/lib/rooms";
import { roomMark, type CaseStatus } from "@/lib/schedule";

const STATUS_LABEL: Record<CaseStatus, string> = {
  scheduled: "รอ",
  "in-progress": "กำลังผ่าตัด",
  delayed: "เลื่อน",
  done: "เสร็จ",
  cancelled: "ยกเลิก",
  recovery: "พักฟื้น",
};

const NONE: BoardRow[] = [];
const NO_MISMATCH: Record<string, number> = {};

/**
 * The board's day: its date and case rows (lib/board-rows.ts: the HOSxP workbook's cases matched with the doctors'
 * bookings). The server has already left out every HN the viewer may not see.
 */
export type BoardView = Pick<BoardRows, "uploaded" | "mismatchCount" | "mismatchByRoom"> & {
  /** The board's date, YYYY-MM-DD: today until 16:00, then the next workday (lib/board-day.ts). */
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

export function SuiteBoard({
  board,
  today,
  periods,
  holiday = null,
  roomId = null,
  pathname = "/",
  adding = null,
  casesUnavailable = false,
}: {
  /** The board's day, or null when the suite is closed (the preview of a weekend or holiday). */
  board: BoardView | null;
  /** Today in Thailand, YYYY-MM-DD: decides which rooms are in use when there is no board. */
  today: string;
  /** The repair's dates (lib/repair-store.ts), loaded by the page. */
  periods: RepairPeriods;
  /** The name of today's Thai public or special holiday, if it is one. */
  holiday?: string | null;
  roomId?: string | null;
  pathname?: string;
  /** Shown to doctors: the จองห้อง button and its booking form. */
  adding?: CaseAdding | null;
  /** The bookings and the HOSxP cases could not be loaded, so the rooms show none. */
  casesUnavailable?: boolean;
}) {
  const router = useRouter();
  // The day whose rooms are shown: the board's own date, or today when the suite is closed.
  const day = board?.date ?? today;
  const repair = repairOn(day, periods);
  const found = getRoom(roomId);
  const urlRoom = found && isSelectableRoom(found, day, periods) ? found.id : null;
  const [selectedId, setSelectedId] = useState<string | null>(urlRoom);
  const [prevUrl, setPrevUrl] = useState(urlRoom);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [addRequest, setAddRequest] = useState<{ roomId: string | null } | null>(null);
  const menuWasOpen = useRef(false);

  if (prevUrl !== urlRoom) {
    setPrevUrl(urlRoom);
    setSelectedId(urlRoom);
  }

  const operations = board?.rows ?? NONE;
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
      // Escape in the add-case dialog closes the dialog only.
      if (addRequest) return;
      // Escape belongs to an open popover (the account menu) first.
      if (isPopoverOpen()) return;
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

  return (
    <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="relative mx-auto flex min-h-0 w-full max-w-[120rem] flex-1 flex-col overflow-hidden sm:px-3 lg:flex-row lg:gap-6 lg:px-6 lg:pt-3 lg:pb-4">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <BoardAlerts
            closed={board === null}
            holiday={holiday}
            failed={casesUnavailable}
            missingUpload={missingUploadDay(board, casesUnavailable)}
            mismatches={board?.mismatchCount ?? 0}
            repair={repair}
          />
          <div className="flex min-h-0 flex-1 justify-center overflow-hidden p-1 lg:p-0">
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
            // Below the plan's corner on every screen; on phones the room sheet covers it and carries its own button.
            <button
              type="button"
              className="btn btn-primary absolute right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[5] rounded-full px-5 shadow-[0_8px_24px_-6px_rgb(41_29_20/0.45)] lg:right-0 lg:bottom-0"
              onClick={() => setAddRequest({ roomId: null })}
              data-testid="add-case-button"
            >
              {PLUS}
              จองห้อง
            </button>
          ) : null}
        </div>

        {open ? (
          <button
            type="button"
            className="scrim fixed inset-0 z-10 cursor-default bg-[rgb(36_28_22/0.25)] lg:hidden"
            aria-label="ปิดรายการห้อง"
            onPointerDown={() => {
              // A tap outside the account menu closes the menu; it should not also close the room.
              // The menu is already gone by the time the click fires, so note it now.
              menuWasOpen.current = isPopoverOpen();
            }}
            onClick={() => {
              if (menuWasOpen.current) {
                menuWasOpen.current = false;
                return;
              }
              choose(null);
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
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost size-11 min-h-0 shrink-0 rounded-full p-0 lg:hidden"
                    aria-label="ปิด"
                    title="ปิด"
                    onClick={() => choose(null)}
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
              {cases.length === 0 ? (
                // The board may show the next workday (from 16:00), so the text names no day.
                <p className="px-5 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] text-center text-sm text-muted">ไม่มีรายการ</p>
              ) : (
                <ol className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
                  {cases.map((item) => (
                    <li key={item.id} data-status={item.status} data-source={item.source} data-flag={item.flag ?? undefined} className="case-row">
                      <span className="order-no mt-0.5">
                        <span className="sr-only">ลำดับ </span>
                        {item.order}
                      </span>
                      <div className="min-w-0">
                        <p className={`font-semibold ${item.status === "cancelled" ? "text-muted line-through" : "text-ink"}`}>
                          {item.procedure}
                          <span className="sr-only"> ({STATUS_LABEL[item.status]})</span>
                        </p>
                        <p className="text-sm text-muted">{item.surgeon}</p>
                        {/* Where the row comes from, what does not match, and the HN only when the server sent it
                            (the booking's doctor, MX and admins). */}
                        <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <CaseSource source={item.source} />
                          <CaseFlag flag={item.flag} />
                          {item.shift === "out" ? <span className="badge badge-warning">นอกเวลา</span> : null}
                          {item.hn ? (
                            <span className="text-xs font-semibold text-ink-2 tabular-nums" data-testid="row-hn">
                              HN {item.hn}
                            </span>
                          ) : null}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
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
          periods={periods}
          // The form starts on the board's day: the next workday (holidays stepped over) once today's list has closed
          // at 16:00.
          firstDay={firstBookingDay(board?.date ?? null, today)}
          initialMine={adding.mine}
          onAdd={adding.onAdd}
          onRemove={adding.onRemove}
        />
      ) : null}
    </main>
  );
}
