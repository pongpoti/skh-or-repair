"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { ThaiCalendar, type DayState } from "@/components/thai-date-field";
import { closedDayNote } from "@/lib/added-cases";
import { boardDayHref, thaiDate } from "@/lib/days";
import type { Holiday } from "@/lib/holidays";

/** What the board's date picker needs from the page, all by the server's clock. */
export type DatePick = {
  /** Today in Thailand, YYYY-MM-DD. */
  today: string;
  /** The board's own day (lib/board-day.ts): what it shows when no day is picked. */
  current: string;
  /** The first and last day that can be picked (lib/board-day.ts pickRange). */
  min: string;
  max: string;
  /** The holidays from min to max, closed in the calendar as on the server. */
  holidays: readonly Holiday[];
  /** The years from min to max the BOT gave no holidays for (lib/holidays.ts), named under their months. */
  unlisted: readonly number[];
  /** weekends and holidays from min to max that CVT booked (lib/added-cases.ts booksOffDays): open in the calendar. */
  openDays?: readonly string[];
};

/**
 * A floating card over a tinted page, with a dimmed and blurred backdrop, like the booking form. Its own box carries no
 * padding, so a tap on the dialog element itself is a tap on the backdrop.
 */
const CARD =
  "m-auto max-h-[calc(100dvh-1.5rem)] w-[min(24rem,calc(100%-1.5rem))] overflow-y-auto overscroll-contain rounded-[18px] border border-line bg-surface p-0 text-ink shadow-[0_24px_60px_rgb(41_29_20/0.3)] backdrop:bg-[rgb(36_28_22/0.35)] backdrop:backdrop-blur-[2px]";

/**
 * The board's date as a button that picks another day (Pong, 15 Nov 2026: "Allow user to select date on main page :
 * display floating card with taint bg", then "Display simply as calendar"). A tap on the date, or the line above it,
 * opens a floating card with the month calendar of the booking form (ThaiCalendar: Thai months, the Buddhist year,
 * weekends and holidays closed and named), from the first half's first day, 1 Jan 2026, to the repair's last day
 * (lib/board-day.ts pickRange; Pong, 18 Nov 2026: "allow view calendar backward", and 15 Nov 2026: "Calendar confine
 * Within time range"). Picking a day shows the
 * board for it, with the plan of the repair's half that day falls in, at
 * /?date=YYYY-MM-DD, keeping the room that is open; กลับไปตารางปัจจุบัน, or picking the board's own day, goes back to
 * the address without a date. Escape, the close button or a tap outside the card closes it, and the focus goes back to
 * the date.
 */
export function BoardDatePicker({
  date,
  pick,
  pathname,
  headingClassName,
  children,
}: {
  /** The day shown, YYYY-MM-DD. */
  date: string;
  pick: DatePick;
  pathname: string;
  headingClassName: string;
  /** The date as the top bar writes it. */
  children: ReactNode;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Each opening draws a fresh calendar on the day shown; whether the keyboard opened it moves the focus into it.
  const [opening, setOpening] = useState<{ byKey: boolean; count: number } | null>(null);
  const [pending, startTransition] = useTransition();
  // A tap that closes the account menu or a notice bubble only closes it, as everywhere else on the board.
  const dismissing = useRef(false);

  // An address whose day is the board's own (picked before 16:00 made it so, or one the calendar does not offer) loses
  // its date, so the board turns over at the next 16:00 again instead of staying on that day.
  const current = pick.current;
  useEffect(() => {
    if (date !== current) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("date")) return;
    url.searchParams.delete("date");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [date, current]);

  function show(byKey: boolean) {
    setOpening((prev) => ({ byKey, count: (prev?.count ?? 0) + 1 }));
    dialogRef.current?.showModal();
  }

  function go(iso: string | null) {
    dialogRef.current?.close();
    const href = boardDayHref(iso, pick.current, pathname, window.location.search);
    startTransition(() => router.push(href, { scroll: false }));
  }

  const dayState = (iso: string): DayState => {
    const note = pick.openDays?.includes(iso) ? null : closedDayNote(iso, pick.holidays);
    return note ? { disabled: true, note } : { disabled: false };
  };

  return (
    <>
      <h1 className={headingClassName}>
        {/* The button's ::after covers the whole date block (the line above it too, with its chevron), a 44px target. */}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-busy={pending || undefined}
          onPointerDown={() => {
            let open = document.getElementById("board-notice-bubble") !== null;
            try {
              open ||= document.querySelector(":popover-open") !== null;
            } catch {
              // No popovers in this browser: the account menu is a plain button there.
            }
            dismissing.current = open;
          }}
          onClick={(event) => {
            if (dismissing.current && event.detail !== 0) {
              dismissing.current = false;
              return;
            }
            show(event.detail === 0);
          }}
          className="inline-flex max-w-full cursor-pointer items-center text-left after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus aria-busy:opacity-60"
          data-testid="board-date-button"
        >
          <span className="min-w-0 truncate">{children}</span>
          <span className="sr-only">, เลือกวันที่</span>
        </button>
      </h1>
      <dialog
        ref={dialogRef}
        aria-labelledby="board-date-title"
        className={CARD}
        onClose={() => setOpening(null)}
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
        data-testid="board-date-dialog"
      >
        <div className="p-4 min-[360px]:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 pt-1">
              <h2 id="board-date-title" className="text-lg leading-snug font-bold text-ink">
                เลือกวันที่
              </h2>
              <p className="text-sm text-ink-2">ดูตารางผ่าตัดของวันอื่น</p>
            </div>
            <button
              type="button"
              className="btn btn-ghost size-11 min-h-0 shrink-0 rounded-full p-0"
              aria-label="ปิด"
              onClick={() => dialogRef.current?.close()}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
          {opening ? (
            <ThaiCalendar
              key={opening.count}
              id="board-date-calendar"
              value={date}
              min={pick.min}
              max={pick.max}
              dayState={dayState}
              onPick={go}
              focusOnOpen={opening.byKey}
              today={pick.today}
              unlisted={pick.unlisted}
              className="mt-3"
              testId="board-date-calendar"
            />
          ) : null}
          {date !== pick.current ? (
            <button type="button" className="btn btn-secondary mt-3 w-full" onClick={() => go(null)} data-testid="board-date-current">
              กลับไปตารางปัจจุบัน · {thaiDate(pick.current, "short")}
            </button>
          ) : null}
        </div>
      </dialog>
    </>
  );
}
