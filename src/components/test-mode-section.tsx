import Link from "next/link";
import { AdminSection } from "@/components/admin-section";

/**
 * The admin page's test mode (Pong, 15 Nov 2026): the board with every kind of notice in its strip, seen by admins
 * only; since 16 Nov 2026 the ยังไม่มีตาราง HOSxP notice, since 27 Nov 2026 the no-room one too. Its link sits in the heading, greyed out and inert until the section is opened (Pong, 16 Nov 2026).
 * `href` is the board's address with ?notices=all (the development preview has its own).
 */
export function TestModeSection({ href }: { href: string }) {
  return (
    <AdminSection
      id="test-mode"
      title="โหมดทดสอบ"
      summary="แสดงการแจ้งเตือนทุกแบบในแถบเหนือแผนผังและในหัวการ์ดห้อง เห็นเฉพาะผู้ดูแลระบบ"
      actions={
        <Link href={href} className="btn btn-secondary" data-testid="test-notices-link">
          <span>ดูการแจ้งเตือน</span>
        </Link>
      }
      testId="test-mode-section"
    >
      {/* The kinds lib/board-notices.ts everyNotice() puts in the strip. */}
      <p className="p-4 text-sm text-ink-2 sm:p-5">การแจ้งเตือนที่จะเห็น: ยังไม่มีตาราง HOSxP · เคสไม่มีห้องผ่าตัด · ไม่บันทึกอะไร</p>
    </AdminSection>
  );
}
