"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { bubblePlace, PLACE_NOTICES_ID, type BoardNotice, type NoticeIcon } from "@/lib/board-notices";

import { NoTableIcon } from "@/components/no-table-icon";

/**
 * The icons are Lucide's (https://lucide.dev, ISC licence, Copyright (c) Lucide Contributors): database (in
 * NoTableIcon), flask-conical, door-closed, chevron-down and x.
 */
function Glyph({ size = 16, name, children }: { size?: number; name?: string; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon={name}
    >
      {children}
    </svg>
  );
}

function NoticeGlyph({ icon, size = 16 }: { icon: NoticeIcon; size?: number }) {
  if (icon === "no-table") return <NoTableIcon size={size} />;
  if (icon === "no-room") {
    return (
      <Glyph size={size} name="no-room">
        <path d="M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14" />
        <path d="M2 20h20" />
        <path d="M14 12v.01" />
      </Glyph>
    );
  }
  return (
    <Glyph size={size}>
      <path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2" />
      <path d="M6.453 15h11.094" />
      <path d="M8.5 2h7" />
    </Glyph>
  );
}

/** The slot is in the page from the first paint and never moves: nothing to watch. */
function noSubscription(): () => void {
  return () => {};
}

export const NOTICE_BUBBLE_ID = "board-notice-bubble";

/** The badge of a notice, for giving focus back to it. */
export function noticeBadge(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-notice-id="${CSS.escape(id)}"]`);
}

/**
 * The board's notices, tucked into its own hospital in the bar's switch (Pong, 27 Nov 2026: "move noti bar to subtlety
 * within place selection button"), so the plan takes the strip's old room. Each notice is a small chip beside the
 * hospital's name: its icon, with the count when it has one (no-room); its whole message is its spoken name. A tap
 * opens the message as a chat bubble under the switch, with a shadow; a tap outside it, its close button, the chip
 * again, focus moving away or Escape (handled by the board, which owns Escape) closes it. Each chip says what it means
 * by an icon and its spoken name, never by colour alone. Without a switch in the bar (none so far), the chips sit in a
 * row of their own above the plan, as the strip did.
 */
export function BoardNotices({
  notices,
  openId,
  onOpenChange,
}: {
  notices: readonly BoardNotice[];
  /** The notice whose bubble is open. */
  openId: string | null;
  onOpenChange: (id: string | null) => void;
}) {
  const fallbackRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  // The switch is drawn by the page's bar, outside the board. Undefined on the server and while hydrating, so nothing is
  // drawn before it is known where.
  const slot = useSyncExternalStore(
    noSubscription,
    () => document.getElementById(PLACE_NOTICES_ID),
    () => undefined,
  );
  const [place, setPlace] = useState<ReturnType<typeof bubblePlace> | null>(null);
  const open = notices.find((notice) => notice.id === openId) ?? null;

  const measure = useCallback(() => {
    // What the bubble hangs from: the whole switch, or the fallback row.
    const box = slot ? slot.closest<HTMLElement>("[data-testid=place-tabs]") : fallbackRef.current;
    const badge = open ? noticeBadge(open.id) : null;
    if (!box || !badge) return setPlace(null);
    const frame = box.getBoundingClientRect();
    const rect = badge.getBoundingClientRect();
    // As wide as the screen allows, not only the switch: placed in the window's coordinates, then given in the switch's.
    const at = bubblePlace({ width: document.documentElement.clientWidth }, { left: rect.left, width: rect.width });
    setPlace({ ...at, left: at.left - frame.left });
  }, [open, slot]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (bubbleRef.current?.contains(target)) return;
      // A chip's own click opens, switches or closes its bubble.
      if (target instanceof Element && target.closest("[data-notice-id]")) return;
      onOpenChange(null);
    }
    window.addEventListener("resize", measure);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("resize", measure);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, measure, onOpenChange]);

  // Keyboard focus that leaves the chips and the bubble closes the bubble, so it never hides what has the focus. A click
  // on nothing focusable (no next element) is the pointer handler's to judge.
  function onBlur(event: React.FocusEvent) {
    const next = event.relatedTarget;
    if (!open || !(next instanceof Node)) return;
    if (next instanceof Element && next.closest("[data-notice-strip]")) return;
    onOpenChange(null);
  }

  const chips =
    notices.length > 0 ? (
      <ul className="notice-strip" aria-label="การแจ้งเตือน" data-notice-strip data-testid="notice-strip" onBlur={onBlur}>
        {notices.map((notice) => {
          const expanded = notice.id === openId;
          return (
            <li key={notice.id} className="notice-item">
              <button
                type="button"
                className="notice-badge"
                data-tone={notice.tone}
                data-notice-id={notice.id}
                aria-haspopup="dialog"
                aria-expanded={expanded}
                aria-controls={expanded ? NOTICE_BUBBLE_ID : undefined}
                title={notice.text}
                onClick={() => onOpenChange(expanded ? null : notice.id)}
                data-testid={notice.testId}
              >
                <NoticeGlyph icon={notice.icon} size={15} />
                {notice.count != null ? (
                  <span className="notice-badge-count" aria-hidden="true">
                    {notice.count}
                  </span>
                ) : null}
                {/* The whole message, for screen readers: the chip itself shows only its icon and count. */}
                <span className="sr-only">{notice.text}</span>
              </button>
            </li>
          );
        })}
      </ul>
    ) : null;

  const bubble =
    open && place ? (
      <div
        ref={bubbleRef}
        id={NOTICE_BUBBLE_ID}
        role="dialog"
        aria-labelledby={`${NOTICE_BUBBLE_ID}-title`}
        aria-describedby={`${NOTICE_BUBBLE_ID}-detail`}
        className="notice-bubble"
        data-tone={open.tone}
        data-notice-strip
        style={{ left: place.left, width: place.width, "--tail": `${place.tail}px` } as CSSProperties}
        data-testid="notice-bubble"
        onBlur={onBlur}
      >
        <span className="notice-bubble-icon">
          <NoticeGlyph icon={open.icon} size={18} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p id={`${NOTICE_BUBBLE_ID}-title`} className="text-[0.9375rem] leading-snug font-semibold text-ink">
            {open.text}
          </p>
          <p id={`${NOTICE_BUBBLE_ID}-detail`} className="mt-1 text-sm leading-relaxed text-ink-2">
            {open.detail}
          </p>
        </div>
        <button
          type="button"
          className="notice-bubble-close"
          aria-label="ปิด"
          onClick={() => {
            onOpenChange(null);
            noticeBadge(open.id)?.focus();
          }}
        >
          <Glyph>
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </Glyph>
        </button>
      </div>
    ) : null;

  if (slot === undefined) return null;
  const box = slot?.closest<HTMLElement>("[data-testid=place-tabs]");
  if (slot && box) {
    return (
      <>
        {createPortal(chips, slot)}
        {bubble ? createPortal(bubble, box) : null}
      </>
    );
  }
  return (
    <div ref={fallbackRef} className="notice-row">
      {chips}
      {bubble}
    </div>
  );
}
