import type { ReactNode } from "react";
import type { RowFlag, RowSource } from "@/lib/board-rows";

/**
 * Where a case row comes from (lib/board-rows.ts), as a small chip in the room's list: the HOSxP workbook, a doctor's
 * booking, or both matched by HN. Each chip has an icon and a word, so the source never rests on colour alone. The
 * HOSxP chip is a neutral text badge with a database glyph, not the vendor's logo.
 *
 * The icons are Lucide's (https://lucide.dev, ISC licence, Copyright (c) Lucide Contributors): database,
 * calendar-check and handshake, copied from lucide-static 0.460.0 and drawn at 14px.
 */

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Lucide "database". */
export const DATABASE_ICON = (
  <Icon>
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5V19A9 3 0 0 0 21 19V5" />
    <path d="M3 12A9 3 0 0 0 21 12" />
  </Icon>
);

/** Lucide "calendar-check". */
const CALENDAR_CHECK_ICON = (
  <Icon>
    <path d="M8 2v4" />
    <path d="M16 2v4" />
    <rect width="18" height="18" x="3" y="4" rx="2" />
    <path d="M3 10h18" />
    <path d="m9 16 2 2 4-4" />
  </Icon>
);

/** Lucide "handshake". */
const HANDSHAKE_ICON = (
  <Icon>
    <path d="m11 17 2 2a1 1 0 1 0 3-3" />
    <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
    <path d="m21 3 1 11h-2" />
    <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
    <path d="M3 4h8" />
  </Icon>
);

const SOURCES: Record<RowSource, { text: string; title: string; icon: ReactNode; tone: string }> = {
  hosxp: { text: "HOSxP", title: "จากตาราง HOSxP", icon: DATABASE_ICON, tone: "badge-source" },
  booking: { text: "จอง", title: "แพทย์จองห้อง", icon: CALENDAR_CHECK_ICON, tone: "badge-source" },
  matched: { text: "ตรงกัน", title: "ตาราง HOSxP ตรงกับการจอง", icon: HANDSHAKE_ICON, tone: "badge-source badge-matched" },
};

/** The row's source chip. The short word is spelled out for a pointer (the title) and for a screen reader. */
export function CaseSource({ source }: { source: RowSource }) {
  const { text, title, icon, tone } = SOURCES[source];
  return (
    <span className={`badge ${tone}`} title={title} data-source={source}>
      {icon}
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{title}</span>
    </span>
  );
}

/** A mismatch, in words: a HOSxP case nobody booked is a warning; a booking HOSxP does not list is a stop. */
export const FLAG_TEXT: Record<Exclude<RowFlag, null>, string> = {
  unbooked: "ไม่มีการจอง",
  "not-in-hosxp": "ไม่พบใน HOSxP",
};

export function CaseFlag({ flag }: { flag: RowFlag }) {
  if (!flag) return null;
  return (
    <span className={`badge ${flag === "unbooked" ? "badge-warning" : "badge-stop"}`} data-flag={flag}>
      {FLAG_TEXT[flag]}
    </span>
  );
}
