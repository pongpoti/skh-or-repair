import { shortThaiDate } from "./repair.ts";

/**
 * The notice in the strip above the plan. Since Pong's 16 Nov 2026 change there is only one: no HOSxP file yet for the
 * board's day ("remove วันหยุด badge, it is unnecessary", and the โหลดไม่สำเร็จ and ไม่ตรง badges too). It is a badge
 * in the middle of the strip; a tap opens its full message as a chat bubble. The repair needs no notice: the plan's own
 * "พื้นที่ปิดซ่อม" zone shows it. The demo schedule has a badge of its own (DEMO_NOTICE), for admins only.
 */

/** "alert" is the red alert theme of the no-table notice (Pong, 17 Nov 2026). */
export type NoticeTone = "neutral" | "alert";
/** "no-table" is the database with a slash through it: no HOSxP table yet (components/no-table-icon.tsx). */
export type NoticeIcon = "no-table" | "flask";

export type BoardNotice = {
  id: "demo" | "no-upload";
  tone: NoticeTone;
  icon: NoticeIcon;
  /** The whole message in one line: the badge's text when it is alone, and the bubble's title. */
  text: string;
  /** The badge's text when several badges share the strip (only with the demo's). */
  short: string;
  /** What it means and what happens next, under the title in the bubble. */
  detail: string;
  /** Kept from the one-line notes the badges replace, for the end-to-end tests. */
  testId?: string;
};

export function boardNotices({
  missingUpload,
}: {
  /** The board's date when MX has not uploaded its HOSxP file yet, else null. */
  missingUpload: string | null;
}): BoardNotice[] {
  if (!missingUpload) return [];
  return [
    {
      id: "no-upload",
      tone: "alert",
      icon: "no-table",
      text: `ยังไม่มีตาราง HOSxP ของ ${shortThaiDate(missingUpload)}`,
      short: "ยังไม่มี HOSxP",
      detail: "Manager อัปโหลดตารางจาก HOSxP ทุกวัน เวลา 15:00–16:00 สำหรับวันทำการถัดไป ระหว่างนี้ห้องแสดงเฉพาะการจองของแพทย์",
      testId: "no-upload-alert",
    },
  ];
}

/**
 * Every kind of notice at once, for seeing how the strip looks with all of them (Pong, 15 Nov 2026: "Test mode: show me
 * all possible notification badges stacked within noti bar"): an admin's /?notices=all, and the preview's. Since 16 Nov
 * 2026 that is the one badge.
 */
export function everyNotice(date: string): BoardNotice[] {
  return boardNotices({ missingUpload: date });
}

/**
 * The first badge of the demo schedule (lib/demo-schedule.ts), an admin's /?demo=1, so the made-up cases are never
 * taken for the day's real list.
 */
export const DEMO_NOTICE: BoardNotice = {
  id: "demo",
  tone: "neutral",
  icon: "flask",
  text: "ตารางตัวอย่าง · เคสสมมติ ไม่ใช่ข้อมูลจริง",
  short: "ตารางตัวอย่าง",
  detail:
    "เคสทุกห้องในหน้านี้สร้างขึ้นเพื่อดูหน้าตาตารางเท่านั้น ไม่ได้บันทึก และไม่แตะการจองหรือตาราง HOSxP จริง เห็นเฉพาะผู้ดูแลระบบ แตะโลโก้ด้านบนเพื่อกลับไปตารางจริง",
  testId: "demo-notice",
};

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
