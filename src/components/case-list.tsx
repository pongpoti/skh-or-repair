"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CaseIcon } from "@/components/case-source";
import type { BoardRow } from "@/lib/board-rows";
import { displayHn } from "@/lib/hn";
import type { CaseStatus } from "@/lib/schedule";

const STATUS_LABEL: Record<CaseStatus, string> = {
  scheduled: "รอ",
  "in-progress": "กำลังผ่าตัด",
  delayed: "เลื่อน",
  done: "เสร็จ",
  cancelled: "ยกเลิก",
  recovery: "พักฟื้น",
};

const NO_IDS: ReadonlySet<string> = new Set();

// A row's id comes from HOSxP's case ID, which can hold any character: kept out of CSS selectors, and made safe for
// an id attribute (aria-controls splits on spaces).
const iconTipId = (id: string) => `case-icon-tip-${encodeURIComponent(id).replace(/[%.!~*'()]/g, "_")}`;

/** The icon button for a row's bubble, found by comparing the attribute, not through a selector. */
function iconFor(root: ParentNode | null | undefined, key: string): HTMLElement | null {
  for (const element of root?.querySelectorAll<HTMLElement>("[data-tip-for]") ?? []) {
    if (element.dataset.tipFor === key) return element;
  }
  return null;
}

/** How far a folded name runs past its column, in CSS pixels, from the text's own box (not rounded to whole pixels). */
function overflowOf(span: HTMLElement, column: HTMLElement): number {
  const range = document.createRange();
  range.selectNodeContents(span);
  return range.getBoundingClientRect().width - column.getBoundingClientRect().width;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function toggled(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** An icon's bubble is open in the room's list (the scrim's tap then closes only it, like the account menu). */
export function isCaseBubbleOpen(): boolean {
  return document.querySelector("[data-case-bubble]") !== null;
}

/**
 * A room's case rows (Pong, 15 and 16 Nov 2026): the operation on one line, the patient's name and the HN for who may
 * see them, the surgeon on one line without the title, the booking's time, and the icon at the right.
 *
 * A name too long for its line ends in "…" and a chevron; a tap on it unfolds the whole name in place, and another
 * folds it (Pong, 16 Nov 2026: "I want op name single line. How do I view full name ?"). Several can be open at once,
 * to tell apart names that differ only at the end (left or right, a level). Only a cut name is a button; the rest of
 * the row is plain text, as before.
 *
 * A tap on the icon says what it means in a bubble of the icon's own colour ("click to display meaning on dialog same
 * bg color of icon"). One bubble at a time; a tap anywhere else (the bubble too), Escape, or moving the focus away
 * closes it, and nothing in the row moves.
 *
 * The parent gives each room its own list (a key), so nothing opened carries over to another room.
 */
export function CaseList({ cases }: { cases: readonly BoardRow[] }) {
  const listRef = useRef<HTMLOListElement>(null);
  // The rows whose operation name does not fit on its line, measured in the browser, and those unfolded.
  const [cut, setCut] = useState<ReadonlySet<string>>(NO_IDS);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(NO_IDS);
  // The row whose icon's bubble is open.
  const [tip, setTip] = useState<string | null>(null);

  // A refresh can take the row away: its bubble goes too.
  if (tip !== null && !cases.some((item) => item.id === tip)) setTip(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    // The text's full width against its column's: the same answer with or without the chevron beside it. Measured to
    // the sub-pixel, as the browser draws "…" for any overflow. An unfolded name wraps, so it keeps the answer it had
    // while folded, and is measured again once folded (this runs again when `unfolded` changes).
    const measure = () => {
      setCut((previous) => {
        const next = new Set<string>();
        for (const span of list.querySelectorAll<HTMLElement>("[data-op-id]")) {
          const id = span.dataset.opId ?? "";
          if (unfolded.has(id) && previous.has(id)) {
            next.add(id);
            continue;
          }
          const column = span.closest<HTMLElement>(".case-main");
          if (column && overflowOf(span, column) > 0.01) next.add(id);
        }
        return sameSet(previous, next) ? previous : next;
      });
    };
    measure();
    // The fonts arrive after the first paint and change the widths; a turned phone or another sheet width too.
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) measure();
    });
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [cases, unfolded]);

  useEffect(() => {
    if (tip === null) return;
    const key = `${tip}:icon`;
    // On the click, not on pointerdown: the bubble is still there when the tap lands, so a tap on the bubble closes it
    // and reaches nothing under it (a cut name), and the room's scrim still sees it open and keeps the room.
    function onClick(event: MouseEvent) {
      // The icon itself toggles its bubble on its own click.
      const icon = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tip-for]") : null;
      if (icon?.dataset.tipFor === key) return;
      setTip(null);
    }
    // Focus that moves to anything but the icon closes it too: Tab or Shift+Tab, or Tab out of the page and back in
    // somewhere else. Focus that comes back to the icon itself (another window and back) keeps it.
    function onFocusIn(event: FocusEvent) {
      const icon = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tip-for]") : null;
      if (icon?.dataset.tipFor !== key) setTip(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Escape closes the bubble only, not the room as well (the board's own Escape listens on the window too).
      event.stopImmediatePropagation();
      const button = iconFor(listRef.current, key);
      setTip(null);
      if (button && listRef.current?.contains(document.activeElement)) button.focus();
    }
    document.addEventListener("click", onClick, true);
    document.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [tip]);

  function unfold(id: string, row: HTMLElement | null) {
    if (!unfolded.has(id)) {
      setUnfolded((current) => toggled(current, id));
      // A name unfolded on the last row can reach below the list: the list scrolls just enough to show it.
      if (row) requestAnimationFrame(() => row.scrollIntoView({ block: "nearest" }));
      return;
    }
    // Folded, the name is measured again (the sheet may have widened meanwhile). If it now fits, it is plain text and
    // its button is gone: the focus it had goes to the row's icon rather than to nowhere.
    const hadFocus = row?.contains(document.activeElement) ?? false;
    flushSync(() => setUnfolded((current) => toggled(current, id)));
    if (hadFocus && row && !row.contains(document.activeElement)) iconFor(row, `${id}:icon`)?.focus();
  }

  return (
    <ol ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
      {cases.map((item) => {
        const cancelled = item.status === "cancelled";
        const isCut = cut.has(item.id);
        const open = isCut && unfolded.has(item.id);
        const text = (
          <>
            <span className={`case-op-text${cancelled ? " line-through" : ""}`} data-op-id={item.id}>
              {item.procedure}
            </span>
            <span className="sr-only"> ({STATUS_LABEL[item.status]})</span>
          </>
        );
        return (
          <li
            key={item.id}
            data-status={item.status}
            data-source={item.source}
            data-flag={item.flag ?? undefined}
            data-done-by={item.doneBy}
            className="case-row"
          >
            <span className="order-no mt-0.5">
              <span className="sr-only">ลำดับ </span>
              {item.order}
            </span>
            {/* Pong, 15-16 Nov 2026: the operation on one line, the patient's name and the HN (only when the server sent
                them: the booking's doctor, MX and admins), the surgeon as large as the HN, and the booking's time
                smaller below. */}
            <div className="case-main min-w-0">
              <p className={`case-op-line ${cancelled ? "text-muted" : "text-ink"}`} data-testid="row-op">
                {isCut ? (
                  <button
                    type="button"
                    className="case-op"
                    aria-expanded={open}
                    data-open={open || undefined}
                    onClick={(event) => unfold(item.id, event.currentTarget.closest("li"))}
                  >
                    {text}
                    <svg className="case-op-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                ) : (
                  <span className="case-op">{text}</span>
                )}
              </p>
              {item.patientName ? (
                <p className="case-line font-semibold break-words text-ink-2" data-testid="row-patient">
                  {item.patientName}
                </p>
              ) : null}
              {item.hn ? (
                <p className="case-line font-semibold text-ink-2 tabular-nums" data-testid="row-hn">
                  HN {displayHn(item.hn)}
                </p>
              ) : null}
              <p className="case-line text-ink-2" data-testid="row-surgeon">
                <span className="case-one-line">{item.surgeon}</span>
              </p>
              {item.bookedAt ? (
                <p className="mt-0.5 text-xs text-muted tabular-nums" data-testid="row-booked-at">
                  วันเวลาที่จองคิว : {item.bookedAt}
                </p>
              ) : null}
              {item.shift === "out" ? (
                <p className="mt-1.5">
                  <span className="badge badge-warning">นอกเวลา</span>
                </p>
              ) : null}
            </div>
            {/* Who does the dressing in the dressing room, else where the row comes from: an icon alone, its meaning
                in a bubble on a tap. */}
            <CaseIcon
              source={item.source}
              doneBy={item.doneBy}
              open={tip === item.id}
              tipId={iconTipId(item.id)}
              tipFor={`${item.id}:icon`}
              onToggle={() => setTip((current) => (current === item.id ? null : item.id))}
            />
          </li>
        );
      })}
    </ol>
  );
}
