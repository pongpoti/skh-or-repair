import { DATABASE_ICON } from "@/components/case-source";
import { repairNote, shortThaiDate, type RepairHalf } from "@/lib/repair";

/** Lucide "triangle-alert" (https://lucide.dev, ISC licence, Copyright (c) Lucide Contributors). */
const ALERT_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

/**
 * The one-line notes above the plan, for everyone: the suite closed for a holiday, the cases that could not be loaded,
 * no HOSxP file yet for the board's day, cases that do not match the bookings, and the repair's note. Each note says
 * what it means in words (with an icon for the warnings), never by colour alone. Renders nothing when there is nothing
 * to say.
 */
export function BoardAlerts({
  closed,
  holiday,
  failed,
  missingUpload,
  mismatches,
  repair,
}: {
  /** The suite runs no list on the day shown (a weekend or holiday). */
  closed: boolean;
  /** The holiday's name, when `closed` is for one. */
  holiday: string | null;
  /** The bookings and the HOSxP cases could not be read. */
  failed: boolean;
  /** The board's date when MX has not uploaded its HOSxP file yet, else null. */
  missingUpload: string | null;
  /** Case rows that do not match a booking, or a booking HOSxP does not list. */
  mismatches: number;
  repair: RepairHalf | null;
}) {
  if (!closed && !failed && !missingUpload && mismatches === 0 && !repair) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pt-3 pb-1 lg:px-0 lg:pt-0 lg:pb-3">
      {closed ? <p className="pill px-4">{holiday ? `วันหยุด ${holiday} · ไม่มีตารางผ่าตัด` : "วันนี้เป็นวันหยุด ไม่มีตารางผ่าตัด"}</p> : null}
      {failed ? <p className="pill px-4 text-[var(--stop)]">โหลดเคสไม่สำเร็จ ลองรีเฟรช</p> : null}
      {missingUpload ? (
        <p className="pill px-4 text-late" data-testid="no-upload-alert">
          {DATABASE_ICON}
          ยังไม่มีตาราง HOSxP ของ {shortThaiDate(missingUpload)}
        </p>
      ) : null}
      {mismatches > 0 ? (
        <p className="pill px-4 text-late" data-testid="mismatch-alert">
          {ALERT_ICON}
          {/* One span, so the pill's gap (meant for the icon) does not split the sentence. */}
          <span>
            ไม่ตรงกับการจอง <span className="tabular-nums">{mismatches}</span> รายการ
          </span>
        </p>
      ) : null}
      {repair ? (
        <p className="pill px-4" data-testid="repair-note">
          {repairNote(repair)}
        </p>
      ) : null}
    </div>
  );
}
