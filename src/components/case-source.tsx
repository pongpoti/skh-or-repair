import type { ReactNode } from "react";
import type { DoneBy, RowSource } from "@/lib/board-rows";

/**
 * The icon at the right end of a case row (lib/board-rows.ts), centred on the row's height, with no text (Pong, 15 Nov
 * 2026: "no text, move icon to right most of row increase size and align center vertically"). The words come in a
 * bubble on a tap, and stay for a screen reader.
 *
 * In most rooms the icon says where the row comes from: the HOSxP workbook alone (a database; "For HosXP case without
 * booking, display only DB icon"), a doctor's booking before MX's upload (a calendar), or both matched by HN (a
 * handshake, also green). The three differ in shape, so the source never rests on colour. The HOSxP icon is a database
 * glyph, not the vendor's logo.
 *
 * In the dressing room whether a case was booked does not matter (Pong, 15 Nov 2026: "no more display handshake and DB
 * icon, instead display surgeon and nurse icon, depend whether who do the operation"): the icon says who does the
 * dressing, the doctor or the scrub nurse (BoardRow.doneBy).
 *
 * The source icons are Lucide's (https://lucide.dev, ISC licence, Copyright (c) Lucide Contributors): database,
 * calendar-check and handshake, copied from lucide-static 0.460.0. The doctor and nurse portraits are drawn for this
 * app (Pong, 16 Nov 2026, found the earlier stock figures "weird and not represent").
 */

