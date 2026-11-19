"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition, type PointerEvent, type ReactNode } from "react";
import type { DatePick } from "@/components/board-date-picker";
import { stepDay } from "@/lib/board-day";
import { boardDayHref, shortThaiDay } from "@/lib/days";

/** How far a press moves, in CSS pixels, before it is a drag rather than a tap. */
const LOCK = 10;
/** A drag this far (or a quarter of the plan's width, if less) turns the day when it is let go. */
const TURN = 88;
/** A quick flick turns it sooner: at least this far, at this speed (CSS pixels per millisecond). */
const FLICK = 36;
const FLICK_SPEED = 0.45;
/** A touch that starts this close to the screen's side is the phone's own back gesture, not a swipe. */
const EDGE = 16;
/** How long after a swipe the click it would end in is swallowed, in milliseconds. */
const SWALLOW_MS = 500;

type Drag = { id: number; x: number; y: number; lastX: number; lastT: number; speed: number; locked: boolean };
type Step = -1 | 1;

/** The arrow at the hint's outer end, or a spinner while that day loads. */
function HintMark({ step, loading }: { step: Step; loading: boolean }) {
  if (loading) return <span className="day-swipe-spin" />;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={step === 1 ? "m9 18 6-6-6-6" : "m15 18-6-6 6-6"} />
    </svg>
  );
}

/**
 * The floor plan's area, which a sideways swipe moves to the workday before or after (Pong, 19 Nov 2026: "allow swipe
 * on layout to select date"): a swipe to the left shows the next day, to the right the day before, within the days the
 * date picker offers (lib/board-day.ts stepDay), keeping the open room, as picking that day on the calendar does. The
 * plan follows the finger, and the day it would turn to shows at the side it uncovers, filled once far enough to turn;
 * let go short of that and the plan springs back. At either end of the range the plan only gives a little. Up and down
 * are left to the page, a pinch still zooms, and a tap on a room never turns into a swipe or the other way round. A
 * mouse drag does the same on a computer; the calendar stays the way to pick a day by keyboard.
 */
