import { shortThaiDate } from "./repair.ts";

/**
 * The notices in the strip above the plan (Pong, 15 Nov 2026): the suite closed for a holiday, cases that could not be
 * loaded, no HOSxP file yet for the board's day, and cases that do not match the bookings. Each one is a badge; a tap
 * opens its full message as a chat bubble. The repair needs no notice: the plan's own "พื้นที่ปิดซ่อม" zone shows it.
 */

export type NoticeTone = "neutral" | "warning" | "danger";
export type NoticeIcon = "calendar" | "database" | "alert";

export type BoardNotice = {
  id: "holiday" | "failed" | "no-upload" | "mismatch";
  tone: NoticeTone;
  icon: NoticeIcon;
  /** The whole message in one line: the badge's text when it is alone, and the bubble's title. */
  text: string;
  /** The badge's text when several badges share the strip. */
  short: string;
  /** What it means and what happens next, under the title in the bubble. */
  detail: string;
  /** Kept from the one-line notes the badges replace, for the end-to-end tests. */
  testId?: string;
};

export function boardNotices({
  closed,
  holiday,
  failed,
  missingUpload,
  mismatches,
  today = null,
}: {
  /** The suite runs no list on the day shown (a weekend or holiday). */
  closed: boolean;
  /** The holiday's name, when `closed` is for one. */
  holiday: string | null;
  /** The bookings and the HOSxP cases could not be read. */
  failed: boolean;
  /** The board's date when MX has not uploaded its HOSxP file yet, else null. */
  missingUpload: string | null;
  /** Case rows that do not match a booking, or bookings HOSxP does not list. */
  mismatches: number;
  /** Today, YYYY-MM-DD: a missing upload for a day before it (a past day picked on the board) is not "yet" to come. */
  today?: string | null;
}): BoardNotice[] {
  const notices: BoardNotice[] = [];
  if (closed) {
    notices.push({
      id: "holiday",
      tone: "neutral",
      icon: "calendar",
      text: holiday ? `วันหยุด ${holiday} · ไม่มีตารางผ่าตัด` : "วันนี้เป็นวันหยุด ไม่มีตารางผ่าตัด",
      short: "วันหยุด",
      detail: "วันหยุดไม่มีตารางผ่าตัดตามปกติ ตารางจะกลับมาในวันทำการถัดไป",
    });
  }
  if (failed) {
    notices.push({
      id: "failed",
      tone: "danger",
      icon: "alert",
      text: "โหลดเคสไม่สำเร็จ ลองรีเฟรช",
      short: "โหลดไม่สำเร็จ",
      detail: "อ่านการจองและตาราง HOSxP จากระบบไม่ได้ ห้องจึงยังไม่แสดงรายการ ลองรีเฟรชหน้านี้อีกครั้ง",
    });
  }
  if (missingUpload && today && missingUpload < today) {
    notices.push({
      id: "no-upload",
      tone: "warning",
      icon: "database",
      text: `ไม่มีตาราง HOSxP ของ ${shortThaiDate(missingUpload)}`,
      short: "ไม่มี HOSxP",
      detail: "ไม่พบตารางจาก HOSxP ที่อัปโหลดไว้สำหรับวันนี้ ห้องจึงแสดงเฉพาะการจองของแพทย์",
      testId: "no-upload-alert",
    });
  } else if (missingUpload) {
    notices.push({
      id: "no-upload",
      tone: "warning",
      icon: "database",
      text: `ยังไม่มีตาราง HOSxP ของ ${shortThaiDate(missingUpload)}`,
      short: "ยังไม่มี HOSxP",
      detail: "MX อัปโหลดตารางจาก HOSxP ทุกวัน เวลา 15:00–16:00 สำหรับวันทำการถัดไป ระหว่างนี้ห้องแสดงเฉพาะการจองของแพทย์",
      testId: "no-upload-alert",
    });
  }
  if (mismatches > 0) {
    notices.push({
      id: "mismatch",
      tone: "warning",
      icon: "alert",
      text: `ไม่ตรงกับการจอง ${mismatches} รายการ`,
      short: `ไม่ตรง ${mismatches}`,
      detail: "เคสใน HOSxP กับการจองของแพทย์ไม่ตรงกัน ห้องที่มีสามเหลี่ยม ! ที่มุมคือห้องที่มีรายการไม่ตรง แตะห้องเพื่อดูรายละเอียด",
      testId: "mismatch-alert",
    });
  }
  return notices;
}

/**
 * Every kind of notice at once, for seeing how the strip looks with all of them (Pong, 15 Nov 2026: "Test mode: show me
 * all possible notification badges stacked within noti bar"): an admin's /?notices=all, and the preview's.
 */
export function everyNotice(date: string, holiday = "วันปิยมหาราช"): BoardNotice[] {
  return boardNotices({ closed: true, holiday, failed: true, missingUpload: date, mismatches: 3 });
}

/** A badge's text: the whole message when it is alone in the strip, its short form when there are several. */
export function badgeText(notice: BoardNotice, count: number): string {
  return count > 1 ? notice.short : notice.text;
}

/**
 * Where the bubble goes under its badge, in the strip's own coordinates: as wide as fits (at most `maxWidth`), centred
 * on the badge but kept `margin` inside the strip, with its tail on the badge's centre and clear of the rounded corners.
 */
export function bubblePlace(
  strip: { width: number },
  badge: { left: number; width: number },
  { maxWidth = 352, margin = 12, corner = 24 }: { maxWidth?: number; margin?: number; corner?: number } = {},
): { left: number; width: number; tail: number } {
  const width = Math.max(0, Math.min(maxWidth, strip.width - margin * 2));
  const centre = badge.left + badge.width / 2;
  const left = Math.min(Math.max(centre - width / 2, margin), Math.max(margin, strip.width - margin - width));
  const tail = Math.min(Math.max(centre - left, corner), Math.max(corner, width - corner));
  return { left, width, tail };
}
