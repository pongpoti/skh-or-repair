import { DEPARTMENTS } from "./allocation.ts";
import type { OffBoardCount } from "./board-rows.ts";
import { shortThaiDate } from "./repair.ts";

/**
 * The notices in the strip above the plan, at both hospitals. Since Pong's 16 Nov 2026 change there was only one: no
 * HOSxP file yet for the board's day ("remove วันหยุด badge, it is unnecessary", and the โหลดไม่สำเร็จ and ไม่ตรง badges
 * too). Since 27 Nov 2026 a second: HOSxP cases no room takes that day ("Leave off board and display on noti bar for
 * both places"). Each is a badge in the middle of the strip; a tap opens its full message as a chat bubble. The repair
 * needs no notice: the plan's own "พื้นที่ปิดซ่อม" zone shows it. The demo schedule has a badge of its own
 * (DEMO_NOTICE), for admins only.
 */

/** Where the notices go: a slot beside the board's own hospital in the bar's switch (components/place-tabs.tsx). */
export const PLACE_NOTICES_ID = "place-notices";

/** "alert" is the red alert theme of the no-table notice (Pong, 17 Nov 2026). */
export type NoticeTone = "neutral" | "alert";
/**
 * "no-table" is the database with a slash through it: no HOSxP table yet (components/no-table-icon.tsx); "no-room" a
 * closed door: cases no room takes.
 */
export type NoticeIcon = "no-table" | "flask" | "no-room";

export type BoardNotice = {
  id: "demo" | "sim" | "no-upload" | "no-room";
  tone: NoticeTone;
  icon: NoticeIcon;
  /** The whole message in one line: the badge's text when it is alone, and the bubble's title. */
  text: string;
  /** The badge's text when several badges share the strip (only with the demo's). */
  short: string;
  /** A number the chip shows beside its icon (the no-room cases), when the notice has one. */
  count?: number;
  /** What it means and what happens next, under the title in the bubble. */
  detail: string;
  /** Kept from the one-line notes the badges replace, for the end-to-end tests. */
  testId?: string;
};

/** A department's cases as the no-room notice names them: "ศัลยกรรมหลอดเลือด 2 เคส", "ไม่ทราบสาขา 1 เคส". */
function offBoardText({ dept, count }: OffBoardCount): string {
  const name = dept && Object.hasOwn(DEPARTMENTS, dept) ? DEPARTMENTS[dept].name : "ไม่ทราบสาขา";
  return `${name} ${count} เคส`;
}

export function boardNotices({
  missingUpload,
  offBoard = [],
}: {
  /** The board's date when MX has not uploaded its HOSxP file yet, else null. */
  missingUpload: string | null;
  /** The HOSxP cases no room takes that day (lib/board-rows.ts BoardRows.offBoard). */
  offBoard?: readonly OffBoardCount[];
}): BoardNotice[] {
  const notices: BoardNotice[] = [];
  if (missingUpload) {
    notices.push({
      id: "no-upload",
      tone: "alert",
      icon: "no-table",
      text: `ยังไม่มีตาราง HOSxP ของ ${shortThaiDate(missingUpload)}`,
      short: "ยังไม่มี HOSxP",
      detail: "Manager อัปโหลดตาราง HOSxP ทุกวัน 15:00–16:00 น. ตอนนี้เห็นเฉพาะเคสที่แพทย์จอง",
      testId: "no-upload-alert",
    });
  }
  const total = offBoard.reduce((sum, item) => sum + item.count, 0);
  if (total > 0) {
    notices.push({
      id: "no-room",
      tone: "alert",
      icon: "no-room",
      text: `${total} เคสไม่มีห้องผ่าตัด`,
      short: `ไม่มีห้อง ${total} เคส`,
      count: total,
      detail: `ไม่ได้ลงกระดาน เพราะสาขาไม่มีห้องในวันนั้น: ${offBoard.map(offBoardText).join(" · ")}`,
      testId: "no-room-alert",
    });
  }
  return notices;
}

/**
 * Every kind of notice at once, for seeing how the strip looks with all of them (Pong, 15 Nov 2026: "Test mode: show me
 * all possible notification badges stacked within noti bar"): an admin's /?notices=all, and the preview's. Since 27 Nov
 * 2026 the two badges, the no-room one with made-up counts.
 */
export function everyNotice(date: string): BoardNotice[] {
  return boardNotices({ missingUpload: date, offBoard: [{ dept: "VASCULAR", count: 2 }, { dept: null, count: 1 }] });
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
  detail: "เคสสมมติ ไม่ได้บันทึก ไม่กระทบการจองจริง แตะโลโก้เพื่อกลับตารางจริง",
  testId: "demo-notice",
};

/**
 * The first badge of the simulated bookings (lib/sim-bookings.ts), an admin's /?sim=1: the day's real HOSxP list with
 * made-up bookings, so they are never taken for the doctors' own.
 */
export const SIM_NOTICE: BoardNotice = {
  id: "sim",
  tone: "neutral",
  icon: "flask",
  text: "การจองจำลอง · จองสมมติจากเคส HOSxP จริง",
  short: "การจองจำลอง",
  detail: "การจองสมมติจากรายการ HOSxP ของวันนั้น ไม่ได้บันทึก ไม่กระทบการจองจริง แตะโลโก้เพื่อกลับตารางจริง",
  testId: "sim-notice",
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
