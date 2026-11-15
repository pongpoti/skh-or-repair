import type { ReactNode } from "react";
import type { DoneBy, RowSource } from "@/lib/board-rows";

/**
 * The icon at the right end of a case row (lib/board-rows.ts), centred on the row's height, with no text (Pong, 15 Nov
 * 2026: "no text, move icon to right most of row increase size and align center vertically"). The words stay for a
 * pointer (the title) and a screen reader.
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
 * calendar-check and handshake, copied from lucide-static 0.460.0. The doctor and nurse are Healthicons' filled
 * "doctor" and "nurse" (https://healthicons.org, MIT licence, Copyright (c) 2023 Sten Raadschelders), copied from
 * healthicons-react 3.5.0 and cropped to the figure.
 */

/** A Lucide icon: strokes on a 24-unit grid. */
function Stroke({ children, size }: { children: ReactNode; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** A Healthicons figure: filled shapes on a 48-unit grid, cropped to the figure (it spans 6 to 42). */
function Figure({ children, size }: { children: ReactNode; size: number }) {
  return (
    <svg width={size} height={size} viewBox="5 5 38 38" fill="currentColor" aria-hidden="true">
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

const DOER_ICONS: Record<DoneBy, ReactNode> = {
  // Healthicons "doctor" (filled): a figure with a stethoscope.
  surgeon: (
    <>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M14.4326 33.4416C13.5732 33.9692 13 34.9177 13 36C13 37.6569 14.3431 39 16 39C17.6569 39 19 37.6569 19 36C19 34.476 17.8636 33.2174 16.3919 33.0254C16.3591 32.9079 16.3249 32.7725 16.2901 32.6206C16.1703 32.0972 16.056 31.4332 15.9709 30.7512C15.8856 30.0679 15.8327 29.3904 15.8292 28.8375C15.8279 28.6348 15.8334 28.4582 15.8446 28.3101C16.2293 28.1997 16.6151 28.1003 17 28.0126C17.4413 27.9121 17.7025 28.433 17.9141 28.8551C17.9436 28.9139 17.9721 28.9707 18 29.0237H22.0639C22.9797 29.0235 23.4324 29.0236 23.8903 29.0237C24.3376 29.0238 24.7906 29.0239 25.6851 29.0237H29.7493C29.9775 28.5902 30.4972 27.8981 31 28.0126C31.5363 28.1348 32.0745 28.2798 32.6089 28.4456L32.6056 28.4472C32.6044 28.4449 32.6045 28.4453 32.6057 28.4487C32.6104 28.4627 32.6324 28.5281 32.6542 28.6699C32.6791 28.8313 32.6964 29.0411 32.7035 29.2937C32.7177 29.798 32.6894 30.411 32.6297 31.0287C32.5699 31.6456 32.4811 32.2429 32.3811 32.7144C32.359 32.8188 32.3369 32.9141 32.3152 33H31C30.6212 33 30.275 33.214 30.1056 33.5528L29.1056 35.5528C29.0361 35.6916 29 35.8448 29 36V38C29 38.5523 29.4477 39 30 39H32V37H31V36.2361L31.618 35H34.382L35 36.2361V37H34V39H36C36.5523 39 37 38.5523 37 38V36C37 35.8448 36.9639 35.6916 36.8944 35.5528L35.8944 33.5528C35.725 33.214 35.3788 33 35 33H34.3643C34.4711 32.4673 34.56 31.8448 34.6203 31.2213C34.6856 30.5473 34.7198 29.8478 34.7027 29.2376L34.7019 29.2101C38.6895 30.8949 42 33.6661 42 36.5699V42H6V36.5699C6 33.5376 9.60993 30.6499 13.831 28.993C13.8424 29.6146 13.9013 30.3182 13.9862 30.9988C14.0779 31.7335 14.2029 32.4653 14.3406 33.0669C14.3701 33.1958 14.4008 33.3213 14.4326 33.4416ZM16 37.0147C16.5384 37.0147 17 36.5742 17 36C17 35.4258 16.5384 34.9853 16 34.9853C15.4616 34.9853 15 35.4258 15 36C15 36.5742 15.4616 37.0147 16 37.0147Z"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M24 24C28.4183 24 32 20.4183 32 16C32 11.5817 28.4183 8 24 8C19.5817 8 16 11.5817 16 16C16 20.4183 19.5817 24 24 24ZM24 26C29.5228 26 34 21.5228 34 16C34 10.4772 29.5228 6 24 6C18.4772 6 14 10.4772 14 16C14 21.5228 18.4772 26 24 26Z"
      />
    </>
  ),
  // Healthicons "nurse" (filled): a figure with a cap and a cross.
  scrub: (
    <>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M24 6C21.1943 6 17.7625 7.02621 15.7359 7.73119C14.7482 8.0748 14.2528 9.14841 14.58 10.1417L16.7278 16.662C16.2604 17.6789 16 18.8103 16 20C16 24.4183 19.5817 28 24 28C28.4183 28 32 24.4183 32 20C32 18.8103 31.7396 17.6789 31.2721 16.6619L33.42 10.1417C33.7472 9.14841 33.2518 8.0748 32.2641 7.73119C30.2375 7.02621 26.8056 6 24 6ZM18.3799 18.425C22.1365 16.8821 25.8635 16.8821 29.6201 18.425C29.6807 18.4498 29.743 18.4685 29.8063 18.481C29.9327 18.9656 30 19.4746 30 20C30 23.3137 27.3137 26 24 26C20.6863 26 18 23.3137 18 20C18 19.4746 18.0673 18.9656 18.1937 18.481C18.257 18.4685 18.3193 18.4498 18.3799 18.425ZM25 11H27V13H25V15H23V13H21V11H23V9H25V11Z"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M22.8508 32.1931L16.8786 28C16.8786 28 6 31.3932 6 35.4669V42.0002H42V35.4669C42 31.3932 31.1214 28 31.1214 28L25.1492 32.1931C24.4596 32.6773 23.5404 32.6773 22.8508 32.1931ZM32 32H34V34H36V36H34V38H32V36H30V34H32V32Z"
      />
    </>
  ),
};

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

/** The row's icon: who does the dressing in the dressing room, else where the row comes from. */
export function CaseIcon({ source, doneBy }: { source: RowSource; doneBy?: DoneBy }) {
  if (doneBy) {
    return (
      <span className="case-icon" title={DOER_TITLE[doneBy]} data-testid="row-icon" data-done-by={doneBy}>
        <Figure size={26}>{DOER_ICONS[doneBy]}</Figure>
        <span className="sr-only">{DOER_TITLE[doneBy]}</span>
      </span>
    );
  }
  return (
    <span className={`case-icon${source === "matched" ? " case-icon-matched" : ""}`} title={SOURCE_TITLE[source]} data-testid="row-icon" data-source={source}>
      <Stroke size={22}>{SOURCE_ICONS[source]}</Stroke>
      <span className="sr-only">{SOURCE_TITLE[source]}</span>
    </span>
  );
}