/** A Lucide icon: strokes on a 24-unit grid. */
function Stroke({ children, size }: { children: ReactNode; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const SOURCE_ICONS: Record<RowSource, ReactNode> = {
  // Lucide "database".
  hosxp: (
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5V19A9 3 0 0 0 21 19V5" />
      <path d="M3 12A9 3 0 0 0 21 12" />
    </>
  ),
  // Lucide "calendar-check".
  booking: (
    <>
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
      <path d="m9 16 2 2 4-4" />
    </>
  ),
  // Lucide "handshake".
  matched: (
    <>
      <path d="m11 17 2 2a1 1 0 1 0 3-3" />
      <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
      <path d="m21 3 1 11h-2" />
      <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
      <path d="M3 4h8" />
    </>
  ),
};

// The doctor and the scrub nurse as small round portraits, drawn for this app in the logo's colours (src/app/icon.svg,
// components/brand-mark.tsx): the tile's brown, teal scrubs, pale mask and face. The doctor wears the logo's scrub cap
// and mask; the nurse wears the same scrub cap in rose with a white cross, and rose scrubs, without a mask. They differ
// in shape (the cross, the mask or the smile), not only in colour.
const TILE = "#54402f";
const TILE_EDGE = "#3f2f24";
const SCRUBS = "#7fbfb7";
const SCRUBS_DARK = "#5a9e96";
const MASK = "#eaf4f5";
const PLEAT = "#a7c9cf";
const FACE = "#f1e7da";
const INK = "#241c16";
const ROSE = "#e49aa2";
const ROSE_DARK = "#c97a84";
const CHEEK = "#f2b3a8";

/** Shoulders on the tile, cut by its round edge. */
const SHOULDERS = "M5.27 39 C7.6 35.7 14 34.3 24 34.3 C34 34.3 40.4 35.7 42.73 39 A24 24 0 0 1 5.27 39 Z";

const DOER_ICONS: Record<DoneBy, ReactNode> = {
  // The doctor: the logo's surgeon, in scrub cap and mask.
  surgeon: (
    <>
      <path d={SHOULDERS} fill={SCRUBS} />
      <path d="M18.8 34.4 L24 41.6 L29.2 34.4 Z" fill={SCRUBS_DARK} />
      <circle cx="24" cy="21.5" r="12" fill={FACE} />
      <path d="M11.7 20.3 C8.6 16.4 9.4 5.4 24 5.4 C38.6 5.4 39.4 16.4 36.3 20.3 Q24 16.6 11.7 20.3 Z" fill={SCRUBS} />
      <path d="M11.9 20.1 Q24 16.6 36.1 20.1" fill="none" stroke={SCRUBS_DARK} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="19.7" cy="21.8" r="1.65" fill={INK} />
      <circle cx="28.3" cy="21.8" r="1.65" fill={INK} />
      <path d="M12.45 24.4 Q24 22.6 35.55 24.4 L34.4 29.4 Q24 36.6 13.6 29.4 Z" fill={MASK} />
      <path d="M16.1 26.9 Q24 25.9 31.9 26.9 M16.8 29.5 Q24 28.6 31.2 29.5" fill="none" stroke={PLEAT} strokeWidth="1.1" strokeLinecap="round" />
    </>
  ),
  // The scrub nurse (Pong picked option A, 16 Nov 2026, after the nurse cap looked "spooky"): the doctor's twin, a pink
  // scrub cap with a white cross, no mask, a smile, shining eyes and rosy cheeks.
  scrub: (
    <>
      <path d={SHOULDERS} fill={ROSE} />
      <path d="M18.8 34.4 L24 41.6 L29.2 34.4 Z" fill={ROSE_DARK} />
      <circle cx="24" cy="21.5" r="12" fill={FACE} />
      <path d="M11.7 20.3 C8.6 16.4 9.4 5.4 24 5.4 C38.6 5.4 39.4 16.4 36.3 20.3 Q24 16.6 11.7 20.3 Z" fill={ROSE} />
      <path d="M11.9 20.1 Q24 16.6 36.1 20.1" fill="none" stroke={ROSE_DARK} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M22.6 9.2 h2.8 v2.4 h2.4 v2.8 h-2.4 v2.4 h-2.8 v-2.4 h-2.4 v-2.8 h2.4 Z" fill="#ffffff" />
      <circle cx="19.7" cy="22.4" r="1.65" fill={INK} />
      <circle cx="28.3" cy="22.4" r="1.65" fill={INK} />
      <circle cx="20.2" cy="21.9" r="0.5" fill="#ffffff" />
      <circle cx="28.8" cy="21.9" r="0.5" fill="#ffffff" />
      <ellipse cx="16.6" cy="26.4" rx="2" ry="1.3" fill={CHEEK} />
      <ellipse cx="31.4" cy="26.4" rx="2" ry="1.3" fill={CHEEK} />
      <path d="M20.6 27.6 Q24 30.8 27.4 27.6" fill="none" stroke="#b0624a" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
};

/** A portrait on a round tile in the logo's brown, 48 units across; it fills the 40px tile, which has no border of its own. */
function Portrait({ children, size }: { children: ReactNode; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="24" fill={TILE} />
      {children}
      <circle cx="24" cy="24" r="23.4" fill="none" stroke={TILE_EDGE} strokeWidth="1.2" />
    </svg>
  );
}

/** What each source means, for the title and a screen reader. */
export const SOURCE_TITLE: Record<RowSource, string> = {
  hosxp: "จากตาราง HOSxP ไม่มีการจอง",
  booking: "แพทย์จองห้อง",
  matched: "ตาราง HOSxP ตรงกับการจอง",
};

/** Who does a dressing, as the booking form's answers say it (lib/added-cases.ts scrubTag). */
export const DOER_TITLE: Record<DoneBy, string> = {
  surgeon: "แพทย์ทำเอง",
  scrub: "ฝาก scrub ทำ",
};

/** The bubble's colour: the icon's own (Pong, 16 Nov 2026: "nurse = pink, surgeon = green"). */
type Tone = DoneBy | RowSource;

/**
 * The row's icon: who does the dressing in the dressing room, else where the row comes from. It is a button: a tap says
 * what it means in a bubble beside it, in the icon's colour (Pong, 16 Nov 2026: "click to display meaning on dialog
 * same bg color of icon"), as a phone has no pointer to show a title. The list (components/case-list.tsx) keeps which
 * bubble is open and closes it on a tap elsewhere or Escape.
 */
export function CaseIcon({
  source,
  doneBy,
  open = false,
  tipId,
  tipFor,
  onToggle,
}: {
  source: RowSource;
  doneBy?: DoneBy;
  open?: boolean;
  /** The bubble's id, for aria-controls. */
  tipId?: string;
  /** The list's key for this bubble: a tap on the button itself toggles it rather than closing it. */
  tipFor?: string;
  onToggle?: () => void;
}) {
  const label = doneBy ? DOER_TITLE[doneBy] : SOURCE_TITLE[source];
  const tone: Tone = doneBy ?? source;
  // Each source its own colour (Pong, 16 Nov 2026: "database and calendar should be different").
  const look = doneBy ? " case-icon-doer" : ` case-icon-${source}`;
  return (
    <span className="case-icon-wrap">
      <button
        type="button"
        className={`case-icon${look}`}
        aria-expanded={open}
        aria-controls={open ? tipId : undefined}
        data-testid="row-icon"
        data-source={doneBy ? undefined : source}
        data-done-by={doneBy}
        data-tip-for={tipFor}
        onClick={onToggle}
      >
        {doneBy ? <Portrait size={40}>{DOER_ICONS[doneBy]}</Portrait> : <Stroke size={22}>{SOURCE_ICONS[source]}</Stroke>}
        <span className="sr-only">{label}</span>
      </button>
      {open ? (
        <span id={tipId} className="case-tip" data-tone={tone} data-case-bubble="" data-testid="row-icon-tip">
          {label}
        </span>
      ) : null}
    </span>
  );
}
