"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { badgeText, bubblePlace, type BoardNotice, type NoticeIcon } from "@/lib/board-notices";

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

export const NOTICE_BUBBLE_ID = "board-notice-bubble";

/** The badge of a notice, for giving focus back to it. */
export function noticeBadge(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-notice-id="${CSS.escape(id)}"]`);
}

/**
 * The strip above the plan (Pong, 15 Nov 2026). It always keeps the same height, with or without notices, so the plan
 * never moves. Its badges sit in the middle of one row that scrolls sideways when they do not fit (Pong, 16 Nov 2026:
 * "align this badge center"); alone, a badge says the whole message, and with others
 * each says its short form (the whole one stays in its spoken name). A tap opens the message as a chat bubble under
 * the badge, with a shadow; a tap outside it, its close button, the badge again, focus moving away or Escape (handled by
 * the board, which owns Escape) closes it. Each badge says what it means in words and an icon, never by colour alone.
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLUListElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<ReturnType<typeof bubblePlace> | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const open = notices.find((notice) => notice.id === openId) ?? null;
  const several = notices.length > 1;

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    const badge = open ? noticeBadge(open.id) : null;
    if (!wrap || !badge) return setPlace(null);
    const strip = wrap.getBoundingClientRect();
    const rect = badge.getBoundingClientRect();
    setPlace(bubblePlace({ width: strip.width }, { left: rect.left - strip.left, width: rect.width }));
  }, [open]);

  // Which ends of the row have more badges past them, for the fades that say it scrolls.
  const measureEdges = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const start = strip.scrollLeft > 1;
    const end = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
    setEdges((now) => (now.start === start && now.end === end ? now : { start, end }));
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useLayoutEffect(() => {
    measureEdges();
    const strip = stripRef.current;
    if (!strip || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measureEdges());
    observer.observe(strip);
    return () => observer.disconnect();
  }, [measureEdges, notices]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (bubbleRef.current?.contains(target)) return;
      // A badge's own click opens, switches or closes its bubble.
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

  return (
    <div
      ref={wrapRef}
      className="notice-strip-wrap"
      data-notice-strip
      data-testid="notice-strip"
      onBlur={(event) => {
        // Keyboard focus that leaves the strip and the bubble closes the bubble, so it never hides what has the focus.
        // A click on nothing focusable (no next element) is the pointer handler's to judge.
        const next = event.relatedTarget;
        if (open && next instanceof Node && !wrapRef.current?.contains(next)) onOpenChange(null);
      }}
    >
      {notices.length > 0 ? (
        <ul
          ref={stripRef}
          className="notice-strip"
          aria-label="การแจ้งเตือน"
          data-fade-start={edges.start || undefined}
          data-fade-end={edges.end || undefined}
          onScroll={() => {
            measureEdges();
            if (open) measure();
          }}
        >
          {notices.map((notice) => {
            const expanded = notice.id === openId;
            return (
              <li key={notice.id} className={several ? "notice-item" : "notice-item notice-item-alone"}>
                <button
                  type="button"
                  className="notice-badge"
                  data-tone={notice.tone}
                  data-notice-id={notice.id}
                  aria-haspopup="dialog"
                  aria-expanded={expanded}
                  aria-controls={expanded ? NOTICE_BUBBLE_ID : undefined}
                  onClick={() => onOpenChange(expanded ? null : notice.id)}
                  data-testid={notice.testId}
                >
                  <NoticeGlyph icon={notice.icon} />
                  <span className="notice-badge-text">{badgeText(notice, notices.length)}</span>
                  {/* With others the badge shows the short form; the spoken name carries the whole message too. */}
                  {several ? <span className="sr-only">: {notice.text}</span> : null}
                  <span className="notice-badge-chevron">
                    <Glyph size={14}>
                      <path d="m6 9 6 6 6-6" />
                    </Glyph>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {open && place ? (
        <div
          ref={bubbleRef}
          id={NOTICE_BUBBLE_ID}
          role="dialog"
          aria-labelledby={`${NOTICE_BUBBLE_ID}-title`}
          aria-describedby={`${NOTICE_BUBBLE_ID}-detail`}
          className="notice-bubble"
          data-tone={open.tone}
          style={{ left: place.left, width: place.width, "--tail": `${place.tail}px` } as CSSProperties}
          data-testid="notice-bubble"
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
      ) : null}
    </div>
  );
}
