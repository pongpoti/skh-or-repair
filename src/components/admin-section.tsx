"use client";

import { useState, type ReactNode } from "react";

/**
 * One section of the admin page, closed until its heading row is tapped (Pong, 16 Nov 2026: "make them collapsed by
 * default and disable any button when on collapsed"). Every section starts closed on every visit. While it is closed:
 * - only the heading row shows: the title, the `summary` line under it, and the section's own buttons (`actions`),
 *   greyed out and inert, so they do nothing and cannot be focused;
 * - a tap anywhere on the row opens the section, a tap on a greyed button too (it only opens, it never acts);
 * - the body is hidden but stays mounted, so a draft (new repair dates not yet saved) is still there when it reopens.
 * The title is a real button in the heading (aria-expanded), and its ::after covers the whole row (globals.css
 * .section-toggle), so the row is one 44px+ target with one focus ring.
 */
export function AdminSection({
  id,
  title,
  summary,
  actions,
  testId,
  children,
}: {
  /** Prefix of the ids: `${id}-title` names the section, `${id}-toggle` opens it, `${id}-body` is what it shows. */
  id: string;
  title: string;
  /** A short line under the title, shown open or closed. */
  summary?: ReactNode;
  /** The section's buttons in its heading row: greyed out and inert while the section is closed. */
  actions?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = `${id}-body`;

  return (
    <section className="card overflow-hidden" aria-labelledby={`${id}-title`} data-open={open} data-testid={testId}>
      {/* The title row (title, then the buttons and the chevron), with the summary under it across the whole width. */}
      <div
        className={`section-head relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 p-4 sm:p-5 ${open ? "border-b border-line" : ""}`}
      >
        <h2 className="min-w-0 text-base font-bold text-ink sm:text-lg">
          {/* 44px tall for the finger; the negative margin keeps the title on its own line height. */}
          <button
            type="button"
            id={`${id}-toggle`}
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((value) => !value)}
            className="section-toggle -my-2.5 flex min-h-11 items-center text-left"
          >
            <span id={`${id}-title`}>{title}</span>
          </button>
        </h2>
        <div className="flex items-center gap-2 sm:gap-3">
          {actions ? (
            <div
              inert={!open}
              className={`relative z-10 flex items-center gap-2 transition-opacity ${open ? "" : "pointer-events-none opacity-45 grayscale"}`}
              data-testid={`${id}-actions`}
            >
              {actions}
            </div>
          ) : null}
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            // pointer-events-none: rotated, the chevron would paint above the row's ::after and swallow the tap that closes it.
            className={`pointer-events-none shrink-0 text-muted transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
        {summary ? (
          <div className="col-span-2 text-sm text-muted" data-testid={`${id}-summary`}>
            {summary}
          </div>
        ) : null}
      </div>
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