export function DaySwipe({
  day,
  pick,
  pathname,
  className,
  children,
}: {
  /** The day shown, YYYY-MM-DD. */
  day: string;
  /** The days the picker offers; none turns the swipe off. */
  pick: DatePick | null;
  pathname: string;
  className: string;
  /** The floor plan. */
  children: ReactNode;
}) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const swallowUntil = useRef(0);
  const [pending, startTransition] = useTransition();
  // After a swipe: the side the plan went to, and whether its load has started (the transition seen pending).
  const [leaving, setLeaving] = useState<{ step: Step; loading: boolean } | null>(null);
  // The new day slides in from the side the swipe went to; `n` starts the animation again for each swipe.
  const [entering, setEntering] = useState<{ step: Step; n: number } | null>(null);
  const [shownDay, setShownDay] = useState(day);

  if (shownDay !== day) {
    setShownDay(day);
    if (leaving) {
      setEntering((prev) => ({ step: leaving.step, n: (prev?.n ?? 0) + 1 }));
      setLeaving(null);
    }
  } else if (leaving && pending && !leaving.loading) {
    setLeaving({ ...leaving, loading: true });
  } else if (leaving && !pending && leaving.loading) {
    // The load is over and the day never came (the server kept the board on its day): the plan comes back.
    setLeaving(null);
  }

  const prev = useMemo(() => (pick ? stepDay(day, -1, pick) : null), [day, pick]);
  const next = useMemo(() => (pick ? stepDay(day, 1, pick) : null), [day, pick]);

  /** The plan's offset while dragged, and how near each side's day is to turning (0 to 1, 1 once it will). */
  function paint(shift: number, step: Step | 0, progress: number) {
    const el = box.current;
    if (!el) return;
    el.style.setProperty("--swipe-x", `${shift}px`);
    el.style.setProperty("--swipe-prev", String(step === -1 ? progress : 0));
    el.style.setProperty("--swipe-next", String(step === 1 ? progress : 0));
    if (step !== 0 && progress >= 1) el.dataset.armed = step === 1 ? "next" : "prev";
    else delete el.dataset.armed;
  }

  function release() {
    drag.current = null;
    if (box.current) delete box.current.dataset.dragging;
    paint(0, 0, 0);
  }

  function turnAt(width: number) {
    return Math.min(TURN, width * 0.25);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!pick || leaving || !event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.pointerType !== "mouse" && (event.clientX < EDGE || event.clientX > window.innerWidth - EDGE)) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastT: event.timeStamp, speed: 0, locked: false };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const now = drag.current;
    const el = box.current;
    if (!now || !el || event.pointerId !== now.id) return;
    const dx = event.clientX - now.x;
    const dy = event.clientY - now.y;
    if (!now.locked) {
      if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return;
      // Mostly up or down: not a swipe, and this press never becomes one.
      if (Math.abs(dx) < Math.abs(dy) * 1.2) {
        drag.current = null;
        return;
      }
      now.locked = true;
      el.dataset.dragging = "";
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        // The pointer is already gone: its pointerup or pointercancel comes next anyway.
      }
    }
    const elapsed = event.timeStamp - now.lastT;
    if (elapsed > 0) now.speed = 0.6 * ((event.clientX - now.lastX) / elapsed) + 0.4 * now.speed;
    now.lastX = event.clientX;
    now.lastT = event.timeStamp;
    const step: Step = dx < 0 ? 1 : -1;
    const target = step === 1 ? next : prev;
    const width = el.clientWidth || 1;
    // With no day on that side the plan gives only a little, and nothing turns.
    const shift = target ? Math.max(-width * 0.45, Math.min(width * 0.45, dx)) : Math.max(-28, Math.min(28, dx * 0.2));
    paint(shift, step, target ? Math.min(1, Math.abs(dx) / turnAt(width)) : 0);
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const now = drag.current;
    if (!now || event.pointerId !== now.id) return;
    const locked = now.locked;
    const speed = now.speed;
    const width = box.current?.clientWidth ?? 0;
    release();
    if (!locked) return;
    // The press was a swipe: the click it ends in reaches no room.
    swallowUntil.current = performance.now() + SWALLOW_MS;
    const dx = event.clientX - now.x;
    const step: Step = dx < 0 ? 1 : -1;
    const target = step === 1 ? next : prev;
    const far = Math.abs(dx) >= turnAt(width);
    const flick = Math.abs(dx) >= FLICK && Math.abs(speed) >= FLICK_SPEED && Math.sign(speed) === Math.sign(dx);
    if (!pick || !target || !(far || flick)) return;
    setLeaving({ step, loading: false });
    const href = boardDayHref(target, pick.current, pathname, window.location.search);
    startTransition(() => router.push(href, { scroll: false }));
  }

  const leavingSide = leaving ? (leaving.step === 1 ? "next" : "prev") : undefined;
  // The day each side would turn to, named at that side, with its arrow pointing out.
  const hint = (step: Step, target: string | null) => {
    if (!target) return null;
    const side = step === 1 ? "next" : "prev";
    const mark = <HintMark step={step} loading={leavingSide === side} />;
    return (
      // Keyed by its day: the next day's hint comes in hidden, rather than fading out from the one that just loaded.
      <span key={target} className={`day-swipe-hint day-swipe-hint-${side}`} aria-hidden="true" data-testid={`swipe-hint-${side}`}>
        {step === -1 ? mark : null}
        {shortThaiDay(target)}
        {step === 1 ? mark : null}
      </span>
    );
  };

  return (
    <div
      ref={box}
      className={`day-swipe ${className}`}
      data-leaving={leavingSide}
      aria-busy={leaving ? true : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={release}
      onLostPointerCapture={(event) => {
        // Only the box's own capture: a touch is captured to the room under it at first, and that capture is lost
        // (and bubbles up here) when the swipe takes the pointer over.
        if (event.target === event.currentTarget && drag.current?.id === event.pointerId) release();
      }}
      onClickCapture={(event) => {
        if (performance.now() >= swallowUntil.current) return;
        swallowUntil.current = 0;
        event.preventDefault();
        event.stopPropagation();
      }}
      data-testid="day-swipe"
    >
      <div
        key={entering?.n ?? 0}
        className={`day-swipe-plan ${entering ? (entering.step === 1 ? "day-swipe-from-next" : "day-swipe-from-prev") : ""}`}
      >
        {children}
      </div>
      {hint(-1, prev)}
      {hint(1, next)}
    </div>
  );
}
